import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/source-sans-3/400.css';
import '@fontsource/source-sans-3/600.css';
import '@fontsource/source-sans-3/700.css';
import './ui/theme.css';
import './ui/app.css';
import { deleteLegacyDb } from './db/legacy';
import { App } from './ui/App';
import { captureInstallPrompt } from './ui/InstallButton';
import { captureJoinFromUrl } from './ui/cloud/joinState';
import { captureHomeViewFromUrl } from './ui/homeView/state';

void deleteLegacyDb();
captureInstallPrompt();
captureJoinFromUrl();
captureHomeViewFromUrl();
// Daheim-Link in einen schon offenen Tab eingefügt: nur der Hash ändert sich, kein Neuladen
window.addEventListener('hashchange', captureHomeViewFromUrl);

// Nur im Entwicklungsserver: Zugriff für manuelle Spikes/Debugging (nie im Produktions-Build).
if (import.meta.env.DEV) {
  void Promise.all([import('./db/db'), import('./db/repo'), import('./db/cloud')]).then(([d, repo, cloud]) => {
    Object.assign(window, { __logbook: { db: d.db, repo, cloud } });
  });
}

const root = document.getElementById('root');
if (!root) throw new Error('Root-Element fehlt');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
