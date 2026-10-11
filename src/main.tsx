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

void deleteLegacyDb();

const root = document.getElementById('root');
if (!root) throw new Error('Root-Element fehlt');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
