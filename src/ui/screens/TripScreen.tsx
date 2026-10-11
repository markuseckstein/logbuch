import { useState } from 'react';
import { resizeImage } from '../../device';
import { db } from '../../db/db';
import { setActiveTrip, setBoatPhoto, updateTrip } from '../../db/repo';
import { formatDateLong, type CrewMember, type Trip } from '../../domain';
import { useApp } from '../AppContext';
import { useTrips } from '../hooks';
import { useToast } from '../toast';
import { BoatPicture } from '../components/BoatPicture';
import { ExportCard } from '../components/ExportCard';
import { CrewEditor } from '../components/CrewEditor';
import {
  BoatFields,
  TripFields,
  boatDraftOf,
  boatOf,
  tripDraftOf,
  tripPatchOf,
  validateTrip,
} from '../components/TripFields';

function TripDataCard({ trip }: { trip: Trip }) {
  const toast = useToast();
  const [draft, setDraft] = useState(() => tripDraftOf(trip));
  const [error, setError] = useState<string>();

  const save = async (): Promise<void> => {
    const msg = validateTrip(draft);
    setError(msg);
    if (msg) return;
    await updateTrip(db, trip.id, tripPatchOf(draft));
    toast('Törndaten gespeichert');
  };

  return (
    <section className="card" aria-label="Törndaten">
      <div className="legend">Törndaten</div>
      <TripFields value={draft} onChange={setDraft} />
      {error ? (
        <div className="err" role="alert">
          {error}
        </div>
      ) : null}
      <button className="btn block" type="button" onClick={() => void save()}>
        Törndaten speichern
      </button>
    </section>
  );
}

function BoatCard({ trip }: { trip: Trip }) {
  const toast = useToast();
  const [draft, setDraft] = useState(() => boatDraftOf(trip.boat));
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    await updateTrip(db, trip.id, { boat: boatOf(draft, trip.boat.photoId) });
    toast('Boot gespeichert');
  };

  const pick = async (file: File): Promise<void> => {
    setBusy(true);
    try {
      await setBoatPhoto(db, trip.id, await resizeImage(file));
      toast('Bootsfoto übernommen');
    } catch {
      toast('Foto konnte nicht gespeichert werden');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-label="Boot">
      <div className="legend">Boot</div>
      <BoatPicture photoId={trip.boat.photoId} busy={busy} onPick={(f) => void pick(f)} />
      <BoatFields value={draft} onChange={setDraft} />
      <button className="btn block" type="button" onClick={() => void save()}>
        Boot speichern
      </button>
    </section>
  );
}

function CrewCard({ trip }: { trip: Trip }) {
  const toast = useToast();
  const change = (crew: CrewMember[]): void => {
    const removed = trip.crew.find((m) => !crew.some((c) => c.id === m.id));
    const added = crew.find((c) => !trip.crew.some((m) => m.id === c.id));
    void updateTrip(db, trip.id, { crew }).then(() => {
      if (removed) toast(`${removed.name} entfernt`);
      else if (added) toast(`${added.name} zur Crew hinzugefügt`);
    });
  };
  return (
    <section className="card" aria-label="Crew">
      <div className="legend">Crew</div>
      <CrewEditor crew={trip.crew} onChange={change} />
    </section>
  );
}

function TripList({ trips, activeId }: { trips: readonly Trip[]; activeId: string }) {
  const toast = useToast();
  return (
    <section className="card" aria-label="Alle Törns">
      <div className="legend">Alle Törns</div>
      <ul className="triplist">
        {trips.map((t) => (
          <li key={t.id}>
            <span className="triplist-name">
              <b>{t.name}</b>
              <span className="dmeta">{t.startDate ? formatDateLong(t.startDate) : 'ohne Datum'}</span>
            </span>
            {t.id === activeId ? (
              <span className="role">Aktiv</span>
            ) : (
              <button
                className="btn"
                type="button"
                aria-label={`Zu „${t.name}“ wechseln`}
                onClick={() => void setActiveTrip(db, t.id).then(() => toast(`Törn „${t.name}“ aktiv`))}
              >
                Wechseln
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TripScreen({ trip }: { trip: Trip }) {
  const { startOnboarding } = useApp();
  const trips = useTrips();
  return (
    <main className="screen" aria-labelledby="screen-title">
      <h2 id="screen-title">Törn</h2>
      {trips && trips.length > 1 ? <TripList trips={trips} activeId={trip.id} /> : null}
      <TripDataCard key={`data-${trip.id}`} trip={trip} />
      <BoatCard key={`boat-${trip.id}`} trip={trip} />
      <CrewCard trip={trip} />
      <ExportCard trip={trip} />
      <button className="btn block" type="button" onClick={startOnboarding}>
        Neuen Törn anlegen …
      </button>
    </main>
  );
}
