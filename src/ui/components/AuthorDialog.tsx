import { activeCrew, ROLE_LABELS, type CrewMember, type ID, type Trip } from '../../domain';
import { Dialog } from './Dialog';

interface AuthorDialogProps {
  trip: Pick<Trip, 'crew' | 'boat'>;
  onPick: (crewId: ID) => void;
  /** Ohne Auswahl fortfahren (Eintrag bleibt ohne Autor). */
  onSkip: () => void;
  /** Escape: Vorgang abbrechen. */
  onCancel: () => void;
}

/** „Ich bin …“: kurze Rückfrage mit der Crew-Liste, bevor auf diesem Gerät geschrieben wird. */
export function AuthorDialog({ trip, onPick, onSkip, onCancel }: AuthorDialogProps) {
  const crew: CrewMember[] = activeCrew(trip);
  return (
    <Dialog title="Wer schreibt auf diesem Gerät?" onClose={onCancel}>
      <p className="muted">
        Ich bin … – damit Einträge und Tagesbericht im Logbuch „{trip.boat.name}“ deinem Namen zugeordnet werden.
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
