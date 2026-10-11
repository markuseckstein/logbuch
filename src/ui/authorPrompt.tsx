import { useSyncExternalStore } from 'react';
import { chooseAuthor } from './cloud/identity';
import type { ID, Trip } from '../domain';
import { AuthorDialog } from './components/AuthorDialog';

let requested: ID | undefined;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((l) => l());

/** Bittet die App, „Ich bin …“ für dieses Logbuch zu erfragen, sobald es aktiv ist (überlebt den Wechsel des Törns). */
export function requestAuthorPrompt(tripId: ID): void {
  requested = tripId;
  emit();
}

function useRequested(): ID | undefined {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => requested,
  );
}

/** Zeigt den „Ich bin …“-Dialog, wenn er für den aktiven Törn angefordert wurde. */
export function AuthorPromptHost({ trip }: { trip: Trip }) {
  const id = useRequested();
  if (id !== trip.id) return null;
  const done = (): void => {
    requested = undefined;
    emit();
  };
  return (
    <AuthorDialog
      trip={trip}
      onPick={(crewId) => void chooseAuthor(trip, crewId).then(done)}
      onSkip={done}
      onCancel={done}
    />
  );
}
