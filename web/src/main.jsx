import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../styles/tailwind-input.css';
import App from './ui/App.jsx';

createRoot(document.getElementById('root')).render(<App />);

// Offline support only in production builds: the dev server has no /sw.js.
if (import.meta.env.PROD) {
  import('./offline/register.js').then(({ registerOffline }) => registerOffline()).catch(() => {});
}