import { useState, type ReactNode } from 'react';
import { resizeImage } from '../../device';
import { db } from '../../db/db';
import { deleteTrip, setActiveTrip, setAuthor, setBoatPhoto, updateTrip } from '../../db/repo';
import { activeCrew, formatDateLong, type CrewMember, type Trip } from '../../domain';
import { useApp } from '../AppContext';
import { Icon } from '../icons';
import { useAuthorId, useReadOnly, useSettings, useTrips } from '../hooks';
import { writeErrorMessage } from '../lib';
import { useToast } from '../toast';
import { BoatPicture } from '../components/BoatPicture';
import { Dialog } from '../components/Dialog';
import { ExportCard } from '../components/ExportCard';
import { FlotillaCard } from '../components/FlotillaCard';
import { OwnershipBadge } from '../components/OwnershipBadge';
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

/** Felder eines fremden Logbuchs: sichtbar, aber gesperrt. */
function Fields({ readOnly, children }: { readOnly: boolean; children: ReactNode }) {
  return readOnly ? (
    <fieldset className="ro" disabled>
      {children}
    </fieldset>
  ) : (
    <>{children}</>
  );
}

function TripDataCard({ trip, readOnly }: { trip: Trip; readOnly: boolean }) {
  const toast = useToast();
  const [draft, setDraft] = useState(() => tripDraftOf(trip));
  const [error, setError] = useState<string>();

  const save = async (): Promise<void> => {
    const msg = validateTrip(draft);
    setError(msg);
    if (msg) return;
    try {
      await updateTrip(db, trip.id, tripPatchOf(draft));
      toast('Törndaten gespeichert');
    } catch (e) {
      toast(writeErrorMessage(e, 'Törndaten konnten nicht gespeichert werden'));
    }
  };

  return (
    <section className="card" aria-label="Törndaten">
      <div className="legend">Törndaten</div>
      <Fields readOnly={readOnly}>
        <TripFields value={draft} onChange={setDraft} />
      </Fields>
      {error ? (
        <div className="err" role="alert">
          {error}
        </div>
      ) : null}
      {readOnly ? null : (
        <button className="btn block" type="button" onClick={() => void save()}>
          Törndaten speichern
        </button>
      )}
    </section>
  );
}

function BoatCard({ trip, readOnly }: { trip: Trip; readOnly: boolean }) {
  const toast = useToast();
  const [draft, setDraft] = useState(() => boatDraftOf(trip.boat));
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    try {
      await updateTrip(db, trip.id, { boat: boatOf(draft, trip.boat.photoId) });
      toast('Boot gespeichert');
    } catch (e) {
      toast(writeErrorMessage(e, 'Boot konnte nicht gespeichert werden'));
    }
  };

  const pick = async (file: File): Promise<void> => {
    setBusy(true);
    try {
      await setBoatPhoto(db, trip.id, await resizeImage(file));
      toast('Bootsfoto übernommen');
    } catch (e) {
      toast(writeErrorMessage(e, 'Foto konnte nicht gespeichert werden'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-label="Boot">
      <div className="legend">Boot</div>
      <Fields readOnly={readOnly}>
        <BoatPicture photoId={trip.boat.photoId} busy={busy} onPick={(f) => void pick(f)} />
        <BoatFields value={draft} onChange={setDraft} />
      </Fields>
      {readOnly ? null : (
        <button className="btn block" type="button" onClick={() => void save()}>
          Boot speichern
        </button>
      )}
    </section>
  );
}

function CrewCard({ trip, readOnly }: { trip: Trip; readOnly: boolean }) {
  const toast = useToast();
  const change = (crew: CrewMember[]): void => {
    const current = activeCrew(trip);
    const removed = current.find((m) => !crew.some((c) => c.id === m.id));
    const added = crew.find((c) => !current.some((m) => m.id === c.id));
    updateTrip(db, trip.id, { crew }).then(
      () => {
        if (removed) toast(`${removed.name} entfernt`);
        else if (added) toast(`${added.name} zur Crew hinzugefügt`);
      },
      (e: unknown) => toast(writeErrorMessage(e, 'Crew konnte nicht gespeichert werden')),
    );
  };
  return (
    <section className="card" aria-label="Crew">
      <div className="legend">Crew</div>
      <Fields readOnly={readOnly}>
        <CrewEditor crew={activeCrew(trip)} onChange={change} />
      </Fields>
    </section>
  );
}

function IdentityCard({ trip }: { trip: Trip }) {
  const toast = useToast();
  const authorId = useAuthorId(trip.id);
  const crew = activeCrew(trip);
  if (crew.length === 0) return null;
  return (
    <section className="card" aria-label="Ich bin …">
      <div className="legend">Ich bin …</div>
      <p className="muted">Wer schreibt auf diesem Gerät? Einträge und Tagesbericht tragen deinen Namen.</p>
      <div className="chips" role="radiogroup" aria-label="Ich bin">
        {crew.map((c) => (
          <button
            key={c.id}
            className="chip"
            type="button"
            role="radio"
            aria-checked={authorId === c.id}
            onClick={() => void setAuthor(db, trip.id, c.id).then(() => toast(`Du schreibst als ${c.name}`))}
          >
            {c.name}
          </button>
        ))}
      </div>
    </section>
  );
}

function TripList({ trips, activeId }: { trips: readonly Trip[]; activeId: string }) {
  const toast = useToast();
  const settings = useSettings();
  return (
    <section className="card" aria-label="Alle Törns">
      <div className="legend">Alle Törns</div>
      <ul className="triplist">
        {trips.map((t) => {
          const boat = t.boat.name.trim() || t.name;
          return (
            <li key={t.id}>
              <span className="triplist-name">
                <b>{boat}</b>
                <span className="dmeta">
                  {t.name} · {t.startDate ? formatDateLong(t.startDate) : 'ohne Datum'}
                </span>
              </span>
              <OwnershipBadge own={settings?.writableTripIds.includes(t.id) ?? false} />
              {t.id === activeId ? (
                <span className="role">Aktiv</span>
              ) : (
                <button
                  className="btn"
                  type="button"
                  aria-label={`Zu „${t.name}“ (${boat}) wechseln`}
                  onClick={() => void setActiveTrip(db, t.id).then(() => toast(`Törn „${t.name}“ aktiv`))}
                >
                  Wechseln
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function DeleteTripCard({ trip }: { trip: Trip }) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const remove = async (): Promise<void> => {
    setConfirming(false);
    await deleteTrip(db, trip.id);
    toast(`Logbuch „${trip.boat.name || trip.name}“ von diesem Gerät gelöscht`);
  };
  return (
    <>
      <button className="btn danger block" type="button" onClick={() => setConfirming(true)}>
        <Icon name="trash" size={20} />
        Dieses Logbuch auf diesem Gerät löschen
      </button>
      {confirming ? (
        <Dialog title="Logbuch löschen?" onClose={() => setConfirming(false)}>
          <p className="muted">
            Einträge, Fotos und Tracks von „{trip.name}“ werden nur auf diesem Gerät gelöscht. Andere Handys und
            exportierte Dateien bleiben unberührt.
          </p>
          <div className="share-choice">
            <button className="btn danger block" type="button" onClick={() => void remove()}>
              Endgültig löschen
            </button>
            <button className="btn block" type="button" onClick={() => setConfirming(false)}>
              Abbrechen
            </button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}

export function TripScreen({ trip }: { trip: Trip }) {
  const { startOnboarding } = useApp();
  const trips = useTrips();
  const readOnly = useReadOnly(trip.id);
  return (
    <main className="screen" aria-labelledby="screen-title">
      <h2 id="screen-title">Törn</h2>
      {trips && trips.length > 1 ? <TripList trips={trips} activeId={trip.id} /> : null}
      {readOnly ? null : <IdentityCard trip={trip} />}
      <FlotillaCard trip={trip} readOnly={readOnly} />
      <TripDataCard key={`data-${trip.id}`} trip={trip} readOnly={readOnly} />
      <BoatCard key={`boat-${trip.id}`} trip={trip} readOnly={readOnly} />
      <CrewCard trip={trip} readOnly={readOnly} />
      <ExportCard trip={trip} />
      <button className="btn block" type="button" onClick={startOnboarding}>
        Neuen Törn anlegen …
      </button>
      <DeleteTripCard trip={trip} />
    </main>
  );
}
