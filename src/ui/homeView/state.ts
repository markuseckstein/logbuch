import { useSyncExternalStore } from 'react';
import { parseHomeViewHash } from '../../domain';

/**
 * Daheim-Link (`#daheim=<token>`): Token in localStorage merken (überlebt Neustart und Anmeldung, die IndexedDB
 * leert), aus der Adresse entfernen. Ein abgeschnittener/kaputter Token wird als `INVALID_TOKEN` gemerkt, damit die
 * Ansicht „nicht mehr gültig“ zeigt statt der normalen App.
 */
const KEY = 'logbook.daheim';
const HASH_KEY = 'daheim';
export const INVALID_TOKEN = '-';

function load(): string | undefined {
  try {
    return localStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function persist(token: string | undefined): void {
  try {
    if (token === undefined) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, token);
  } catch {
    // Speicher gesperrt (privates Fenster): gilt dann nur bis zum Neuladen
  }
}

let token: string | undefined = load();
const listeners = new Set<() => void>();
function set(t: string | undefined): void {
  token = t;
  persist(t);
  listeners.forEach((l) => l());
}

/** `#daheim=` aus der Adresse übernehmen und aus der URL entfernen (andere Hash-Teile bleiben). */
export function captureHomeViewFromUrl(): void {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (!params.has(HASH_KEY)) return;
  set(parseHomeViewHash(location.hash) ?? INVALID_TOKEN);
  params.delete(HASH_KEY);
  const rest = params.toString();
  history.replaceState(history.state, '', location.pathname + location.search + (rest ? `#${rest}` : ''));
}

/** Daheim-Ansicht verlassen bzw. „Abbrechen“ beim Hinweis auf ein anderes Konto. */
export function clearHomeViewToken(): void {
  set(undefined);
}

export function useHomeViewToken(): string | undefined {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => token,
  );
}
