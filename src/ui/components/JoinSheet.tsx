import { buildJoinUrl, type Trip } from '../../domain';
import type { PersonInfo } from '../../db/cloud';
import { Icon } from '../icons';
import { useToast } from '../toast';
import { QrCode } from './QrCode';
import { Sheet } from './Sheet';

/** Link zum Beitreten dieser App-Installation (Basis-Pfad aus Vite). */
export const joinUrlFor = (tripId: string, email?: string): string =>
  buildJoinUrl(location.origin, import.meta.env.BASE_URL, tripId, email);

/**
 * Admin: QR-Code und Link zum Beitreten; die Crew meldet sich mit der eingetragenen E-Mail an.
 * Mit `person` ist der Code persönlich (E-Mail im Link, Anmelde-Dialog vorausgefüllt).
 */
export function JoinSheet({
  trip,
  people,
  person,
  onClose,
}: {
  trip: Trip;
  people: readonly PersonInfo[];
  person?: PersonInfo | undefined;
  onClose: () => void;
}) {
  const toast = useToast();
  const url = joinUrlFor(trip.id, person?.email);
  const nobody = person === undefined && !people.some((p) => !p.self && p.email);
  const share = async (): Promise<void> => {
    const data = { title: `Logbuch: ${trip.name}`, text: `Tritt dem Törn „${trip.name}“ bei:`, url };
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share(data);
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Link in die Zwischenablage kopiert');
    } catch {
      toast('Link konnte nicht kopiert werden – bitte markieren und kopieren');
    }
  };
  return (
    <Sheet
      title={person ? `QR-Code für ${person.name}` : 'Zum Törn einladen'}
      subtitle={trip.name}
      onClose={onClose}
      footer={
        <button className="btn primary block" type="button" onClick={() => void share()}>
          <Icon name="mail" size={20} />
          Link teilen
        </button>
      }
    >
      <div className="join-sheet">
        <QrCode text={url} label={person ? `QR-Code für ${person.name}: ${trip.name}` : `QR-Code zum Beitreten: ${trip.name}`} />
        <p className="join-link mono" data-testid="join-link">
          {url}
        </p>
        {person ? (
          <p>
            {person.name} scannt den Code und meldet sich an – die E-Mail ist schon eingetragen. Funktioniert auch später
            wieder zum erneuten Anmelden.
          </p>
        ) : (
          <p>Crew scannt den Code, meldet sich mit der E-Mail an, die du eingetragen hast – fertig.</p>
        )}
        {nobody ? (
          <p className="muted" role="note">
            Noch niemand eingetragen. Trage zuerst die E-Mail-Adressen deiner Crew ein – nur eingetragene Adressen können
            beitreten.
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
