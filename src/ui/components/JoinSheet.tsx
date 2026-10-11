import { buildJoinUrl, type Trip } from '../../domain';
import type { PersonInfo } from '../../db/cloud';
import { Icon } from '../icons';
import { useToast } from '../toast';
import { QrCode } from './QrCode';
import { Sheet } from './Sheet';

/** Link zum Beitreten dieser App-Installation (Basis-Pfad aus Vite). */
export const joinUrlFor = (tripId: string): string => buildJoinUrl(location.origin, import.meta.env.BASE_URL, tripId);

/** Admin: QR-Code und Link zum Beitreten; die Crew meldet sich mit der eingetragenen E-Mail an. */
export function JoinSheet({ trip, people, onClose }: { trip: Trip; people: readonly PersonInfo[]; onClose: () => void }) {
  const toast = useToast();
  const url = joinUrlFor(trip.id);
  const nobody = !people.some((p) => !p.self && p.email);
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
      title="Zum Törn einladen"
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
        <QrCode text={url} label={`QR-Code zum Beitreten: ${trip.name}`} />
        <p className="join-link mono" data-testid="join-link">
          {url}
        </p>
        <p>Crew scannt den Code, meldet sich mit der E-Mail an, die du eingetragen hast – fertig.</p>
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
