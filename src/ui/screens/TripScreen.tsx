import { useState, type MouseEvent, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { resizeImage } from '../../device';
import { db } from '../../db/db';
import { inviteToTrip, leaveTrip, removePerson, type PersonInfo } from '../../db/cloud';
import { useEntries, usePhotoUrl, useTracks, useTripCrew } from '../../db/hooks';
import {
  BoatInUseError, DuplicateEmailError, LastBoatError, addBoat, deleteTrip, removeBoat, removeTripCover, setActiveTrip,
  setAuthor, setBoatPhoto, setTripCover, setTripCoverFocus, updateBoat, updateCrewMember, updateTrip,
} from '../../db/repo';
import {
  activeCrew, boatInUse, clampFocus, coverPosition, isSharedRealm, nameFromEmail, type Boat, type CoverFocus,
  type ID, type Trip,
} from '../../domain';
import { useApp } from '../AppContext';
import { BoatChips, BoatShape, boatColor, useBoatSelection } from '../boats';
import { AccountCard } from '../cloud/CloudCard';
import { HomeViewCard } from '../cloud/HomeViewCard';
import { useCloudStatus, useCloudUser, useMyCrewId, usePeople, useTripAccess } from '../cloudHooks';
import { useTrips } from '../hooks';
import { Icon } from '../icons';
import { initials, tripPeriod, writeErrorMessage } from '../lib';
import { useToast } from '../toast';
import { Dialog } from '../components/Dialog';
import { ExportCard } from '../components/ExportCard';
import { JoinSheet } from '../components/JoinSheet';
import { usePhotoViewer } from '../components/PhotoViewer';
import { BoatFields, TripFields, boatDraftOf, emptyBoatDraft, tripDraftOf, tripPatchOf, validateTrip, type BoatDraft } from '../components/TripFields';
import { parseDecimal } from '../lib';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;



/** Datei-Auswahl als Button (Galerie/Kamera). */
function FileButton({ label, busy, onPick, className = 'btn sm' }: { label: string; busy?: boolean; onPick: (f: File) => void; className?: string }) {
  const [id] = useState(() => `f-${Math.random().toString(36).slice(2)}`);
  return (
    <>
      <input
        className="sr-only"
        id={id}
        type="file"
        accept="image/*"
        aria-label={label}
        disabled={busy}
        onChange={(ev) => {
          const file = ev.target.files?.[0];
          ev.target.value = '';
          if (file) onPick(file);
        }}
      />
      <label className={className} htmlFor={id}>
        <Icon name="cam" size={18} />
        {busy ? 'Foto wird verarbeitet …' : label}
      </label>
    </>
  );
}

// ---------- Cover ----------

function FocusDialog({ trip, url, onClose }: { trip: Trip; url: string; onClose: () => void }) {
  const toast = useToast();
  const [focus, setFocus] = useState<CoverFocus>(trip.coverFocus ?? { x: 50, y: 50 });
  const [ratio, setRatio] = useState<number>();
  const target = 16 / 9;
  const fw = ratio && ratio > target ? target / ratio : 1;
  const fh = ratio && ratio < target ? ratio / target : 1;
  const pick = (ev: MouseEvent<HTMLDivElement>): void => {
    const r = ev.currentTarget.getBoundingClientRect();
    const tx = (ev.clientX - r.left) / r.width;
    const ty = (ev.clientY - r.top) / r.height;
    const to = (t: number, f: number): number => (f >= 1 ? 50 : ((t - f / 2) / (1 - f)) * 100);
    setFocus(clampFocus({ x: to(tx, fw), y: to(ty, fh) }));
  };
  const save = async (): Promise<void> => {
    try {
      await setTripCoverFocus(db, trip.id, focus);
      toast('Ausschnitt gespeichert');
      onClose();
    } catch (e) {
      toast(writeErrorMessage(e, 'Ausschnitt konnte nicht gespeichert werden'));
    }
  };
  return (
    <Dialog title="Ausschnitt anpassen" onClose={onClose}>
      <p className="muted">Tippe auf den Bildteil, der im Cover zu sehen sein soll.</p>
      <div className="cover-frame" onClick={pick} role="presentation">
        <img src={url} alt="Cover-Bild" onLoad={(e) => setRatio(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)} />
        <span
          className="frame"
          style={{
            width: `${fw * 100}%`, height: `${fh * 100}%`,
            left: `${(1 - fw) * focus.x}%`, top: `${(1 - fh) * focus.y}%`,
          }}
        />
      </div>
      <div className="share-choice">
        <button className="btn primary block" type="button" onClick={() => void save()}>
          Ausschnitt speichern
        </button>
        <button className="btn block" type="button" onClick={onClose}>
          Abbrechen
        </button>
      </div>
    </Dialog>
  );
}

function CoverHero({ trip, admin }: { trip: Trip; admin: boolean }) {
  const toast = useToast();
  const url = usePhotoUrl(trip.coverPhotoId);
  const cover = usePhotoViewer(trip.coverPhotoId ? [{ id: trip.coverPhotoId, caption: trip.name }] : []);
  const openCover = cover.open;
  const [busy, setBusy] = useState(false);
  const [focusing, setFocusing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const pick = async (file: File): Promise<void> => {
    setBusy(true);
    try {
      await setTripCover(db, trip.id, await resizeImage(file));
      toast('Cover-Bild gespeichert');
    } catch (e) {
      toast(writeErrorMessage(e, 'Cover-Bild konnte nicht gespeichert werden'));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (): Promise<void> => {
    setConfirming(false);
    try {
      await removeTripCover(db, trip.id);
      toast('Cover-Bild entfernt');
    } catch (e) {
      toast(writeErrorMessage(e, 'Cover-Bild konnte nicht entfernt werden'));
    }
  };
  const title = (
    <div className="hero-t">
      <h2 id="screen-title">{trip.name}</h2>
      <div>{[tripPeriod(trip), trip.area].filter(Boolean).join(' · ')}</div>
    </div>
  );
  return (
    <section aria-label="Cover">
      {trip.coverPhotoId && url ? (
        <div className="hero">
          <button type="button" className="pic-btn" aria-label="Cover-Bild groß anzeigen" onClick={() => openCover(0)}>
            <img src={url} alt="" style={{ objectPosition: coverPosition(trip.coverFocus) }} />
          </button>
          {title}
        </div>
      ) : (
        <div className="hero empty-cover">
          {title}
          {admin ? (
            <div className="acts" style={{ marginTop: 10 }}>
              <FileButton label="Cover-Bild hinzufügen" busy={busy} onPick={(f) => void pick(f)} />
            </div>
          ) : null}
        </div>
      )}
      {admin && trip.coverPhotoId ? (
        <>
          <div className="acts" style={{ marginTop: 10 }}>
            <FileButton label="Cover ändern" busy={busy} onPick={(f) => void pick(f)} />
            {url ? (
              <button className="btn sm" type="button" onClick={() => setFocusing(true)}>
                Ausschnitt anpassen
              </button>
            ) : null}
            <button className="btn danger sm" type="button" onClick={() => setConfirming(true)}>
              Entfernen
            </button>
          </div>
          {confirming ? (
            <div className="confirm" role="alertdialog" aria-label="Cover entfernen bestätigen" style={{ marginTop: 10 }}>
              <p>Cover-Bild wirklich entfernen?</p>
              <button className="btn sm" type="button" autoFocus onClick={() => setConfirming(false)}>
                Abbrechen
              </button>
              <button className="btn danger sm" type="button" onClick={() => void remove()}>
                Endgültig entfernen
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      {admin && isSharedRealm(trip.realmId) ? (
        <p className="muted" style={{ marginTop: 8 }}>Das Cover wird mit allen Mitgliedern des Törns geteilt.</p>
      ) : null}
      {focusing && url ? <FocusDialog trip={trip} url={url} onClose={() => setFocusing(false)} /> : null}
      {cover.viewer}
    </section>
  );
}

// ---------- Törndaten ----------

function Fields({ readOnly, children }: { readOnly: boolean; children: ReactNode }) {
  return readOnly ? (
    <fieldset className="ro" disabled>
      {children}
    </fieldset>
  ) : (
    <>{children}</>
  );
}

function TripDataCard({ trip, admin }: { trip: Trip; admin: boolean }) {
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
    <details className="opt" aria-label="Törndaten">
      <summary>Törndaten {admin ? 'bearbeiten' : 'ansehen'}</summary>
      <div className="in onb-step">
        <Fields readOnly={!admin}>
          <TripFields value={draft} onChange={setDraft} />
        </Fields>
        {error ? (
          <div className="err" role="alert">
            {error}
          </div>
        ) : null}
        {admin ? (
          <button className="btn block" type="button" onClick={() => void save()}>
            Törndaten speichern
          </button>
        ) : null}
      </div>
    </details>
  );
}

// ---------- Boote ----------

const boatInputOf = (d: BoatDraft) => ({
  name: d.name.trim(),
  model: d.model.trim() || undefined,
  lengthM: (() => {
    const n = parseDecimal(d.lengthM);
    return n !== undefined && n > 0 ? n : undefined;
  })(),
  homePort: d.homePort.trim() || undefined,
  callSign: d.callSign.trim() || undefined,
  mmsi: d.mmsi.trim() || undefined,
});

function BoatSvg({ boat }: { boat: Pick<Boat, 'colorIndex'> }) {
  return (
    <svg viewBox="0 0 300 140" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style={boatColor(boat)}>
      <rect width="300" height="140" fill="var(--water-mid)" />
      <rect y="96" width="300" height="44" fill="var(--water-shallow)" />
      <path d="M60 98h180l-22 20H84z" fill="var(--c)" />
      <path d="M148 22v74M148 24l56 66h-56M144 40l-48 50h48" fill="var(--surface)" stroke="var(--ink)" strokeWidth="2" />
    </svg>
  );
}

function BoatPhoto({ boat }: { boat: Boat }) {
  const url = usePhotoUrl(boat.photoId);
  const { open, viewer } = usePhotoViewer(boat.photoId ? [{ id: boat.photoId, caption: boat.name }] : []);
  return (
    <div className="boatpic">
      {url ? (
        <button type="button" className="pic-btn" aria-label={`Foto ${boat.name} groß anzeigen`} onClick={() => open(0)}>
          <img src={url} alt={`Foto ${boat.name}`} />
        </button>
      ) : (
        <BoatSvg boat={boat} />
      )}
      {viewer}
    </div>
  );
}

function BoatCard({
  boat, entries, inUse, people, admin, canRemove,
}: { boat: Boat; entries: number; inUse: boolean; people: readonly PersonInfo[]; admin: boolean; canRemove: boolean }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<BoatDraft>(() => boatDraftOf(boat));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    if (!draft.name.trim()) {
      toast('Bitte einen Namen eingeben');
      return;
    }
    try {
      await updateBoat(db, boat.id, boatInputOf(draft));
      setEditing(false);
      toast('Boot gespeichert');
    } catch (e) {
      toast(writeErrorMessage(e, 'Boot konnte nicht gespeichert werden'));
    }
  };
  const photo = async (file: File): Promise<void> => {
    setBusy(true);
    try {
      await setBoatPhoto(db, boat.id, await resizeImage(file));
      toast('Bootsfoto übernommen');
    } catch (e) {
      toast(writeErrorMessage(e, 'Foto konnte nicht gespeichert werden'));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (): Promise<void> => {
    setConfirming(false);
    try {
      await removeBoat(db, boat.id);
      toast(`Boot „${boat.name}“ entfernt`);
    } catch (e) {
      toast(
        e instanceof BoatInUseError
          ? `„${boat.name}“ hat Einträge und kann nicht entfernt werden`
          : e instanceof LastBoatError
            ? 'Ein Törn braucht mindestens ein Boot'
            : writeErrorMessage(e, 'Boot konnte nicht entfernt werden'),
      );
    }
  };
  const suggested = people.filter((p) => p.suggestedBoatId === boat.id);
  return (
    <article className="card bcard" style={boatColor(boat)} aria-label={`Boot ${boat.name}`}>
      <BoatPhoto boat={boat} />
      <div className="bc-head">
        <div>
          <h3>{boat.name}</h3>
          <div className="muted">
            {[boat.model, boat.lengthM ? `${String(boat.lengthM).replace('.', ',')} m` : undefined].filter(Boolean).join(' · ')}
            {boat.model || boat.lengthM ? ' · ' : ''}
            {entries} Einträge
          </div>
        </div>
        <BoatShape boat={boat} size={20} />
      </div>
      <div>
        <div className="legend" style={{ marginBottom: 8 }}>
          Vorgeschlagene Crew
        </div>
        <div className="people">
          {suggested.length ? (
            suggested.map((p) => (
              <span key={p.crewId} className={p.status === 'accepted' || !p.email ? 'pchip' : 'pchip inv'}>
                <i className="av sm" aria-hidden="true">
                  {initials(p.name)}
                </i>
                {p.name}
                {p.status === 'invited' || p.status === 'pending' ? ' · eingeladen' : ''}
              </span>
            ))
          ) : (
            <span className="muted">Niemand vorab zugewiesen.</span>
          )}
        </div>
      </div>
      {admin && editing ? (
        <div className="card onb-step" style={{ borderStyle: 'dashed', background: 'transparent' }}>
          <BoatFields value={draft} onChange={setDraft} />
          <div className="acts">
            <FileButton label={boat.photoId ? 'Foto ändern' : 'Foto wählen'} busy={busy} onPick={(f) => void photo(f)} />
          </div>
          <div className="acts">
            <button className="btn primary sm" type="button" onClick={() => void save()}>
              Speichern
            </button>
            <button className="btn sm" type="button" onClick={() => setEditing(false)}>
              Abbrechen
            </button>
          </div>
        </div>
      ) : null}
      {admin && !editing ? (
        <div className="acts">
          <button
            className="btn sm"
            type="button"
            onClick={() => {
              setDraft(boatDraftOf(boat));
              setEditing(true);
            }}
          >
            <Icon name="edit" size={18} />
            Bearbeiten
          </button>
          {canRemove && !inUse ? (
            <button className="btn danger sm" type="button" onClick={() => setConfirming(true)}>
              <Icon name="trash" size={18} />
              Entfernen
            </button>
          ) : null}
        </div>
      ) : null}
      {confirming ? (
        <div className="confirm" role="alertdialog" aria-label="Boot entfernen bestätigen">
          <p>Boot „{boat.name}“ wirklich entfernen?</p>
          <button className="btn sm" type="button" autoFocus onClick={() => setConfirming(false)}>
            Abbrechen
          </button>
          <button className="btn danger sm" type="button" onClick={() => void remove()}>
            Endgültig entfernen
          </button>
        </div>
      ) : null}
    </article>
  );
}

function AddBoatCard({ trip }: { trip: Trip }) {
  const toast = useToast();
  const [draft, setDraft] = useState<BoatDraft>(emptyBoatDraft);
  const [error, setError] = useState<string>();
  const add = async (): Promise<void> => {
    if (!draft.name.trim()) {
      setError('Bitte dem Boot einen Namen geben.');
      return;
    }
    setError(undefined);
    try {
      const b = await addBoat(db, trip.id, boatInputOf(draft));
      setDraft(emptyBoatDraft());
      toast(`Boot „${b.name}“ angelegt · eigene Farbe auf der Karte`);
    } catch (e) {
      toast(writeErrorMessage(e, 'Boot konnte nicht angelegt werden'));
    }
  };
  return (
    <details className="opt">
      <summary>
        <Icon name="plus" size={20} />
        &nbsp;Boot anlegen
      </summary>
      <div className="in onb-step">
        <BoatFields value={draft} onChange={setDraft} full={false} />
        {error ? (
          <div className="err" role="alert">
            {error}
          </div>
        ) : null}
        <button className="btn primary block" type="button" onClick={() => void add()}>
          <Icon name="plus" size={20} />
          Boot hinzufügen
        </button>
      </div>
    </details>
  );
}

// ---------- Personen ----------

function InviteCard({ trip, boats, people }: { trip: Trip; boats: readonly Boat[]; people: readonly PersonInfo[] }) {
  const toast = useToast();
  const [qrOpen, setQrOpen] = useState(false);
  const signedIn = useCloudUser()?.isLoggedIn === true;
  const [email, setEmail] = useState('');
  const [boatId, setBoatId] = useState<ID>();
  const [error, setError] = useState<string>();
  const invite = async (): Promise<void> => {
    const e = email.trim();
    if (!EMAIL_RE.test(e)) {
      setError('Bitte eine gültige E-Mail-Adresse eingeben.');
      return;
    }
    setError(undefined);
    try {
      await inviteToTrip(db, trip.id, { email: e, suggestedBoatId: boatId });
      const boat = boats.find((b) => b.id === boatId);
      setEmail('');
      setBoatId(undefined);
      toast(`${e} ${signedIn ? 'eingetragen' : 'vorgemerkt'}${boat ? ` · Vorschlag: ${boat.name}` : ''}`, 3800);
    } catch (err) {
      setError(err instanceof DuplicateEmailError ? 'Diese Adresse ist schon im Törn.' : writeErrorMessage(err, 'Die Einladung konnte nicht angelegt werden.'));
    }
  };
  return (
    <section className="card" aria-label="Person einladen">
      <div className="legend">Person einladen</div>
      <p className="muted">
        Trage die E-Mail-Adresse ein, mit der sich die Person anmeldet, und teile danach den QR-Code. Es wird keine Mail
        verschickt. Das Boot ist nur ein Vorschlag für den ersten Eintrag, keine Berechtigung.
      </p>
      {signedIn ? null : (
        <p className="muted">
          <Icon name="lock" size={16} /> Nicht angemeldet: Personen werden vorgemerkt und nach der Anmeldung eingetragen.
        </p>
      )}
      <label className="f">
        <span>E-Mail-Adresse</span>
        <input
          type="email"
          inputMode="email"
          autoComplete="off"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      {boats.length ? (
        <fieldset>
          <legend>Boot-Vorschlag (optional)</legend>
          <BoatChips boats={boats} value={boatId} onChange={setBoatId} label="Boot-Vorschlag" noneLabel="Kein Vorschlag" />
        </fieldset>
      ) : null}
      {error ? (
        <div className="err" role="alert">
          {error}
        </div>
      ) : null}
      <button className="btn primary block" type="button" onClick={() => void invite()}>
        <Icon name="mail" size={20} />
        {signedIn ? 'Person eintragen' : 'Person vormerken'}
      </button>
      {signedIn ? (
        <button className="btn block" type="button" onClick={() => setQrOpen(true)}>
          QR-Code zum Beitreten
        </button>
      ) : null}
      {qrOpen ? <JoinSheet trip={trip} people={people} onClose={() => setQrOpen(false)} /> : null}
    </section>
  );
}

const STATUS: Record<PersonInfo['status'], [string, string]> = {
  pending: ['vorgemerkt', 'st warn'],
  invited: ['eingeladen', 'st warn'],
  accepted: ['dabei', 'st ok'],
  rejected: ['abgelehnt', 'st bad'],
};

function PersonRow({
  trip,
  people,
  p,
  boats,
  admin,
  shared,
}: {
  trip: Trip;
  people: readonly PersonInfo[];
  p: PersonInfo;
  boats: readonly Boat[];
  admin: boolean;
  shared: boolean;
}) {
  const toast = useToast();
  const signedIn = useCloudUser()?.isLoggedIn === true;
  const [confirming, setConfirming] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const boat = boats.find((b) => b.id === p.suggestedBoatId);
  const [label, cls] = STATUS[p.status];
  const setSuggestion = async (id: string): Promise<void> => {
    try {
      await updateCrewMember(db, p.crewId, { suggestedBoatId: id || undefined });
      const b = boats.find((x) => x.id === id);
      toast(`${p.name} → ${b ? b.name : 'kein Vorschlag'} (nur Vorschlag, keine Berechtigung)`, 3800);
    } catch (e) {
      toast(writeErrorMessage(e, 'Vorschlag konnte nicht gespeichert werden'));
    }
  };
  const remove = async (): Promise<void> => {
    setConfirming(false);
    try {
      await removePerson(db, p.crewId);
      toast(`${p.name} entfernt`);
    } catch (e) {
      toast(writeErrorMessage(e, 'Person konnte nicht entfernt werden'));
    }
  };
  return (
    <li className="mem">
      <div className="mem-top">
        <i className="av" aria-hidden="true">
          {initials(p.name)}
        </i>
        <div className="mem-main">
          <b>{p.name}</b>
          {p.admin ? <span className="role">Admin</span> : null} {p.self ? <span className="who me">(du)</span> : null}
          <div className="muted">
            {p.email ?? 'ohne E-Mail'}
            {boat ? ` · Vorschlag: ${boat.name}` : ''}
          </div>
        </div>
        {p.email && !(p.admin && !shared) ? <span className={cls}>{label}</span> : null}
      </div>
      {admin ? (
        <div className="mem-acts">
          <label className="sr-only" htmlFor={`pre-${p.crewId}`}>
            Boot-Vorschlag für {p.name}
          </label>
          <select id={`pre-${p.crewId}`} value={p.suggestedBoatId ?? ''} onChange={(e) => void setSuggestion(e.target.value)}>
            <option value="">Kein Vorschlag</option>
            {boats.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          {signedIn && p.email && !p.self ? (
            <button className="btn sm" type="button" aria-label={`QR-Code für ${p.name}`} onClick={() => setQrOpen(true)}>
              QR-Code
            </button>
          ) : null}
          {!p.self && !p.admin ? (
            <button className="btn danger sm" type="button" onClick={() => setConfirming(true)}>
              Entfernen
            </button>
          ) : null}
        </div>
      ) : null}
      {qrOpen ? <JoinSheet trip={trip} people={people} person={p} onClose={() => setQrOpen(false)} /> : null}
      {confirming ? (
        <div className="confirm" role="alertdialog" aria-label="Person entfernen bestätigen">
          <p>{p.name} wirklich aus dem Törn entfernen?</p>
          <button className="btn sm" type="button" autoFocus onClick={() => setConfirming(false)}>
            Abbrechen
          </button>
          <button className="btn danger sm" type="button" onClick={() => void remove()}>
            Endgültig entfernen
          </button>
        </div>
      ) : null}
    </li>
  );
}

function PeopleCard({ trip, boats, people, admin }: { trip: Trip; boats: readonly Boat[]; people: readonly PersonInfo[]; admin: boolean }) {
  const shared = isSharedRealm(trip.realmId);
  return (
    <section className="card" aria-label="Mitglieder">
      <div className="legend">Mitgliederliste</div>
      {people.length === 0 ? <p className="muted">Noch niemand eingeladen.</p> : null}
      <ul className="people-list" aria-label="Personen">
        {people.map((p) => (
          <PersonRow key={p.crewId} trip={trip} people={people} p={p} boats={boats} admin={admin} shared={shared} />
        ))}
      </ul>
      <p className="muted">Das Boot ist nur ein Vorschlag fürs erste Eintragen. Jedes Mitglied, das dabei ist, schreibt auf alle Boote.</p>
    </section>
  );
}

/** „Ich bin …“ im lokalen Modus mit mehreren Personen (z. B. nach Datei-Import). */
function IdentityCard({ trip }: { trip: Trip }) {
  const toast = useToast();
  const me = useMyCrewId(trip.id);
  const crew = activeCrew(useTripCrew(trip.id));
  if (crew.length < 2) return null;
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
            aria-checked={me === c.id}
            onClick={() => void setAuthor(db, trip.id, c.id).then(() => toast(`Du schreibst als ${c.name}`))}
          >
            {c.name}
          </button>
        ))}
      </div>
    </section>
  );
}

// ---------- Törn-Liste ----------

function TripThumb({ trip }: { trip: Trip }) {
  const url = usePhotoUrl(trip.coverPhotoId);
  return (
    <span className="thumb-s">
      {url ? <img src={url} alt="" style={{ objectPosition: coverPosition(trip.coverFocus) }} /> : <Icon name="image" size={20} />}
    </span>
  );
}

function TripList({ trips, activeId }: { trips: readonly Trip[]; activeId: string }) {
  const toast = useToast();
  const { startOnboarding } = useApp();
  return (
    <section className="card" aria-label="Alle Törns">
      <div className="legend">Alle Törns</div>
      <ul className="triplist">
        {trips.map((t) => (
          <li key={t.id}>
            <TripThumb trip={t} />
            <span className="triplist-name">
              <b>{t.name}</b>
              <span className="dmeta">{tripPeriod(t) || 'ohne Datum'}</span>
            </span>
            {t.id === activeId ? (
              <span className="role">Aktiv</span>
            ) : (
              <button
                className="btn sm"
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
      <button className="btn block" type="button" onClick={startOnboarding}>
        Neuen Törn anlegen …
      </button>
    </section>
  );
}

// ---------- Löschen / Verlassen ----------

function DeleteTripCard({ trip, admin, signedIn }: { trip: Trip; admin: boolean; signedIn: boolean }) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const shared = signedIn && isSharedRealm(trip.realmId);
  if (shared && !admin) return <LeaveTripCard trip={trip} />;
  const remove = async (): Promise<void> => {
    setConfirming(false);
    try {
      await deleteTrip(db, trip.id);
      toast(shared ? `Törn „${trip.name}“ für alle gelöscht` : `Törn „${trip.name}“ von diesem Gerät gelöscht`);
    } catch {
      toast('Der Törn konnte nicht gelöscht werden');
    }
  };
  return (
    <>
      <button className="btn danger block" type="button" onClick={() => setConfirming(true)}>
        <Icon name="trash" size={20} />
        {shared ? 'Törn für alle löschen' : 'Diesen Törn auf diesem Gerät löschen'}
      </button>
      {confirming ? (
        <Dialog title={shared ? 'Törn für alle löschen?' : 'Törn löschen?'} onClose={() => setConfirming(false)}>
          <p className="muted">
            {shared
              ? `„${trip.name}“ wird in der Cloud und auf allen Handys der Crew gelöscht. Exportiere den Törn vorher als ZIP, wenn du ihn behalten willst.`
              : `Einträge, Fotos und Tracks von „${trip.name}“ werden nur auf diesem Gerät gelöscht. Exportierte Dateien bleiben unberührt.`}
          </p>
          <div className="share-choice">
            <button className="btn danger block" type="button" onClick={() => void remove()}>
              {shared ? 'Für alle löschen' : 'Endgültig löschen'}
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
  const leave = async (): Promise<void> => {
    setConfirming(false);
    try {
      await leaveTrip(db, trip.id);
      toast(`Törn „${trip.name}“ verlassen`);
    } catch {
      toast('Der Törn konnte nicht verlassen werden');
    }
  };
  return (
    <>
      <button className="btn danger block" type="button" onClick={() => setConfirming(true)}>
        Törn verlassen
      </button>
      {confirming ? (
        <Dialog title="Törn verlassen?" onClose={() => setConfirming(false)}>
          <p className="muted">
            Du bist dann kein Mitglied mehr im Törn „{trip.name}“; er verschwindet nach dem nächsten Abgleich von deinen
            Geräten. Der Admin kann dich wieder einladen.
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
  const trips = useTrips();
  const access = useTripAccess(trip.id);
  const admin = access.admin;
  const cloud = useCloudStatus();
  const signedIn = useCloudUser()?.isLoggedIn === true;
  const { boats } = useBoatSelection();
  const entries = useEntries(trip.id) ?? [];
  const tracks = useTracks(trip.id) ?? [];
  const people = usePeople(trip.id);
  const me = people.find((p) => p.self);
  const counts = useLiveQuery(async () => {
    const m = new Map<ID, number>();
    for (const e of await db.entries.where('tripId').equals(trip.id).toArray()) {
      if (e.deletedAt === undefined) m.set(e.boatId, (m.get(e.boatId) ?? 0) + 1);
    }
    return m;
  }, [trip.id]);
  return (
    <main className="screen" aria-labelledby="screen-title">
      <CoverHero trip={trip} admin={admin} />
      <AccountCard trip={trip} admin={admin} myName={me?.name} />
      {cloud === 'local' || cloud === 'signed-out' ? <IdentityCard trip={trip} /> : null}
      <div className="legend">Boote · {boats.length}</div>
      {boats.map((b) => (
        <BoatCard
          key={b.id}
          boat={b}
          entries={counts?.get(b.id) ?? 0}
          inUse={boatInUse(b.id, entries, tracks)}
          people={people}
          admin={admin}
          canRemove={boats.length > 1}
        />
      ))}
      {admin ? <AddBoatCard trip={trip} /> : null}
      <div className="legend">Crew · {people.length}</div>
      {admin && cloud !== 'local' ? <InviteCard trip={trip} boats={boats} people={people} /> : null}
      {!admin ? (
        <div className="card" style={{ borderStyle: 'dashed', background: 'transparent' }}>
          <p className="muted">Nur der Admin lädt Personen ein und legt Boote an.</p>
        </div>
      ) : null}
      <PeopleCard trip={trip} boats={boats} people={people} admin={admin} />
      {admin && signedIn ? <HomeViewCard trip={trip} /> : null}
      <TripDataCard key={`data-${trip.id}`} trip={trip} admin={admin} />
      {trips ? <TripList trips={trips} activeId={trip.id} /> : null}
      <ExportCard trip={trip} />
      <DeleteTripCard trip={trip} admin={admin} signedIn={access.userId !== undefined} />
    </main>
  );
}

export { nameFromEmail };
