'use strict';

const DEFAULTS = { autoAdvance: true, unlockSeeking: true, playbackSpeed: 2, autoPlay: true, skipWaiting: true };
const TOGGLES  = ['autoAdvance', 'unlockSeeking', 'autoPlay', 'skipWaiting'];

let _running = false;

chrome.storage.sync.get(DEFAULTS, s => {
  TOGGLES.forEach(id => { const el = document.getElementById(id); if (el) el.checked = !!s[id]; });
  const sr = document.getElementById('speedRange');
  const sl = document.getElementById('speedLbl');
  if (sr) sr.value = s.playbackSpeed ?? 2;
  if (sl) sl.textContent = (s.playbackSpeed ?? 2) + '×';
});

TOGGLES.forEach(id =>
  document.getElementById(id)?.addEventListener('change', e =>
    chrome.storage.sync.set({ [id]: e.target.checked })
  )
);

const sr = document.getElementById('speedRange');
const sl = document.getElementById('speedLbl');
sr?.addEventListener('input', () => {
  const v = parseFloat(sr.value);
  if (sl) sl.textContent = v + '×';
  chrome.storage.sync.set({ playbackSpeed: v });
});

function poll() {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab?.id) return;
    chrome.scripting.executeScript(
      { target: { tabId: tab.id }, world: 'MAIN', func: () => typeof window.__cqnState === 'function' ? window.__cqnState() : null },
      results => {
        if (chrome.runtime.lastError) return;
        const st = results?.[0]?.result;
        if (!st) { setBadge(false, 'Reload the page — extension not active'); return; }
        const n = st.capturedCount || 0;
        setBadge(n > 0, n > 0 ? `${n} API call${n !== 1 ? 's' : ''} captured — ready` : 'Play a video to capture API calls');
        renderMarathon(st);
        if (st.courseComplete) showDoneStrip();
      }
    );
  });
}

function setBadge(ok, msg) {
  const el = document.getElementById('capBadge');
  const tx = document.getElementById('capText');
  if (el) el.className = 'cap-badge' + (ok ? '' : ' off');
  if (tx) tx.textContent = msg;
}

function showDoneStrip() {
  const el = document.getElementById('doneStrip');
  if (el) el.className = 'done-strip show';
}

function renderMarathon(st) {
  const on      = !!st.marathon;
  const status  = st.marathonStatus || 'idle';
  const done    = status === 'done';
  const item    = st.marathonItem || '';
  const videos  = st.videosPlayed  ?? 0;
  const skipped = st.itemsSkipped  ?? 0;
  const api     = st.capturedCount ?? 0;

  _running = on;

  const pill = document.getElementById('mPill');
  if (pill) {
    if (done) {
      pill.className = 'm-pill done'; pill.textContent = 'DONE';
    } else {
      pill.className = 'm-pill' + (on ? (status === 'skipping' ? ' skp' : ' on') : '');
      pill.textContent = on ? (status === 'skipping' ? 'SKIPPING' : 'RUNNING') : 'IDLE';
    }
  }

  const cur = document.getElementById('mCur');
  if (cur) {
    if (done) {
      cur.textContent = '🎓 Course complete!'; cur.className = 'm-cur done';
    } else if (on && item) {
      cur.textContent = (status === 'playing' ? '▶ ' : '⏭ ') + decodeURIComponent(item).replace(/-/g, ' ');
      cur.className = 'm-cur live';
    } else if (on) {
      cur.textContent = 'Loading…'; cur.className = 'm-cur live';
    } else {
      cur.textContent = 'Not running'; cur.className = 'm-cur';
    }
  }

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('mVid',  videos);
  set('mSkip', skipped);
  set('mApi',  api);

  const bar = document.getElementById('mBar');
  if (bar) {
    const total = videos + skipped;
    const pct = done ? 100 : (on && total > 0 ? Math.min(99, Math.round(videos / total * 100)) : 0);
    bar.style.width = pct + '%';
  }

  const btn = document.getElementById('btnMarathon');
  if (btn) {
    btn.textContent = on ? '■  Stop Marathon' : '▶  Start Video Marathon';
    btn.className   = on ? 'btn-run stop' : 'btn-run';
  }
}

poll();
const tid = setInterval(poll, 1400);
window.addEventListener('unload', () => clearInterval(tid));

function send(action, quiet) {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab?.id) return;
    chrome.tabs.sendMessage(tab.id, { action }, () => { chrome.runtime.lastError; });
  });
  if (!quiet) toast('✓ Done!');
}

function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.style.display = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 1800);
}

document.getElementById('btnMarathon')?.addEventListener('click', () => {
  const ds = document.getElementById('doneStrip');
  if (_running) {
    send('marathonStop', true);
    _running = false;
    toast('■ Stopped');
    renderMarathon({ marathon: false, marathonStatus: 'idle', capturedCount: 0, videosPlayed: 0, itemsSkipped: 0 });
    if (ds) ds.className = 'done-strip';
  } else {
    send('marathonStart', true);
    _running = true;
    toast('▶ Marathon started!');
    if (ds) ds.className = 'done-strip';
    const pill = document.getElementById('mPill');
    const btn  = document.getElementById('btnMarathon');
    if (pill) { pill.className = 'm-pill on'; pill.textContent = 'RUNNING'; }
    if (btn)  { btn.textContent = '■  Stop Marathon'; btn.className = 'btn-run stop'; }
  }
});

document.getElementById('btnNext')   ?.addEventListener('click', () => send('nextLesson'));
document.getElementById('btnSkipEnd')?.addEventListener('click', () => send('skipToNearEnd'));
