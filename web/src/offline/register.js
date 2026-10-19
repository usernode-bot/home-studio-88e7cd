// Offline support: registers the service worker in production builds and
// hands it the page's own URL, so it can cache the shell (the worker itself
// has no token; the page fetch carries one). Also an online/offline hook.

export function registerOffline(onOffline) {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').then((reg) => {
    const post = () => {
      const sw = reg.active || navigator.serviceWorker.controller;
      if (sw) sw.postMessage({ type: 'cache-shell', url: location.href });
    };
    if (reg.active) post();
    navigator.serviceWorker.addEventListener('controllerchange', post);
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (nw) nw.addEventListener('statechange', () => nw.state === 'activated' && post());
    });
  }).catch(() => { /* a frame denied storage: the app still works online */ });

  if (onOffline) {
    const notify = () => onOffline(!navigator.onLine);
    window.addEventListener('online', notify);
    window.addEventListener('offline', notify);
    notify();
  }
}