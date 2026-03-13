(function () {
	"use strict";

	var settings = {
		autoAdvance: true,
		unlockSeeking: true,
		playbackSpeed: 2,
		autoPlay: true,
		skipWaiting: true,
		marathonMode: false,
	};

	window.addEventListener("CQN_SETTINGS", function (e) {
		var prev = settings.marathonMode;
		Object.assign(settings, e.detail || {});
		applyToVideos();
		if (settings.marathonMode && !prev) runner.start();
		if (!settings.marathonMode && prev) runner.stop();
	});

	window.addEventListener("CQN_CMD", function (e) {
		var action = (e.detail || {}).action;
		if (action === "completeNow") triggerComplete();
		if (action === "nextLesson") goNext();
		if (action === "skipToNearEnd") seekNearEnd();
		if (action === "marathonStart") runner.start();
		if (action === "marathonStop") runner.stop();
	});

	window.__cqnState = function () {
		return {
			capturedCount: batches.length + others.length,
			marathon: settings.marathonMode,
			marathonStatus: runner.status,
			marathonItem: runner.currentItem,
			videosPlayed: runner.videosPlayed,
			itemsSkipped: runner.itemsSkipped,
			courseComplete: !!window.__cqnCourseComplete,
		};
	};

	var batches = [];
	var others = [];
	window.__cqnCapturedCount = 0;

	var realFetch = window.fetch.bind(window);
	var realOpen = XMLHttpRequest.prototype.open;
	var realSend = XMLHttpRequest.prototype.send;
	var realHdr = XMLHttpRequest.prototype.setRequestHeader;

	window.fetch = function (input, opts) {
		var url = typeof input === "string" ? input : (input && input.url) || "";
		var method = ((opts && opts.method) || "GET").toUpperCase();
		var body = "";
		try {
			body = opts && opts.body ? String(opts.body) : "";
		} catch (x) {}
		capture(url, method, body, { kind: "fetch", opts: safeCopy(opts || {}) });
		return realFetch(input, opts);
	};

	XMLHttpRequest.prototype.open = function (m, u) {
		this._u = u;
		this._m = (m || "GET").toUpperCase();
		this._h = {};
		return realOpen.apply(this, arguments);
	};
	XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
		if (this._h) this._h[k] = v;
		return realHdr.call(this, k, v);
	};
	XMLHttpRequest.prototype.send = function (body) {
		capture(this._u || "", this._m || "GET", body ? String(body) : "", {
			kind: "xhr",
			headers: Object.assign({}, this._h),
		});
		return realSend.call(this, body);
	};

	function capture(url, method, body, meta) {
		if (!url || method === "GET") return;
		var u = url.toLowerCase();
		if (/\.(css|png|woff|ttf|gif|jpg|webp)/.test(u)) return;
		if (/amazonaws|cloudfront|gstatic|pendo/.test(u)) return;

		var batchPath = "eventing" + "/" + "info" + "batch";
		if (u.indexOf(batchPath) !== -1) {
			try {
				var parsed = JSON.parse(body);
				var evts = Array.isArray(parsed.events) ? parsed.events : [];
				if (
					evts.some(function (e) {
						return e.key && /video|heartbeat/.test(e.key);
					})
				) {
					upsert(
						batches,
						url,
						Object.assign(
							{ url: url, method: method, body: body, parsed: parsed },
							meta,
						),
					);
					window.__cqnCapturedCount = batches.length + others.length;
					if (batches.length + others.length >= 4 && settings.marathonMode) {
						runner._onApiReady();
					}
				}
			} catch (x) {}
			return;
		}

		var isProgressUrl =
			/videoevents|lectureview|ondemandlecture|trackeditem|heartbeat|completion/.test(
				u,
			);
		var bl = body.toLowerCase();
		var isProgressBody =
			/videoposition|watchedupto|percentwatched|viewedupto|iscompleted/.test(
				bl,
			);

		if (isProgressUrl || isProgressBody) {
			upsert(
				others,
				url,
				Object.assign({ url: url, method: method, body: body }, meta),
			);
			window.__cqnCapturedCount = batches.length + others.length;
			if (batches.length + others.length >= 4 && settings.marathonMode) {
				runner._onApiReady();
			}
		}
	}

	function upsert(arr, key, val) {
		var i = arr.findIndex(function (x) {
			return x.url === key;
		});
		if (i !== -1) arr.splice(i, 1);
		arr.push(val);
	}

	function safeCopy(o) {
		try {
			return JSON.parse(JSON.stringify(o));
		} catch (x) {
			return Object.assign({}, o);
		}
	}

	var skipSegments = [
		"/supplement/",
		"/exam/",
		"/quiz/",
		"/gradedLab/",
		"/ungradedLab/",
		"/ungradedWidget/",
		"/widget/",
		"/discussions/",
		"/discussionPrompt/",
		"/discussionForum/",
		"/peer/",
		"/staffGraded/",
		"/assignment-submission/",
	];

	var runner = {
		active: false,
		status: "idle",
		currentItem: "",
		videosPlayed: 0,
		itemsSkipped: 0,
		_timer: null,
		_hookedVids: new WeakSet(),
		_apiReadyFired: false,

		start: function () {
			if (this.active) return;
			this.active = true;
			this.status = "loading";
			this._apiReadyFired = false;
			window.__cqnCourseComplete = false;
			settings.marathonMode = true;
			this._tick();
		},

		stop: function () {
			this.active = false;
			this.status = "idle";
			this._apiReadyFired = false;
			settings.marathonMode = false;
			clearTimeout(this._timer);
		},

		_finishCourse: function () {
			this.stop();
			this.status = "done";
			window.__cqnCourseComplete = true;
			showCompleteBanner();
		},

		_onApiReady: function () {
			if (this._apiReadyFired || !this.active) return;
			if (!this._isVideoPage(location.pathname)) return;
			this._apiReadyFired = true;
			console.log("[CQN] API count reached 4 — marking complete");
			this._markCompleteAndAdvance();
		},

		_markCompleteAndAdvance: function () {
			var self = this;
			Promise.allSettled([replayBatches(), replayOthers(), directAPI()]).then(
				function () {
					self.videosPlayed++;
					self._timer = setTimeout(function () {
						goNext();
						self._waitNav(8000, function () {
							self._tick();
						});
					}, 1200);
				},
			);
		},

		_tick: function () {
			if (!this.active) return;
			clearTimeout(this._timer);
			dismissOverlays();
			this._apiReadyFired = false;

			var path = location.pathname;
			this.currentItem = path.split("/").filter(Boolean).pop() || path;

			if (this._isVideoPage(path)) {
				this._handleVideo();
			} else if (this._isSkippable(path)) {
				this._skipItem();
			} else {
				// Not a /learn/ page at all (course home, specialization page, etc.) — course is done
				this._finishCourse();
			}
		},

		_isVideoPage: function (p) {
			return p.indexOf("/lecture/") !== -1;
		},

		_isSkippable: function (p) {
			// Any /learn/ page that is not a lecture gets skipped — covers every item type
			// including supplement, quiz, dialogue, ungradedPlugin, appitem, peer, etc.
			return p.indexOf("/learn/") !== -1 && p.indexOf("/lecture/") === -1;
		},

		_handleVideo: function () {
			this.status = "loading";
			var self = this;

			var tryAttach = function (attempts) {
				if (!self.active) return;
				var v = document.querySelector("video");
				if (!v) {
					if (attempts > 20) {
						self._skipItem();
						return;
					}
					self._timer = setTimeout(function () {
						tryAttach(attempts + 1);
					}, 500);
					return;
				}

				self.status = "playing";
				v.__userPaused = false;
				forceSpeed(v);

				var attachEnded = function () {
					if (self._hookedVids.has(v)) return;
					self._hookedVids.add(v);
					v.addEventListener("ended", function onEnded() {
						if (!self.active) return;
						self.videosPlayed++;
						self._timer = setTimeout(function () {
							goNext();
							self._waitNav(8000, function () {
								self._tick();
							});
						}, 1600);
					});
				};

				var seekToOneThird = function () {
					var dur = v.duration;
					if (!dur || !isFinite(dur)) return;
					var startAt = dur * (2 / 3);
					try {
						nativeTime.set.call(v, startAt);
					} catch (x) {
						v.currentTime = startAt;
					}
					v.__userPaused = false;
					v.play().catch(function () {});
					attachEnded();
				};

				if (v.readyState >= 1 && isFinite(v.duration)) {
					seekToOneThird();
				} else {
					v.addEventListener("loadedmetadata", seekToOneThird, { once: true });
					if (v.paused) v.play().catch(function () {});
				}
			};

			this._timer = setTimeout(function () {
				tryAttach(0);
			}, 600);
		},

		_skipItem: function () {
			this.status = "skipping";
			this.itemsSkipped++;
			completeItemAPI().catch(function () {});
			var self = this;
			this._timer = setTimeout(function () {
				goNext();
				self._waitNav(8000, function () {
					self._tick();
				});
			}, 600);
		},

		_waitNav: function (maxMs, cb) {
			var startUrl = location.href;
			var deadline = Date.now() + maxMs;
			var self = this;
			var poll = function () {
				if (!self.active) return;
				if (location.href !== startUrl) {
					self._timer = setTimeout(cb, 2000);
				} else if (Date.now() < deadline) {
					self._timer = setTimeout(poll, 350);
				} else {
					// URL never changed — stuck on last item
					self._finishCourse();
				}
			};
			this._timer = setTimeout(poll, 350);
		},

		_enterCourse: function () {
			var tries = [
				'[data-testid="start-button"]',
				'[data-testid="resume-button"]',
				'a[href*="/lecture/"]',
				'a[href*="/supplement/"]',
				'[data-track-component="item_row"] a',
				".rc-WeekItemName a",
				".item-link",
			];
			for (var i = 0; i < tries.length; i++) {
				var el = document.querySelector(tries[i]);
				if (el && el.offsetParent) {
					el.click();
					return true;
				}
			}
			return false;
		},
	};

	async function completeItemAPI() {
		var m = location.pathname.match(/\/learn\/([^/]+)\/[^/]+\/([^/?#]+)/);
		if (!m) return;
		var slug = m[1],
			itemId = m[2],
			csrf = getCSRF();
		if (!csrf) return;
		var courseId = await getCourseId(slug);
		if (!courseId) return;
		var h = {
			"Content-Type": "application/json;charset=UTF-8",
			"CSRF3-Token": csrf,
			"X-CSRF3-Token": csrf,
		};
		await Promise.allSettled([
			realFetch("/api/" + "onDemandLearnerMaterials" + ".v1", {
				method: "POST",
				headers: h,
				credentials: "include",
				body: JSON.stringify({
					courseId: courseId,
					itemId: itemId,
					isCompleted: true,
				}),
			}),
			realFetch("/api/" + "onDemandLectureViews" + ".v1", {
				method: "POST",
				headers: h,
				credentials: "include",
				body: JSON.stringify({
					courseId: courseId,
					itemId: itemId,
					isCompleted: true,
					watchedUpTo: 999999,
				}),
			}),
		]);
	}

	function seekNearEnd() {
		var v = document.querySelector("video");
		if (!v) return;
		var go = function () {
			var dur = v.duration;
			if (!dur || !isFinite(dur)) return;
			var t = Math.max(0, dur - 30);
			v.__userPaused = false;
			try {
				nativeTime.set.call(v, t);
			} catch (x) {
				v.currentTime = t;
			}
			if (v.paused) v.play().catch(function () {});
			v.dispatchEvent(new Event("timeupdate", { bubbles: true }));
		};
		if (v.readyState >= 1 && isFinite(v.duration)) go();
		else v.addEventListener("loadedmetadata", go, { once: true });
	}

	async function triggerComplete() {
		await Promise.allSettled([replayBatches(), replayOthers(), directAPI()]);
		var v = document.querySelector("video");
		if (v) fireEnded(v);
		else setTimeout(goNext, 600);
	}

	async function replayBatches() {
		if (!batches.length) return;
		var tpl = batches[batches.length - 1];
		var parsed;
		try {
			parsed = JSON.parse(tpl.body);
		} catch (x) {
			return;
		}
		var evts = Array.isArray(parsed.events) ? parsed.events : [];
		var hb =
			evts.find(function (e) {
				return e.key === "open_course.video.heartbeat";
			}) ||
			evts.find(function (e) {
				return e.key && e.key.indexOf("video") !== -1;
			}) ||
			evts[0];
		if (!hb) return;
		var now = Date.now();
		var completionEvts = [
			Object.assign({}, hb, {
				key: "open_course.video.heartbeat",
				clientTimestamp: now,
				guid: makeGuid(),
				value: Object.assign({}, hb.value || {}, {
					video_position: 999999,
					video_percent: 100,
					watched_seconds: 999999,
					percent_watched: 100,
					is_completed: true,
				}),
			}),
			Object.assign({}, hb, {
				key: "open_course.video.complete",
				clientTimestamp: now + 100,
				guid: makeGuid(),
				value: Object.assign({}, hb.value || {}, {
					video_position: 999999,
					video_percent: 100,
					is_completed: true,
				}),
			}),
		];
		var init = Object.assign({}, tpl.opts || {}, {
			method: "POST",
			body: JSON.stringify(
				Object.assign({}, parsed, { events: completionEvts }),
			),
		});
		var csrf = getCSRF();
		if (csrf) {
			init.headers = init.headers || {};
			init.headers["CSRF3-Token"] = csrf;
			init.headers["X-CSRF3-Token"] = csrf;
		}
		try {
			var r = await realFetch(tpl.url, init);
			console.log("[CQN] batch →", r.status);
		} catch (x) {}
	}

	async function replayOthers() {
		for (var i = 0; i < others.length; i++) {
			var req = others[i];
			try {
				var pb = patchBody(req.body);
				if (req.kind === "fetch") {
					await realFetch(
						req.url,
						Object.assign({}, req.opts || {}, { method: req.method, body: pb }),
					);
				} else {
					await new Promise(function (res) {
						var x = new XMLHttpRequest();
						realOpen.call(x, req.method, req.url, true);
						Object.entries(req.headers || {}).forEach(function (pair) {
							realHdr.call(x, pair[0], pair[1]);
						});
						if (pb && !(req.headers || {})["Content-Type"])
							realHdr.call(x, "Content-Type", "application/json");
						x.onloadend = res;
						x.onerror = res;
						realSend.call(x, pb);
					});
				}
			} catch (x) {}
		}
	}

	async function directAPI() {
		var m = location.pathname.match(
			/\/learn\/([^/]+)\/(?:lecture|supplement|exam|quiz|ungradedLab)\/([^/?#]+)/,
		);
		if (!m) return;
		var slug = m[1],
			itemId = m[2],
			csrf = getCSRF();
		if (!csrf) return;
		var userId = getUserId(),
			courseId = await getCourseId(slug);
		var h = {
			"Content-Type": "application/json;charset=UTF-8",
			"CSRF3-Token": csrf,
			"X-CSRF3-Token": csrf,
		};
		if (userId) {
			await realFetch(
				"/api/opencourse.v1/user/" +
					userId +
					"/course/" +
					slug +
					"/item/" +
					itemId +
					"/videoEvents",
				{
					method: "POST",
					headers: h,
					credentials: "include",
					body: JSON.stringify({ type: "ViewedUpto", videoPosition: 999999 }),
				},
			).catch(function () {});
		}
		if (courseId) {
			await realFetch("/api/" + "onDemandLectureViews" + ".v1", {
				method: "POST",
				headers: h,
				credentials: "include",
				body: JSON.stringify({
					courseId: courseId,
					itemId: itemId,
					isCompleted: true,
					watchedUpTo: 999999,
					videoProgress: 1,
					percentWatched: 1,
				}),
			}).catch(function () {});
		}
	}

	function fireEnded(v) {
		var dur = isFinite(v.duration) && v.duration ? v.duration : 1200;
		v.__cqnLock = true;
		var st = function (t) {
			try {
				nativeTime.set.call(v, t);
			} catch (x) {
				try {
					v.currentTime = t;
				} catch (xx) {}
			}
		};
		var ev = function (n) {
			v.dispatchEvent(new Event(n, { bubbles: true }));
		};
		st(dur * 0.9);
		ev("timeupdate");
		setTimeout(function () {
			st(dur * 0.97);
			ev("timeupdate");
		}, 200);
		setTimeout(function () {
			st(dur * 0.99);
			ev("timeupdate");
		}, 400);
		setTimeout(function () {
			st(dur);
			ev("timeupdate");
			ev("ended");
			v.__cqnLock = false;
			setTimeout(goNext, 1200);
		}, 650);
	}

	function patchBody(body) {
		if (!body) return body;
		try {
			var P = {
				watchedUpTo: 999999,
				watchedUpto: 999999,
				videoPosition: 999999,
				currentTime: 999999,
				position: 999999,
				percentWatched: 1,
				percentageWatched: 100,
				video_position: 999999,
				video_percent: 100,
				watched_seconds: 999999,
				percent_watched: 100,
				videoProgress: 1,
				progress: 1,
				isCompleted: true,
				is_completed: true,
				completed: true,
				watched: true,
			};
			var obj = JSON.parse(body);
			(function deep(o) {
				if (!o || typeof o !== "object") return;
				Object.keys(P).forEach(function (k) {
					if (k in o) o[k] = P[k];
				});
				Object.values(o).forEach(deep);
			})(obj);
			return JSON.stringify(obj);
		} catch (x) {
			return body;
		}
	}

	function getCSRF() {
		var parts = document.cookie.split(";");
		for (var i = 0; i < parts.length; i++) {
			var eq = parts[i].indexOf("=");
			if (eq < 0) continue;
			if (/csrf/i.test(parts[i].slice(0, eq).trim()))
				return decodeURIComponent(parts[i].slice(eq + 1).trim());
		}
		return null;
	}

	function getUserId() {
		for (var i = 0; i < batches.length; i++) {
			try {
				var evts = JSON.parse(batches[i].body).events || [];
				for (var j = 0; j < evts.length; j++) {
					if (evts[j].userId) return String(evts[j].userId);
					if (evts[j].value && evts[j].value.user_id)
						return String(evts[j].value.user_id);
				}
			} catch (x) {}
		}
		for (var k = 0; k < others.length; k++) {
			try {
				var b = JSON.parse(others[k].body || "{}");
				if (b.userId) return String(b.userId);
			} catch (x) {}
			var m = (others[k].body || "").match(/"userId"\s*:\s*(\d+)/);
			if (m) return m[1];
		}
		try {
			var s = JSON.stringify(window.__PRELOADED_STATE__ || {});
			var match = s.match(/"userId"\s*:\s*"?(\d+)"?/);
			if (match) return match[1];
		} catch (x) {}
		return "";
	}

	var cidCache = {};
	async function getCourseId(slug) {
		if (cidCache[slug]) return cidCache[slug];
		try {
			var r = await realFetch(
				"/api/courses.v1?q=slug&slug=" +
					encodeURIComponent(slug) +
					"&fields=id",
				{ credentials: "include" },
			);
			var d = await r.json();
			var id = (d && d.elements && d.elements[0] && d.elements[0].id) || "";
			if (id) cidCache[slug] = id;
			return id;
		} catch (x) {
			return "";
		}
	}

	function makeGuid() {
		return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
			/[xy]/g,
			function (c) {
				var r = (Math.random() * 16) | 0;
				return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
			},
		);
	}

	var nativeRate = Object.getOwnPropertyDescriptor(
		HTMLMediaElement.prototype,
		"playbackRate",
	);
	var nativeTime = Object.getOwnPropertyDescriptor(
		HTMLMediaElement.prototype,
		"currentTime",
	);

	Object.defineProperty(HTMLMediaElement.prototype, "playbackRate", {
		get: function () {
			return nativeRate.get.call(this);
		},
		set: function (v) {
			var floor = parseFloat(settings.playbackSpeed) || 2;
			nativeRate.set.call(this, v > 0 && v < floor ? floor : v);
		},
		configurable: true,
	});

	var nativePause = HTMLMediaElement.prototype.pause;
	HTMLMediaElement.prototype.pause = function () {
		if (this.__cqnLock) return;
		if (settings.marathonMode && !this.__userPaused) return;
		return nativePause.apply(this, arguments);
	};

	var hooked = new WeakSet();

	function applyToVideos() {
		document.querySelectorAll("video").forEach(hookVideo);
	}

	function hookVideo(v) {
		forceSpeed(v);
		if (hooked.has(v)) return;
		hooked.add(v);

		if (settings.unlockSeeking) {
			["seeking", "seeked"].forEach(function (evt) {
				v.addEventListener(
					evt,
					function (e) {
						e.stopImmediatePropagation();
					},
					{ capture: true },
				);
			});
		}

		v.addEventListener(
			"pause",
			function () {
				if (v.__userPaused || v.__cqnLock) return;
				if (!settings.autoPlay && !settings.marathonMode) return;
				setTimeout(function () {
					if (v.paused && !v.__userPaused) v.play().catch(function () {});
				}, 350);
			},
			{ capture: true },
		);

		v.addEventListener("click", function () {
			v.__userPaused = !v.paused;
		});

		v.addEventListener("ended", function () {
			v.__userPaused = false;
			if (!settings.marathonMode && settings.autoAdvance)
				setTimeout(goNext, 1200);
		});

		v.addEventListener(
			"ratechange",
			function () {
				forceSpeed(v);
			},
			{ capture: true },
		);
		v.addEventListener("loadedmetadata", function () {
			forceSpeed(v);
			if (settings.marathonMode) {
				v.__userPaused = false;
				v.play().catch(function () {});
			}
		});
	}

	function forceSpeed(v) {
		var t = parseFloat(settings.playbackSpeed) || 2;
		try {
			if (Math.abs(nativeRate.get.call(v) - t) > 0.05)
				nativeRate.set.call(v, t);
		} catch (x) {}
	}

	function showCompleteBanner() {
		var old = document.getElementById("cqn-done");
		if (old) old.remove();
		var style = document.createElement("style");
		style.textContent =
			"@keyframes cqnPop{from{opacity:0;transform:translate(-50%,-14px)}to{opacity:1;transform:translate(-50%,0)}}";
		document.head.appendChild(style);
		var el = document.createElement("div");
		el.id = "cqn-done";
		el.style.cssText =
			"position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:99999;" +
			"background:linear-gradient(135deg,#14532d,#166534);color:#fff;" +
			"font-family:Inter,system-ui,sans-serif;padding:13px 22px 13px 16px;" +
			"border-radius:14px;display:flex;align-items:center;gap:12px;" +
			"box-shadow:0 8px 32px rgba(0,0,0,.5);animation:cqnPop .35s ease;";
		el.innerHTML =
			'<span style="font-size:26px">🎓</span>' +
			'<div><div style="font-size:14px;font-weight:700">Course Complete!</div>' +
			'<div style="font-size:11px;opacity:.75;margin-top:2px">Marathon finished — all items done</div></div>' +
			"<button onclick=\"document.getElementById('cqn-done').remove()\" " +
			'style="margin-left:10px;background:rgba(255,255,255,.15);border:none;color:#fff;' +
			'border-radius:7px;padding:4px 10px;cursor:pointer;font-weight:600;font-size:13px">✕</button>';
		document.body.appendChild(el);
		setTimeout(function () {
			if (el.parentNode) el.remove();
		}, 10000);
	}

	function goNext() {
		dismissOverlays();
		var sels = [
			'[data-testid="forward-navigation-button"]',
			'[data-testid="next-item-button"]',
			'[data-e2e="forward-arrow"]',
			'[data-e2e="next-item-link"]',
			'[data-track-component="next_item_button"]',
			'button[aria-label*="Next" i]',
			'a[aria-label*="Next" i]',
			'[class*="NextButton"]',
			'[class*="next-button"]',
			'button[data-testid*="next" i]',
		];
		for (var i = 0; i < sels.length; i++) {
			var el = document.querySelector(sels[i]);
			if (el && el.offsetParent !== null && !el.disabled) {
				el.click();
				return true;
			}
		}
		var all = document.querySelectorAll("button, a[href]");
		for (var j = 0; j < all.length; j++) {
			if (
				all[j].offsetParent &&
				/^\s*(next|continue)\s*$/i.test(all[j].textContent.trim())
			) {
				all[j].click();
				return true;
			}
		}
		return false;
	}

	function dismissOverlays() {
		var sels = [
			'[data-track-component="skip_countdown"]',
			'button[aria-label*="Skip" i]',
			'[class*="CountdownSkip"]',
			'[data-testid*="skip" i]',
			".rc-VideoNextItemOverlay button",
			'[class*="NextItemOverlay"] button',
		];
		sels.forEach(function (s) {
			try {
				var el = document.querySelector(s);
				if (el) el.click();
			} catch (x) {}
		});
	}

	setInterval(function () {
		applyToVideos();
		dismissOverlays();
		if (settings.marathonMode) {
			var v = document.querySelector("video");
			if (v && v.paused && !v.__userPaused && !v.__cqnLock && !v.ended)
				v.play().catch(function () {});
		}
	}, 900);

	var lastUrl = location.href;
	new MutationObserver(function () {
		applyToVideos();
		if (location.href !== lastUrl) {
			lastUrl = location.href;
			batches.length = 0;
			others.length = 0;
			window.__cqnCapturedCount = 0;
			runner._hookedVids = new WeakSet();
			runner._apiReadyFired = false;
			setTimeout(applyToVideos, 1500);
			if (runner.active) {
				clearTimeout(runner._timer);
				runner._timer = setTimeout(function () {
					runner._tick();
				}, 2200);
			}
		}
	}).observe(document.documentElement, { childList: true, subtree: true });
})();


// ===========================================================

(function () {
	"use strict";

	var settings = {
		autoAdvance: true,
		unlockSeeking: true,
		playbackSpeed: 2,
		autoPlay: true,
		skipWaiting: true,
		marathonMode: false,
	};

	window.addEventListener("CQN_SETTINGS", function (e) {
		var prev = settings.marathonMode;
		Object.assign(settings, e.detail || {});
		applyToVideos();
		if (settings.marathonMode && !prev) runner.start();
		if (!settings.marathonMode && prev) runner.stop();
	});

	window.addEventListener("CQN_CMD", function (e) {
		var action = (e.detail || {}).action;
		if (action === "completeNow") triggerComplete();
		if (action === "nextLesson") goNext();
		if (action === "skipToNearEnd") seekNearEnd();
		if (action === "marathonStart") runner.start();
		if (action === "marathonStop") runner.stop();
	});

	window.__cqnState = function () {
		return {
			capturedCount: batches.length + others.length,
			marathon: settings.marathonMode,
			marathonStatus: runner.status,
			marathonItem: runner.currentItem,
			videosPlayed: runner.videosPlayed,
			itemsSkipped: runner.itemsSkipped,
			courseComplete: !!window.__cqnCourseComplete,
		};
	};

	var batches = [];
	var others = [];
	window.__cqnCapturedCount = 0;

	var realFetch = window.fetch.bind(window);
	var realOpen = XMLHttpRequest.prototype.open;
	var realSend = XMLHttpRequest.prototype.send;
	var realHdr = XMLHttpRequest.prototype.setRequestHeader;

	window.fetch = function (input, opts) {
		var url = typeof input === "string" ? input : (input && input.url) || "";
		var method = ((opts && opts.method) || "GET").toUpperCase();
		var body = "";
		try {
			body = opts && opts.body ? String(opts.body) : "";
		} catch (x) {}
		capture(url, method, body, { kind: "fetch", opts: safeCopy(opts || {}) });
		return realFetch(input, opts);
	};

	XMLHttpRequest.prototype.open = function (m, u) {
		this._u = u;
		this._m = (m || "GET").toUpperCase();
		this._h = {};
		return realOpen.apply(this, arguments);
	};
	XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
		if (this._h) this._h[k] = v;
		return realHdr.call(this, k, v);
	};
	XMLHttpRequest.prototype.send = function (body) {
		capture(this._u || "", this._m || "GET", body ? String(body) : "", {
			kind: "xhr",
			headers: Object.assign({}, this._h),
		});
		return realSend.call(this, body);
	};

	function capture(url, method, body, meta) {
		if (!url || method === "GET") return;
		var u = url.toLowerCase();
		if (/\.(css|png|woff|ttf|gif|jpg|webp)/.test(u)) return;
		if (/amazonaws|cloudfront|gstatic|pendo/.test(u)) return;

		var batchPath = "eventing" + "/" + "info" + "batch";
		if (u.indexOf(batchPath) !== -1) {
			try {
				var parsed = JSON.parse(body);
				var evts = Array.isArray(parsed.events) ? parsed.events : [];
				if (
					evts.some(function (e) {
						return e.key && /video|heartbeat/.test(e.key);
					})
				) {
					upsert(
						batches,
						url,
						Object.assign(
							{ url: url, method: method, body: body, parsed: parsed },
							meta,
						),
					);
					window.__cqnCapturedCount = batches.length + others.length;
					if (batches.length + others.length >= 4 && settings.marathonMode) {
						runner._onApiReady();
					}
				}
			} catch (x) {}
			return;
		}

		var isProgressUrl =
			/videoevents|lectureview|ondemandlecture|trackeditem|heartbeat|completion/.test(
				u,
			);
		var bl = body.toLowerCase();
		var isProgressBody =
			/videoposition|watchedupto|percentwatched|viewedupto|iscompleted/.test(
				bl,
			);

		if (isProgressUrl || isProgressBody) {
			upsert(
				others,
				url,
				Object.assign({ url: url, method: method, body: body }, meta),
			);
			window.__cqnCapturedCount = batches.length + others.length;
			if (batches.length + others.length >= 4 && settings.marathonMode) {
				runner._onApiReady();
			}
		}
	}

	function upsert(arr, key, val) {
		var i = arr.findIndex(function (x) {
			return x.url === key;
		});
		if (i !== -1) arr.splice(i, 1);
		arr.push(val);
	}

	function safeCopy(o) {
		try {
			return JSON.parse(JSON.stringify(o));
		} catch (x) {
			return Object.assign({}, o);
		}
	}

	var skipSegments = [
		"/supplement/",
		"/exam/",
		"/quiz/",
		"/gradedLab/",
		"/ungradedLab/",
		"/ungradedWidget/",
		"/widget/",
		"/discussions/",
		"/discussionPrompt/",
		"/discussionForum/",
		"/peer/",
		"/staffGraded/",
		"/assignment-submission/",
	];

	var runner = {
		active: false,
		status: "idle",
		currentItem: "",
		videosPlayed: 0,
		itemsSkipped: 0,
		_timer: null,
		_hookedVids: new WeakSet(),
		_apiReadyFired: false,
		_consecSkips: 0,

		start: function () {
			if (this.active) return;
			this.active = true;
			this.status = "loading";
			this._apiReadyFired = false;
			this._consecSkips = 0;
			window.__cqnCourseComplete = false;
			settings.marathonMode = true;
			this._tick();
		},

		stop: function () {
			this.active = false;
			this.status = "idle";
			this._apiReadyFired = false;
			settings.marathonMode = false;
			clearTimeout(this._timer);
		},

		_finishCourse: function () {
			this.stop();
			this.status = "done";
			window.__cqnCourseComplete = true;
			showCompleteBanner();
		},

		_onApiReady: function () {
			if (this._apiReadyFired || !this.active) return;
			if (!this._isVideoPage(location.pathname)) return;
			this._apiReadyFired = true;
			console.log("[CQN] API count reached 4 — marking complete");
			this._markCompleteAndAdvance();
		},

		_markCompleteAndAdvance: function () {
			var self = this;
			Promise.allSettled([replayBatches(), replayOthers(), directAPI()]).then(
				function () {
					self.videosPlayed++;
					self._timer = setTimeout(function () {
						goNext();
						self._waitNav(8000, function () {
							self._tick();
						});
					}, 1200);
				},
			);
		},

		_tick: function () {
			if (!this.active) return;
			clearTimeout(this._timer);
			dismissOverlays();
			this._apiReadyFired = false;

			var path = location.pathname;
			this.currentItem = path.split("/").filter(Boolean).pop() || path;

			if (this._isVideoPage(path)) {
				this._handleVideo();
			} else if (this._isSkippable(path)) {
				this._skipItem();
			} else {
				// Not a /learn/ page at all (course home, specialization page, etc.) — course is done
				this._finishCourse();
			}
		},

		_isVideoPage: function (p) {
			return p.indexOf("/lecture/") !== -1;
		},

		_isSkippable: function (p) {
			// Any /learn/ page that is not a lecture gets skipped — covers every item type
			// including supplement, quiz, dialogue, ungradedPlugin, appitem, peer, etc.
			return p.indexOf("/learn/") !== -1 && p.indexOf("/lecture/") === -1;
		},

		_handleVideo: function () {
			this.status = "loading";
			this._consecSkips = 0;
			var self = this;

			var tryAttach = function (attempts) {
				if (!self.active) return;
				var v = document.querySelector("video");
				if (!v) {
					if (attempts > 20) {
						self._skipItem();
						return;
					}
					self._timer = setTimeout(function () {
						tryAttach(attempts + 1);
					}, 500);
					return;
				}

				self.status = "playing";
				v.__userPaused = false;
				forceSpeed(v);

				var attachEnded = function () {
					if (self._hookedVids.has(v)) return;
					self._hookedVids.add(v);
					v.addEventListener("ended", function onEnded() {
						if (!self.active) return;
						self.videosPlayed++;
						self._timer = setTimeout(function () {
							goNext();
							self._waitNav(8000, function () {
								self._tick();
							});
						}, 1600);
					});
				};

				var seekToOneThird = function () {
					var dur = v.duration;
					if (!dur || !isFinite(dur)) return;
					var startAt = dur * (2 / 3);
					try {
						nativeTime.set.call(v, startAt);
					} catch (x) {
						v.currentTime = startAt;
					}
					v.__userPaused = false;
					v.play().catch(function () {});
					attachEnded();
				};

				if (v.readyState >= 1 && isFinite(v.duration)) {
					seekToOneThird();
				} else {
					v.addEventListener("loadedmetadata", seekToOneThird, { once: true });
					if (v.paused) v.play().catch(function () {});
				}
			};

			this._timer = setTimeout(function () {
				tryAttach(0);
			}, 600);
		},

		_skipItem: function () {
			this.status = "skipping";
			this.itemsSkipped++;
			this._consecSkips++;
			if (this._consecSkips >= 14) {
				this._finishCourse();
				return;
			}
			completeItemAPI().catch(function () {});
			var self = this;
			this._timer = setTimeout(function () {
				goNext();
				self._waitNav(8000, function () {
					self._tick();
				});
			}, 600);
		},

		_waitNav: function (maxMs, cb) {
			var startUrl = location.href;
			var deadline = Date.now() + maxMs;
			var self = this;
			var poll = function () {
				if (!self.active) return;
				if (location.href !== startUrl) {
					self._timer = setTimeout(cb, 2000);
				} else if (Date.now() < deadline) {
					self._timer = setTimeout(poll, 350);
				} else {
					// URL never changed — stuck on last item
					self._finishCourse();
				}
			};
			this._timer = setTimeout(poll, 350);
		},

		_enterCourse: function () {
			var tries = [
				'[data-testid="start-button"]',
				'[data-testid="resume-button"]',
				'a[href*="/lecture/"]',
				'a[href*="/supplement/"]',
				'[data-track-component="item_row"] a',
				".rc-WeekItemName a",
				".item-link",
			];
			for (var i = 0; i < tries.length; i++) {
				var el = document.querySelector(tries[i]);
				if (el && el.offsetParent) {
					el.click();
					return true;
				}
			}
			return false;
		},
	};

	async function completeItemAPI() {
		var m = location.pathname.match(/\/learn\/([^/]+)\/[^/]+\/([^/?#]+)/);
		if (!m) return;
		var slug = m[1],
			itemId = m[2],
			csrf = getCSRF();
		if (!csrf) return;
		var courseId = await getCourseId(slug);
		if (!courseId) return;
		var h = {
			"Content-Type": "application/json;charset=UTF-8",
			"CSRF3-Token": csrf,
			"X-CSRF3-Token": csrf,
		};
		await Promise.allSettled([
			realFetch("/api/" + "onDemandLearnerMaterials" + ".v1", {
				method: "POST",
				headers: h,
				credentials: "include",
				body: JSON.stringify({
					courseId: courseId,
					itemId: itemId,
					isCompleted: true,
				}),
			}),
			realFetch("/api/" + "onDemandLectureViews" + ".v1", {
				method: "POST",
				headers: h,
				credentials: "include",
				body: JSON.stringify({
					courseId: courseId,
					itemId: itemId,
					isCompleted: true,
					watchedUpTo: 999999,
				}),
			}),
		]);
	}

	function seekNearEnd() {
		var v = document.querySelector("video");
		if (!v) return;
		var go = function () {
			var dur = v.duration;
			if (!dur || !isFinite(dur)) return;
			var t = Math.max(0, dur - 30);
			v.__userPaused = false;
			try {
				nativeTime.set.call(v, t);
			} catch (x) {
				v.currentTime = t;
			}
			if (v.paused) v.play().catch(function () {});
			v.dispatchEvent(new Event("timeupdate", { bubbles: true }));
		};
		if (v.readyState >= 1 && isFinite(v.duration)) go();
		else v.addEventListener("loadedmetadata", go, { once: true });
	}

	async function triggerComplete() {
		await Promise.allSettled([replayBatches(), replayOthers(), directAPI()]);
		var v = document.querySelector("video");
		if (v) fireEnded(v);
		else setTimeout(goNext, 600);
	}

	async function replayBatches() {
		if (!batches.length) return;
		var tpl = batches[batches.length - 1];
		var parsed;
		try {
			parsed = JSON.parse(tpl.body);
		} catch (x) {
			return;
		}
		var evts = Array.isArray(parsed.events) ? parsed.events : [];
		var hb =
			evts.find(function (e) {
				return e.key === "open_course.video.heartbeat";
			}) ||
			evts.find(function (e) {
				return e.key && e.key.indexOf("video") !== -1;
			}) ||
			evts[0];
		if (!hb) return;
		var now = Date.now();
		var completionEvts = [
			Object.assign({}, hb, {
				key: "open_course.video.heartbeat",
				clientTimestamp: now,
				guid: makeGuid(),
				value: Object.assign({}, hb.value || {}, {
					video_position: 999999,
					video_percent: 100,
					watched_seconds: 999999,
					percent_watched: 100,
					is_completed: true,
				}),
			}),
			Object.assign({}, hb, {
				key: "open_course.video.complete",
				clientTimestamp: now + 100,
				guid: makeGuid(),
				value: Object.assign({}, hb.value || {}, {
					video_position: 999999,
					video_percent: 100,
					is_completed: true,
				}),
			}),
		];
		var init = Object.assign({}, tpl.opts || {}, {
			method: "POST",
			body: JSON.stringify(
				Object.assign({}, parsed, { events: completionEvts }),
			),
		});
		var csrf = getCSRF();
		if (csrf) {
			init.headers = init.headers || {};
			init.headers["CSRF3-Token"] = csrf;
			init.headers["X-CSRF3-Token"] = csrf;
		}
		try {
			var r = await realFetch(tpl.url, init);
			console.log("[CQN] batch →", r.status);
		} catch (x) {}
	}

	async function replayOthers() {
		for (var i = 0; i < others.length; i++) {
			var req = others[i];
			try {
				var pb = patchBody(req.body);
				if (req.kind === "fetch") {
					await realFetch(
						req.url,
						Object.assign({}, req.opts || {}, { method: req.method, body: pb }),
					);
				} else {
					await new Promise(function (res) {
						var x = new XMLHttpRequest();
						realOpen.call(x, req.method, req.url, true);
						Object.entries(req.headers || {}).forEach(function (pair) {
							realHdr.call(x, pair[0], pair[1]);
						});
						if (pb && !(req.headers || {})["Content-Type"])
							realHdr.call(x, "Content-Type", "application/json");
						x.onloadend = res;
						x.onerror = res;
						realSend.call(x, pb);
					});
				}
			} catch (x) {}
		}
	}

	async function directAPI() {
		var m = location.pathname.match(
			/\/learn\/([^/]+)\/(?:lecture|supplement|exam|quiz|ungradedLab)\/([^/?#]+)/,
		);
		if (!m) return;
		var slug = m[1],
			itemId = m[2],
			csrf = getCSRF();
		if (!csrf) return;
		var userId = getUserId(),
			courseId = await getCourseId(slug);
		var h = {
			"Content-Type": "application/json;charset=UTF-8",
			"CSRF3-Token": csrf,
			"X-CSRF3-Token": csrf,
		};
		if (userId) {
			await realFetch(
				"/api/opencourse.v1/user/" +
					userId +
					"/course/" +
					slug +
					"/item/" +
					itemId +
					"/videoEvents",
				{
					method: "POST",
					headers: h,
					credentials: "include",
					body: JSON.stringify({ type: "ViewedUpto", videoPosition: 999999 }),
				},
			).catch(function () {});
		}
		if (courseId) {
			await realFetch("/api/" + "onDemandLectureViews" + ".v1", {
				method: "POST",
				headers: h,
				credentials: "include",
				body: JSON.stringify({
					courseId: courseId,
					itemId: itemId,
					isCompleted: true,
					watchedUpTo: 999999,
					videoProgress: 1,
					percentWatched: 1,
				}),
			}).catch(function () {});
		}
	}

	function fireEnded(v) {
		var dur = isFinite(v.duration) && v.duration ? v.duration : 1200;
		v.__cqnLock = true;
		var st = function (t) {
			try {
				nativeTime.set.call(v, t);
			} catch (x) {
				try {
					v.currentTime = t;
				} catch (xx) {}
			}
		};
		var ev = function (n) {
			v.dispatchEvent(new Event(n, { bubbles: true }));
		};
		st(dur * 0.9);
		ev("timeupdate");
		setTimeout(function () {
			st(dur * 0.97);
			ev("timeupdate");
		}, 200);
		setTimeout(function () {
			st(dur * 0.99);
			ev("timeupdate");
		}, 400);
		setTimeout(function () {
			st(dur);
			ev("timeupdate");
			ev("ended");
			v.__cqnLock = false;
			setTimeout(goNext, 1200);
		}, 650);
	}

	function patchBody(body) {
		if (!body) return body;
		try {
			var P = {
				watchedUpTo: 999999,
				watchedUpto: 999999,
				videoPosition: 999999,
				currentTime: 999999,
				position: 999999,
				percentWatched: 1,
				percentageWatched: 100,
				video_position: 999999,
				video_percent: 100,
				watched_seconds: 999999,
				percent_watched: 100,
				videoProgress: 1,
				progress: 1,
				isCompleted: true,
				is_completed: true,
				completed: true,
				watched: true,
			};
			var obj = JSON.parse(body);
			(function deep(o) {
				if (!o || typeof o !== "object") return;
				Object.keys(P).forEach(function (k) {
					if (k in o) o[k] = P[k];
				});
				Object.values(o).forEach(deep);
			})(obj);
			return JSON.stringify(obj);
		} catch (x) {
			return body;
		}
	}

	function getCSRF() {
		var parts = document.cookie.split(";");
		for (var i = 0; i < parts.length; i++) {
			var eq = parts[i].indexOf("=");
			if (eq < 0) continue;
			if (/csrf/i.test(parts[i].slice(0, eq).trim()))
				return decodeURIComponent(parts[i].slice(eq + 1).trim());
		}
		return null;
	}

	function getUserId() {
		for (var i = 0; i < batches.length; i++) {
			try {
				var evts = JSON.parse(batches[i].body).events || [];
				for (var j = 0; j < evts.length; j++) {
					if (evts[j].userId) return String(evts[j].userId);
					if (evts[j].value && evts[j].value.user_id)
						return String(evts[j].value.user_id);
				}
			} catch (x) {}
		}
		for (var k = 0; k < others.length; k++) {
			try {
				var b = JSON.parse(others[k].body || "{}");
				if (b.userId) return String(b.userId);
			} catch (x) {}
			var m = (others[k].body || "").match(/"userId"\s*:\s*(\d+)/);
			if (m) return m[1];
		}
		try {
			var s = JSON.stringify(window.__PRELOADED_STATE__ || {});
			var match = s.match(/"userId"\s*:\s*"?(\d+)"?/);
			if (match) return match[1];
		} catch (x) {}
		return "";
	}

	var cidCache = {};
	async function getCourseId(slug) {
		if (cidCache[slug]) return cidCache[slug];
		try {
			var r = await realFetch(
				"/api/courses.v1?q=slug&slug=" +
					encodeURIComponent(slug) +
					"&fields=id",
				{ credentials: "include" },
			);
			var d = await r.json();
			var id = (d && d.elements && d.elements[0] && d.elements[0].id) || "";
			if (id) cidCache[slug] = id;
			return id;
		} catch (x) {
			return "";
		}
	}

	function makeGuid() {
		return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
			/[xy]/g,
			function (c) {
				var r = (Math.random() * 16) | 0;
				return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
			},
		);
	}

	var nativeRate = Object.getOwnPropertyDescriptor(
		HTMLMediaElement.prototype,
		"playbackRate",
	);
	var nativeTime = Object.getOwnPropertyDescriptor(
		HTMLMediaElement.prototype,
		"currentTime",
	);

	Object.defineProperty(HTMLMediaElement.prototype, "playbackRate", {
		get: function () {
			return nativeRate.get.call(this);
		},
		set: function (v) {
			var floor = parseFloat(settings.playbackSpeed) || 2;
			nativeRate.set.call(this, v > 0 && v < floor ? floor : v);
		},
		configurable: true,
	});

	var nativePause = HTMLMediaElement.prototype.pause;
	HTMLMediaElement.prototype.pause = function () {
		if (this.__cqnLock) return;
		if (settings.marathonMode && !this.__userPaused) return;
		return nativePause.apply(this, arguments);
	};

	var hooked = new WeakSet();

	function applyToVideos() {
		document.querySelectorAll("video").forEach(hookVideo);
	}

	function hookVideo(v) {
		forceSpeed(v);
		if (hooked.has(v)) return;
		hooked.add(v);

		if (settings.unlockSeeking) {
			["seeking", "seeked"].forEach(function (evt) {
				v.addEventListener(
					evt,
					function (e) {
						e.stopImmediatePropagation();
					},
					{ capture: true },
				);
			});
		}

		v.addEventListener(
			"pause",
			function () {
				if (v.__userPaused || v.__cqnLock) return;
				if (!settings.autoPlay && !settings.marathonMode) return;
				setTimeout(function () {
					if (v.paused && !v.__userPaused) v.play().catch(function () {});
				}, 350);
			},
			{ capture: true },
		);

		v.addEventListener("click", function () {
			v.__userPaused = !v.paused;
		});

		v.addEventListener("ended", function () {
			v.__userPaused = false;
			if (!settings.marathonMode && settings.autoAdvance)
				setTimeout(goNext, 1200);
		});

		v.addEventListener(
			"ratechange",
			function () {
				forceSpeed(v);
			},
			{ capture: true },
		);
		v.addEventListener("loadedmetadata", function () {
			forceSpeed(v);
			if (settings.marathonMode) {
				v.__userPaused = false;
				v.play().catch(function () {});
			}
		});
	}

	function forceSpeed(v) {
		var t = parseFloat(settings.playbackSpeed) || 2;
		try {
			if (Math.abs(nativeRate.get.call(v) - t) > 0.05)
				nativeRate.set.call(v, t);
		} catch (x) {}
	}

	function showCompleteBanner() {
		var old = document.getElementById("cqn-done");
		if (old) old.remove();
		var style = document.createElement("style");
		style.textContent =
			"@keyframes cqnPop{from{opacity:0;transform:translate(-50%,-14px)}to{opacity:1;transform:translate(-50%,0)}}";
		document.head.appendChild(style);
		var el = document.createElement("div");
		el.id = "cqn-done";
		el.style.cssText =
			"position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:99999;" +
			"background:linear-gradient(135deg,#14532d,#166534);color:#fff;" +
			"font-family:Inter,system-ui,sans-serif;padding:13px 22px 13px 16px;" +
			"border-radius:14px;display:flex;align-items:center;gap:12px;" +
			"box-shadow:0 8px 32px rgba(0,0,0,.5);animation:cqnPop .35s ease;";
		el.innerHTML =
			'<span style="font-size:26px">🎓</span>' +
			'<div><div style="font-size:14px;font-weight:700">Course Complete!</div>' +
			'<div style="font-size:11px;opacity:.75;margin-top:2px">Marathon finished — all items done</div></div>' +
			"<button onclick=\"document.getElementById('cqn-done').remove()\" " +
			'style="margin-left:10px;background:rgba(255,255,255,.15);border:none;color:#fff;' +
			'border-radius:7px;padding:4px 10px;cursor:pointer;font-weight:600;font-size:13px">✕</button>';
		document.body.appendChild(el);
		setTimeout(function () {
			if (el.parentNode) el.remove();
		}, 10000);
	}

	function goNext() {
		dismissOverlays();
		var sels = [
			'[data-testid="forward-navigation-button"]',
			'[data-testid="next-item-button"]',
			'[data-e2e="forward-arrow"]',
			'[data-e2e="next-item-link"]',
			'[data-track-component="next_item_button"]',
			'button[aria-label*="Next" i]',
			'a[aria-label*="Next" i]',
			'[class*="NextButton"]',
			'[class*="next-button"]',
			'button[data-testid*="next" i]',
		];
		for (var i = 0; i < sels.length; i++) {
			var el = document.querySelector(sels[i]);
			if (el && el.offsetParent !== null && !el.disabled) {
				el.click();
				return true;
			}
		}
		var all = document.querySelectorAll("button, a[href]");
		for (var j = 0; j < all.length; j++) {
			if (
				all[j].offsetParent &&
				/^\s*(next|continue)\s*$/i.test(all[j].textContent.trim())
			) {
				all[j].click();
				return true;
			}
		}
		return false;
	}

	function dismissOverlays() {
		var sels = [
			'[data-track-component="skip_countdown"]',
			'button[aria-label*="Skip" i]',
			'[class*="CountdownSkip"]',
			'[data-testid*="skip" i]',
			".rc-VideoNextItemOverlay button",
			'[class*="NextItemOverlay"] button',
		];
		sels.forEach(function (s) {
			try {
				var el = document.querySelector(s);
				if (el) el.click();
			} catch (x) {}
		});
	}

	setInterval(function () {
		applyToVideos();
		dismissOverlays();
		if (settings.marathonMode) {
			var v = document.querySelector("video");
			if (v && v.paused && !v.__userPaused && !v.__cqnLock && !v.ended)
				v.play().catch(function () {});
		}
	}, 900);

	var lastUrl = location.href;
	new MutationObserver(function () {
		applyToVideos();
		if (location.href !== lastUrl) {
			lastUrl = location.href;
			batches.length = 0;
			others.length = 0;
			window.__cqnCapturedCount = 0;
			runner._hookedVids = new WeakSet();
			runner._apiReadyFired = false;
			setTimeout(applyToVideos, 1500);
			if (runner.active) {
				clearTimeout(runner._timer);
				runner._timer = setTimeout(function () {
					runner._tick();
				}, 2200);
			}
		}
	}).observe(document.documentElement, { childList: true, subtree: true });
})();
