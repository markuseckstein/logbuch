import { createContext, useContext } from 'react';

export type TabId = 'today' | 'days' | 'map' | 'trip';

export interface AppActions {
  /** Öffnet das Eintrag-Sheet; isNew = gerade per „Eintrag jetzt“ angelegt. */
  openEntry: (entryId: string, isNew?: boolean) => void;
  goTo: (tab: TabId) => void;
  /** Öffnet den Assistenten „Neuer Törn“. */
  startOnboarding: () => void;
  /** Öffnet den Karte-Tab und setzt Fokus/Scroll auf den Live-Route-Schalter (Tipp auf REC). */
  focusLiveToggle: () => void;
}

const noop = (): void => undefined;

export const AppContext = createContext<AppActions>({ openEntry: noop, goTo: noop, startOnboarding: noop, focusLiveToggle: noop });

export const useApp = (): AppActions => useContext(AppContext);
