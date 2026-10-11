import { activeCrew, ROLE_LABELS, type CrewMember, type ID, type Trip } from '../../domain';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { listCrew } from '../../db/repo';
import { Dialog } from './Dialog';

interface AuthorDialogProps {
  trip: Pick<Trip, 'id' | 'name'>;
  onPick: (crewId: ID) => void;
  /** Ohne Auswahl fortfahren (Eintrag bleibt ohne Autor). */
  onSkip: () => void;
  /** Escape: Vorgang abbrechen. */
  onCancel: () => void;
}

/** „Ich bin …“: kurze Rückfrage mit der Crew-Liste, bevor auf diesem Gerät geschrieben wird. */
export function AuthorDialog({ trip, onPick, onSkip, onCancel }: AuthorDialogProps) {
  const loaded = useLiveQuery(() => listCrew(db, trip.id), [trip.id]);
  if (!loaded) return null; // erst zeigen, wenn die Crew geladen ist (kein leerer Dialog)
  const crew: CrewMember[] = activeCrew(loaded);
  return (
    <Dialog title="Wer schreibt auf diesem Gerät?" onClose={onCancel}>
      <p className="muted">
        Ich bin … – damit Einträge und Tagesbericht im Törn „{trip.name}“ deinem Namen zugeordnet werden.
      </p>
      <ul className="choice-list">
        {crew.map((c) => (
          <li key={c.id}>
            <button className="btn block" type="button" onClick={() => onPick(c.id)}>
              {c.name}
              {c.role ? <span className="role">{ROLE_LABELS[c.role]}</span> : null}
            </button>
          </li>
        ))}
      </ul>
      <button className="btn block" type="button" onClick={onSkip}>
        Ohne Namen fortfahren
      </button>
    </Dialog>
  );
}
