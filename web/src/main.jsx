import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../styles/tailwind-input.css';
import App from './ui/App.jsx';

createRoot(document.getElementById('root')).render(<App />);

// Offline after the first visit: the service worker (web/sw.js, written to
// dist/sw.js by the build) keeps the app's files. Registration can fail in
// a third-party frame; the app then simply needs a connection to open.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
  // A new worker taking over means a new build arrived while this page was
  // open. Reload once, so the page never runs against hashed chunks the
  // updated cache no longer holds. The first claim (no controller yet)
  // is not an update and does not reload.
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }
    window.location.reload();
  });
}
