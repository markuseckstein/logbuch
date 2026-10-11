import { useState, type ReactNode } from 'react';
import { resizeImage } from '../../device';
import { db } from '../../db/db';
import { leaveTrip } from '../../db/cloud';
import { useTripCrew } from '../../db/hooks';
import { deleteTrip, linkCrewEmail, saveCrew, setActiveTrip, setAuthor, setBoatPhoto, updateTrip } from '../../db/repo';
import { activeCrew, formatDateLong, isSharedRealm, type CrewDraft, type Trip } from '../../domain';
import { useApp } from '../AppContext';
import { Icon } from '../icons';
import { useAuthorId, useReadOnly, useTrips } from '../hooks';
import { useCanManage, useCloudUser, useWritableTripIds } from '../cloudHooks';
import { CloudCard } from '../cloud/CloudCard';
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
  const current = activeCrew(useTripCrew(trip.id));
  const change = (crew: CrewDraft[]): void => {
    const removed = current.find((m) => !crew.some((c) => c.id === m.id));
    const added = crew.find((c) => !current.some((m) => m.id === c.id));
    saveCrew(db, trip.id, crew).then(
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
        <CrewEditor crew={current} onChange={change} />
      </Fields>
    </section>
  );
}

function IdentityCard({ trip }: { trip: Trip }) {
  const toast = useToast();
  const authorId = useAuthorId(trip.id);
  const user = useCloudUser();
  const crew = activeCrew(useTripCrew(trip.id));
  if (crew.length === 0) return null;
  const email = user?.isLoggedIn ? user.email : undefined;
  const pick = async (id: string, name: string): Promise<void> => {
    await setAuthor(db, trip.id, id);
    // im Cloud-Logbuch: Crew-Mitglied mit meinem Konto verknüpfen (gilt dann auf allen meinen Geräten)
    if (email && isSharedRealm(trip.realmId)) await linkCrewEmail(db, id, email).catch(() => undefined);
    toast(`Du schreibst als ${name}`);
  };
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
            onClick={() => void pick(c.id, c.name)}
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
  const writable = useWritableTripIds();
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
              <OwnershipBadge own={writable?.includes(t.id) ?? false} />
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
  const loggedIn = useCloudUser()?.isLoggedIn === true;
  const shared = loggedIn && isSharedRealm(trip.realmId);
  const manage = useCanManage(trip.id);
  const boat = trip.boat.name || trip.name;
  if (shared && !manage) return <LeaveTripCard trip={trip} />;
  const remove = async (): Promise<void> => {
    setConfirming(false);
    try {
      await deleteTrip(db, trip.id);
      toast(shared ? `Logbuch „${boat}“ für alle gelöscht` : `Logbuch „${boat}“ von diesem Gerät gelöscht`);
    } catch {
      toast('Das Logbuch konnte nicht gelöscht werden');
    }
  };
  if (shared) {
    return (
      <>
        <button className="btn danger block" type="button" onClick={() => setConfirming(true)}>
          <Icon name="trash" size={20} />
          Logbuch für alle löschen
        </button>
        {confirming ? (
          <Dialog title="Logbuch für alle löschen?" onClose={() => setConfirming(false)}>
            <p className="muted">
              „{trip.name}“ wird in der Cloud und auf allen Handys der Crew gelöscht. Exportiere es vorher als ZIP, wenn
              du es behalten willst.
            </p>
            <div className="share-choice">
              <button className="btn danger block" type="button" onClick={() => void remove()}>
                Für alle löschen
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

function LeaveTripCard({ trip }: { trip: Trip }) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const boat = trip.boat.name || trip.name;
  const leave = async (): Promise<void> => {
    setConfirming(false);
    try {
      await leaveTrip(db, trip.id);
      toast(`Logbuch „${boat}“ verlassen`);
    } catch {
      toast('Das Logbuch konnte nicht verlassen werden');
    }
  };
  return (
    <>
      <button className="btn danger block" type="button" onClick={() => setConfirming(true)}>
        Logbuch verlassen
      </button>
      {confirming ? (
        <Dialog title="Logbuch verlassen?" onClose={() => setConfirming(false)}>
          <p className="muted">
            Du bist dann kein Mitglied mehr im Logbuch „{boat}“; es verschwindet nach dem nächsten Abgleich von deinen
            Geräten. Der Skipper kann dich wieder einladen.
          </p>
          <div className="share-choice">
            <button className="btn danger block" type="button" onClick={() => void leave()}>
              Verlassen
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
      <CloudCard trip={trip} readOnly={readOnly} />
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
