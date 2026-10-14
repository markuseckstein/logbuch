import { useState, useSyncExternalStore } from 'react';
import { Dialog } from './components/Dialog';

/** Chromium-Ereignis (Android, Desktop-Chrome/Edge); fehlt in lib.dom. iOS/Safari bieten es nicht an. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface InstallState {
  offer?: BeforeInstallPromptEvent;
  installed: boolean;
}

let state: InstallState = { installed: false };
const listeners = new Set<() => void>();
function set(next: InstallState): void {
  state = next;
  listeners.forEach((l) => l());
}

function onBeforeInstall(ev: Event): void {
  // Keine Mini-Infobar des Browsers: installiert wird nur über den Button
  ev.preventDefault();
  set({ ...state, offer: ev as BeforeInstallPromptEvent });
}

function onInstalled(): void {
  set({ installed: true });
}

let captured = false;
/** Früh (main.tsx) aufrufen: Das Ereignis kommt einmal pro Seitenaufruf, oft vor dem ersten Rendern. */
export function captureInstallPrompt(): void {
  if (captured) return;
  captured = true;
  window.addEventListener('beforeinstallprompt', onBeforeInstall);
  window.addEventListener('appinstalled', onInstalled);
}

export function resetInstallPromptForTest(): void {
  window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  window.removeEventListener('appinstalled', onInstalled);
  captured = false;
  set({ installed: false });
}

function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches === true
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * „App installieren“: öffnet den Installationsdialog des Browsers, wenn er ihn anbietet (Chrome/Android, einmal pro
 * Seitenaufruf); sonst eine kurze Anleitung (iPhone, Kriterien nicht erfüllt). Als App gestartet: nichts.
 */
export function InstallButton({ className = 'btn sm' }: { className?: string }) {
  const { offer, installed } = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
  const [help, setHelp] = useState(false);
  if (installed || isStandalone()) return null;

  const click = (): void => {
    if (!offer) {
      setHelp(true);
      return;
    }
    set({ ...state, offer: undefined }); // prompt() geht pro Ereignis nur einmal
    void offer.prompt().catch(() => setHelp(true));
  };
  return (
    <>
      <button className={className} type="button" onClick={click}>
        App installieren
      </button>
      {help ? (
        <Dialog title="App installieren" onClose={() => setHelp(false)}>
          <p>
            <b>Android (Chrome):</b> Menü ⋮ → „App installieren“ oder „Zum Startbildschirm hinzufügen“.
          </p>
          <p>
            <b>iPhone (Safari):</b> Teilen-Symbol → „Zum Home-Bildschirm“.
          </p>
          <button className="btn primary block" type="button" onClick={() => setHelp(false)}>
            OK
          </button>
        </Dialog>
      ) : null}
    </>
  );
}
