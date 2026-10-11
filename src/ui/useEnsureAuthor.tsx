import { useCallback, useState, type ReactNode } from 'react';
import { db } from '../db/db';
import { getAuthor, listCrew, setAuthor } from '../db/repo';
import { chooseAuthor } from './cloud/identity';
import { activeCrew, type Trip } from '../domain';
import { AuthorDialog } from './components/AuthorDialog';

/**
 * Stellt vor dem Schreiben sicher, dass „Ich bin …“ gesetzt ist: eine Crew-Person → automatisch,
 * mehrere → Rückfrage per Dialog (`dialog` muss gerendert werden). `ensure()` löst auf, sobald entschieden ist.
 */
export function useEnsureAuthor(trip: Trip): { ensure: () => Promise<boolean>; dialog: ReactNode } {
  const [waiting, setWaiting] = useState<(proceed: boolean) => void>();

  const ensure = useCallback(async (): Promise<boolean> => {
    const crew = activeCrew(await listCrew(db, trip.id));
    const current = await getAuthor(db, trip.id);
    if (current && crew.some((c) => c.id === current)) return true;
    const [only] = crew;
    if (crew.length === 0) return true;
    if (crew.length === 1 && only) {
      await setAuthor(db, trip.id, only.id);
      return true;
    }
    return new Promise<boolean>((resolve) => setWaiting(() => resolve));
  }, [trip]);

  const finish = (proceed: boolean): void => {
    waiting?.(proceed);
    setWaiting(undefined);
  };

  const dialog = waiting ? (
    <AuthorDialog
      trip={trip}
      onPick={(id) => {
        void chooseAuthor(trip, id).then(() => finish(true));
      }}
      onSkip={() => finish(true)}
      onCancel={() => finish(false)}
    />
  ) : null;

  return { ensure, dialog };
}
