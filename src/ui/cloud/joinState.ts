import { useSyncExternalStore } from 'react';
import { parseJoinParam, type ID } from '../../domain';

/**
 * Beitritt über Link (`?join=<tripId>`) bzw. „Ich wurde eingeladen“. Bleibt in sessionStorage erhalten, damit er
 * einen Seiten-Reload während der Anmeldung übersteht (nicht in `settings`: die Anmeldung kann lokale Tabellen leeren).
 */
export interface JoinState {
  /** Törn aus dem Link; fehlt, wenn nur „Ich wurde eingeladen“ gewählt wurde. */
  tripId?: ID;
}

const KEY = 'logbook.join';

function load(): JoinState | undefined {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as JoinState) : undefined;
  } catch {
    return undefined;
  }
}

function persist(s: JoinState | undefined): void {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    // Speicher gesperrt: der Zustand lebt dann nur im Speicher
  }
}

let state: JoinState | undefined = load();
const listeners = new Set<() => void>();
const set = (s: JoinState | undefined): void => {
  state = s;
  persist(s);
  listeners.forEach((l) => l());
};

/** Beitritt vormerken (Link oder Schaltfläche). */
export function startJoin(tripId?: ID): void {
  set(tripId === undefined ? { ...state } : { tripId });
}

export function clearJoin(): void {
  set(undefined);
}

/** `?join=` aus der Adresse übernehmen und aus der URL entfernen. */
export function captureJoinFromUrl(): void {
  const id = parseJoinParam(location.search);
  if (id === undefined) return;
  startJoin(id);
  const url = new URL(location.href);
  url.searchParams.delete('join');
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);
}

export function useJoin(): JoinState | undefined {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

// Annehmen läuft gerade / Ziel-Törn nach dem Annehmen (nur im Speicher).
export interface JoinProgress {
  accepting: boolean;
  target?: ID;
}
let progress: JoinProgress = { accepting: false };
const plisteners = new Set<() => void>();
export function setJoinProgress(p: JoinProgress): void {
  progress = p;
  plisteners.forEach((l) => l());
}
export function useJoinProgress(): JoinProgress {
  return useSyncExternalStore(
    (cb) => {
      plisteners.add(cb);
      return () => plisteners.delete(cb);
    },
    () => progress,
  );
}
