<div align="center">

<img src="icons/icon128.png" alt="Coursera Marathon" width="96" height="96" />

# Coursera Marathon Extension

**Blaze through Coursera courses at warp speed.**  
Auto-completes lectures, skips non-video items, and marks your progress — all hands-free.

[![Version](https://img.shields.io/badge/version-10.0.0-blue?style=flat-square&logo=googlechrome&logoColor=white)](https://github.com/Rahul-2314/coursera-marathon-extension/releases)
[![Manifest](https://img.shields.io/badge/Manifest-V3-green?style=flat-square)](https://developer.chrome.com/docs/extensions/mv3/)
[![License](https://img.shields.io/badge/license-MIT-orange?style=flat-square)](LICENSE)
[![Stars](https://img.shields.io/github/stars/Rahul-2314/coursera-marathon-extension?style=flat-square&color=yellow)](https://github.com/Rahul-2314/coursera-marathon-extension/stargazers)

[⚡ Install](#-installation) · [🏃 Features](#-features) · [🗺️ Roadmap](#%EF%B8%8F-roadmap) · [🙋 Support](#-support) · [☕ Donate](#-buy-me-a-coffee)

---

</div>

## ✨ What is this?

**Coursera Marathon** is a Chrome extension that automates your way through any Coursera course. It plays only video lectures (seeking to the last third so they complete fast), skips all non-video items like quizzes, readings, and assignments, and marks everything as complete via Coursera's own API — so your progress is real and saved.

Start the marathon, close the laptop lid, come back to a completed course.

---

## 📦 Installation

> **No Chrome Web Store needed.** Load it directly in 4 steps.

### Step 1 — Download the extension

**Option A — Clone with Git**
```bash
git clone https://github.com/Rahul-2314/coursera-marathon-extension.git
```

**Option B — Download ZIP**
1. Click the green **`<> Code`** button on this page
2. Select **Download ZIP**
3. Extract the folder anywhere on your computer

---

### Step 2 — Open Chrome Extensions

Open a new tab and go to:
```
chrome://extensions
```

Or navigate via **Menu → More Tools → Extensions**

---

### Step 3 — Enable Developer Mode & Load

1. Toggle **Developer mode** ON (top-right corner)
2. Click **Load unpacked**
3. Select the `coursera-marathon` folder you downloaded/cloned
4. The extension will appear in your list ✅

---

### Step 4 — Pin to toolbar

1. Click the **puzzle piece** 🧩 icon in Chrome's toolbar
2. Find **Coursera Quick Nav**
3. Click the **pin** 📌 icon next to it

The ⚡ icon will now always be visible in your toolbar.

---

## 🚀 Quick Start

1. Go to any **Coursera course** → open a lecture
2. Click the ⚡ icon in your toolbar
3. Hit **▶ Start Video Marathon**
4. Sit back — the extension handles everything

The popup shows live progress: videos played, items skipped, and API hits captured. When the last item is done, a 🎓 **Course Complete!** banner appears on screen.

---

## 🏃 Features

### 🎬 Video Marathon
| Feature | Detail |
|---|---|
| **Lecture-only playback** | Plays only `/lecture/` pages — skips everything else |
| **Auto seek to last third** | Jumps to 66% of video duration on load so it ends in seconds |
| **Speed enforcement** | Locks playback at your chosen speed (0.5× – 4×) — Coursera can't override it |
| **Auto-play** | Resumes automatically if Coursera pauses the video |
| **Smart course completion** | Detects end of course via URL tracking — stops cleanly with a banner |

### ⏭️ Smart Skipping
| Feature | Detail |
|---|---|
| **Skips all non-lectures** | Supplements, quizzes, exams, peer reviews, labs, discussions, assignments |
| **API completion marking** | Calls Coursera's own APIs to mark skipped items as complete |
| **No looping** | End-of-course watchdog (`_eocTimer`) detects when navigation stops — finishes gracefully |

### ⚡ Manual Controls
| Button | Action |
|---|---|
| **▶ Next Lesson** | Jump to the next item immediately |
| **⏩ +30s Skip** | Skip forward 30 seconds in the current video |

### 🎛️ Settings
| Toggle | What it does |
|---|---|
| **Auto-advance** | Automatically goes to next lesson when video ends |
| **Unlock seeking** | Lets you scrub freely in any video (bypasses Coursera's seek lock) |
| **Auto-play** | Resumes playback if Coursera pauses it |
| **Skip countdowns** | Auto-dismisses "Next in 5s…" overlay popups |
| **Playback speed** | Slider from 0.5× to 4× — enforced as a floor, Coursera can't go lower |

### 📡 API Progress Capture
The extension intercepts Coursera's own network calls and replays them with 100% completion values — the same data Coursera itself sends. Your progress shows up correctly in the dashboard.

---

## 🗺️ Roadmap

> Features planned for upcoming versions

- [ ] **Module-level control** — skip or play specific modules/weeks only
- [ ] **Resume from last position** — pick up exactly where marathon stopped
- [ ] **Course list view** — queue multiple courses and run them back to back
- [ ] **Estimated time remaining** — shows how long until course finishes
- [ ] **Graded quiz auto-submit** — auto-attempt and submit graded quizzes
- [ ] **Progress dashboard** — per-course stats saved across sessions
- [ ] **Firefox support** — Manifest V3 port for Firefox
- [ ] **Keyboard shortcuts** — start/stop marathon without opening popup
- [ ] **Notification on completion** — desktop notification when course finishes
- [ ] **Dark/light popup theme toggle**

---

## 🛠️ How It Works

```
┌─────────────────────────────────────────────────────┐
│                    Marathon Loop                     │
│                                                      │
│  ┌──────────┐   is /lecture/?   ┌────────────────┐  │
│  │  _tick() │ ─── YES ────────► │  _handleVideo  │  │
│  └──────────┘                   │  seek to 2/3   │  │
│       │                         │  wait for ended│  │
│       │ is skippable?           └───────┬────────┘  │
│       ├─── YES ──► _skipItem()          │            │
│       │            markComplete         │            │
│       │                                 │            │
│       └─── else ──► goNext()            │            │
│                                         ▼            │
│              goNext() ◄─────────────────┘            │
│                  │                                   │
│                  ▼                                   │
│          _watchForEnd()  ←── 9s watchdog             │
│          MutationObserver cancels it on nav          │
│          URL unchanged after 9s → _finishCourse()    │
└─────────────────────────────────────────────────────┘
```

The extension runs entirely in the **page's MAIN world** — no background service workers needed for core functionality. A lightweight `injector.js` in the ISOLATED world bridges Chrome storage settings and popup messages into the page.

---

## 🙋 Support

**Something not working?**

1. Make sure you're on `coursera.org` — the extension only activates there
2. Try refreshing the page and reopening the popup
3. If marathon starts from the beginning mid-course, stop and restart it from the current lecture

**Common issues:**

| Issue | Fix |
|---|---|
| "Play a video to capture API calls" always shows | Play any lecture manually first to let the extension capture network calls |
| Marathon stops early | Course may be genuinely complete — check the 🎓 banner |
| Speed not changing | Some Coursera players resist overrides — try toggling Auto-play off and on |
| Extension not visible | Make sure it's pinned (puzzle icon → pin it) |

**Still stuck?** [Open an issue →](https://github.com/Rahul-2314/coursera-marathon-extension/issues)

---

## 🤝 Contributing

Pull requests are welcome! If you have a feature idea or found a bug:

1. **Fork** the repo
2. Create a branch: `git checkout -b feat/your-feature`
3. Make your changes
4. **Open a PR** — describe what you changed and why

For big changes, open an issue first to discuss.

---

## ⭐ Show Your Support

If this extension saved you hours of watching videos, a star goes a long way:

[![Star on GitHub](https://img.shields.io/github/stars/Rahul-2314/coursera-marathon-extension?style=for-the-badge&logo=github&color=yellow)](https://github.com/Rahul-2314/coursera-marathon)

---

## ☕ Buy Me a Coffee

Building and maintaining this takes time. If you'd like to support continued development:

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Support-orange?style=for-the-badge&logo=buy-me-a-coffee&logoColor=white)](https://buymeacoffee.com/chowdhuryre)

---

## 📄 License

MIT © [Rahul Chowdhury](https://github.com/Rahul-2314)

---

<div align="center">

Made with ☕ and zero patience for slow video players

**[⬆ Back to top](#coursera-marathon-extension)**

</div>
