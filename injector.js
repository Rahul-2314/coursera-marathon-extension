// injector.js — ISOLATED world, document_start
// Injects main.js into the page's MAIN world before Coursera JS loads

(function () {
  // Inject main.js into page main world
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('main.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);

  // Relay settings from chrome.storage → page script
  chrome.storage.sync.get(null, (data) => {
    window.dispatchEvent(new CustomEvent('CQN_SETTINGS', { detail: data }));
  });

  chrome.storage.onChanged.addListener((changes) => {
    const delta = {};
    for (const [k, { newValue }] of Object.entries(changes)) delta[k] = newValue;
    window.dispatchEvent(new CustomEvent('CQN_SETTINGS', { detail: delta }));
  });

  // Relay commands from popup → page script
  chrome.runtime.onMessage.addListener((msg) => {
    window.dispatchEvent(new CustomEvent('CQN_CMD', { detail: msg }));
  });
})();
