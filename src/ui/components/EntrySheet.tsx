import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAllBoats, useTripCrew } from '../../db/hooks';
import { captureFix } from '../../device';
import { db } from '../../db/db';
import { MAX_PHOTOS_PER_ENTRY, deleteEntry, removePhotoFromEntry, setEntryPosition, updateEntry } from '../../db/repo';
import {
  ENTRY_TYPE_LABELS,
  SEA_STATE_LABELS,
  SKY_LABELS,
  formatPosition,
  formatTime,
  canEditRecord,
  parseCoordinate,
  type Boat,
  type EntryType,
  type ID,
  type LogEntry,
} from '../../domain';
import { ENTRY_ICON, Icon, SKY_ICON } from '../icons';
import { BoatChips, boatColor } from '../boats';
import { useMyCrewId, useTripAccessState } from '../cloudHooks';
import {
  ENTRY_TYPES, FIX_ERROR_LABEL, authorName, fromLocalInput, parseDecimal, photoCaption, toLocalInput, writeErrorMessage,
} from '../lib';
import { usePhotoImport } from '../photoImport';
import { useToast } from '../toast';
import { BeaufortBar } from './BeaufortBar';
import { PhotoPicker } from './PhotoPicker';
import { EntryReadOnly } from './EntryReadOnly';
import { Sheet } from './Sheet';
import { WindRose } from './WindRose';

type Sky = NonNullable<LogEntry['sky']>;
type Sea = NonNullable<LogEntry['seaState']>;
const SKIES = Object.keys(SKY_LABELS) as Sky[];
const SEAS = Object.keys(SEA_STATE_LABELS) as Sea[];

const toggle = <T,>(current: T | undefined, next: T): T | undefined => (current === next ? undefined : next);
const numText = (n: number | undefined): string => (n === undefined ? '' : String(n));

interface EntrySheetProps {
  entryId: ID;
  isNew?: boolean;
  onClose: () => void;
}

export function EntrySheet({ entryId, isNew = false, onClose }: EntrySheetProps) {
  const entry = useLiveQuery(() => db.entries.get(entryId), [entryId]);
  const access = useTripAccessState(entry?.tripId ?? '');
  const crew = useTripCrew(entry?.tripId);
  const boats = useAllBoats(entry?.tripId);
  const me = useMyCrewId(entry?.tripId ?? '');
  if (!entry || !access) return null;
  const editable = (access.admin || access.canWrite) && canEditRecord(entry, access);
  const by = authorName(crew, entry.authorId);
  const boat = boats.find((b) => b.id === entry.boatId);
  const foreign = !!entry.authorId && entry.authorId !== me && access.userId !== undefined && entry.owner !== access.userId;
  if (!editable) return <EntryView entry={entry} by={by} boat={boat} onClose={onClose} />;
  return (
    <EntryForm
      entry={entry} isNew={isNew} by={by} boats={boats.filter((b) => b.deletedAt === undefined || b.id === entry.boatId)}
      adminEdit={access.admin && foreign} onClose={onClose}
    />
  );
}

/** „Eintrag von Ben · Möwe“ */
function originText(by: string | undefined, boat: Boat | undefined): string {
  return [by ? `Eintrag von ${by}` : 'Eintrag', boat?.name].filter(Boolean).join(' · ');
}

function subtitleOf(entry: LogEntry, by: string | undefined) {
  const pos = entry.position
    ? `${formatPosition(entry.position, 3)}${entry.position.accuracyM !== undefined ? ` · ± ${Math.round(entry.position.accuracyM)} m` : ''}`
    : 'Keine Position';
  return by ? (
    <>
      {pos}
      <br />
      von {by}
    </>
  ) : (
    pos
  );
}

function EntryView({
  entry, by, boat, onClose,
}: { entry: LogEntry; by: string | undefined; boat: Boat | undefined; onClose: () => void }) {
  const title = `Eintrag ansehen · ${formatTime(entry.time, entry.tzOffsetMin)}`;
  return (
    <Sheet
      title={title}
      subtitle={subtitleOf(entry, by)}
      onClose={onClose}
      footer={
        <button className="btn primary" type="button" onClick={onClose}>
          Fertig
        </button>
      }
    >
      <div className="note" role="note" style={boat ? { ...boatColor(boat), borderLeftColor: 'var(--c)' } : undefined}>
        <b>Nur ansehen</b>
        {originText(by, boat)}. Fremde Einträge kannst du nicht ändern oder löschen.
      </div>
      <EntryReadOnly entry={entry} caption={photoCaption([formatTime(entry.time, entry.tzOffsetMin), boat?.name, by])} />
    </Sheet>
  );
}

const DENIED_HINT =
  'Standort ist gesperrt. Tippe oben in der Adressleiste auf das Schloss → Berechtigungen → Standort → Zulassen.';

/** Ist der Standort im Browser gesperrt? (Permissions-API, sonst unbekannt = false) */
function useLocationBlocked(active: boolean): boolean {
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    if (!active) return;
    let status: PermissionStatus | undefined;
    const update = (): void => setBlocked(status?.state === 'denied');
    void navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((st) => {
        status = st;
        update();
        st.addEventListener('change', update);
      })
      .catch(() => undefined);
    return () => status?.removeEventListener('change', update);
  }, [active]);
  return blocked;
}

interface ManualPos {
  lat: string;
  lon: string;
  setLat: (v: string) => void;
  setLon: (v: string) => void;
  /** Fehler an den Feldern (Eingabe nicht lesbar). */
  error: string | undefined;
  setError: (v: string | undefined) => void;
}

/** Liest die manuelle Eingabe: undefined = leer, sonst Ergebnis (Fehler gehören ans Feld). */
function readManual(m: ManualPos): { lat: number; lon: number } | { error: string } | undefined {
  if (m.lat.trim() === '' && m.lon.trim() === '') return undefined;
  const la = parseCoordinate(m.lat, 'lat');
  if (!la.ok) return { error: la.error };
  const lo = parseCoordinate(m.lon, 'lon');
  if (!lo.ok) return { error: lo.error };
  return { lat: la.value, lon: lo.value };
}

function PositionSection({ entry, manual }: { entry: LogEntry; manual: ManualPos }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [denied, setDenied] = useState(false);
  const blocked = useLocationBlocked(!entry.position);
  const details = useRef<HTMLDetailsElement>(null);
  const latInput = useRef<HTMLInputElement>(null);
  const stopRef = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => stopRef.current?.(), []);
  // Eingabefehler (auch beim Schließen): Bereich aufklappen und ans Feld springen
  useEffect(() => {
    if (!manual.error) return;
    if (details.current) details.current.open = true;
    latInput.current?.focus();
  }, [manual.error]);

  const capture = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    let improved = false;
    const { first, stop } = captureFix({
      onImproved: (p) => {
        improved = true;
        void setEntryPosition(db, entry.id, p);
      },
    });
    stopRef.current = stop;
    const res = await first;
    if (res.position && !improved) await setEntryPosition(db, entry.id, res.position);
    if (!res.position) {
      setDenied(res.error === 'denied');
      setError(`Keine Position (GPS: ${res.error ? FIX_ERROR_LABEL[res.error] : 'nicht verfügbar'})`);
    }
    setBusy(false);
  };

  const applyManual = async (): Promise<void> => {
    const r = readManual(manual);
    if (!r) {
      manual.setError('Bitte Breite und Länge angeben, z. B. 54°19,1 N und 010°08,4 E.');
      return;
    }
    if ('error' in r) {
      manual.setError(r.error);
      return;
    }
    manual.setError(undefined);
    await setEntryPosition(db, entry.id, { lat: r.lat, lon: r.lon });
    manual.setLat('');
    manual.setLon('');
    toast('Position übernommen');
  };

  return (
    <div className="card pos-card">
      {!entry.position ? (
        <button className="btn block" type="button" disabled={busy} onClick={() => void capture()}>
          {busy ? 'Position wird bestimmt …' : 'Position jetzt erfassen'}
        </button>
      ) : null}
      {!entry.position && (blocked || denied) ? (
        <div className="note" role="note">
          {DENIED_HINT}
        </div>
      ) : null}
      <details className="opt" ref={details}>
        <summary>Position manuell eingeben</summary>
        <div className="in">
          <div className="row2">
            <label className="f">
              <span>Breite (z. B. 54°19,1 N)</span>
              <input
                ref={latInput}
                type="text"
                inputMode="text"
                autoComplete="off"
                value={manual.lat}
                aria-invalid={manual.error ? true : undefined}
                onChange={(e) => {
                  manual.setLat(e.target.value);
                  manual.setError(undefined);
                }}
              />
            </label>
            <label className="f">
              <span>Länge (z. B. 010°08,4 E)</span>
              <input
                type="text"
                inputMode="text"
                autoComplete="off"
                value={manual.lon}
                aria-invalid={manual.error ? true : undefined}
                onChange={(e) => {
                  manual.setLon(e.target.value);
                  manual.setError(undefined);
                }}
              />
            </label>
          </div>
          <p className="muted hint">Auch möglich: 54 19,1 · 54.318 · Süd und West mit S/W oder Minus. Ost als E oder O.</p>
          {manual.error ? <div className="err" role="alert">{manual.error}</div> : null}
          <button className="btn block" type="button" style={{ marginTop: 12 }} onClick={() => void applyManual()}>
            Position übernehmen
          </button>
        </div>
      </details>
      {error ? <div className="err" role="alert">{error}</div> : null}
    </div>
  );
}

function EntryPhotos({ entry, caption }: { entry: LogEntry; caption?: string | undefined }) {
  const toast = useToast();
  const { onAdd, progress } = usePhotoImport({ kind: 'entry', entry });
  const onRemove = async (photoId: ID): Promise<void> => {
    try {
      await removePhotoFromEntry(db, entry.id, photoId);
    } catch (e) {
      toast(writeErrorMessage(e, 'Foto konnte nicht entfernt werden'));
    }
  };
  return (
    <PhotoPicker
      maxCount={MAX_PHOTOS_PER_ENTRY}
      photoIds={entry.photoIds}
      onAdd={onAdd}
      onRemove={onRemove}
      progress={progress}
      caption={caption}
    />
  );
}

function EntryForm({
  entry, isNew, by, boats, adminEdit, onClose,
}: {
  entry: LogEntry; isNew: boolean; by: string | undefined; boats: readonly Boat[]; adminEdit: boolean; onClose: () => void;
}) {
  const toast = useToast();
  const [boatId, setBoatId] = useState(entry.boatId);
  const [timeValue, setTimeValue] = useState(toLocalInput(entry.time, entry.tzOffsetMin));
  const [type, setType] = useState<EntryType>(entry.type);
  const [dir, setDir] = useState(entry.windDirDeg);
  const [bft, setBft] = useState(entry.windBft);
  const [sky, setSky] = useState(entry.sky);
  const [sea, setSea] = useState(entry.seaState);
  const [hpa, setHpa] = useState(numText(entry.pressureHpa));
  const [temp, setTemp] = useState(numText(entry.tempC));
  const [text, setText] = useState(entry.text ?? '');
  const [confirming, setConfirming] = useState(false);
  const [manLat, setManLat] = useState('');
  const [manLon, setManLon] = useState('');
  const [manError, setManError] = useState<string>();
  const manual: ManualPos = { lat: manLat, lon: manLon, setLat: setManLat, setLon: setManLon, error: manError, setError: setManError };
  const closing = useRef(false);
  const deleteBtn = useRef<HTMLButtonElement>(null);

  const newTime = fromLocalInput(timeValue, entry.tzOffsetMin) ?? entry.time;
  const title = `${isNew ? 'Eintrag ergänzen' : 'Eintrag'} · ${formatTime(newTime, entry.tzOffsetMin)}`;

  const patch = {
    boatId,
    time: newTime,
    type,
    text: text.trim() === '' ? undefined : text,
    windDirDeg: dir,
    windBft: bft,
    sky,
    seaState: sea,
    pressureHpa: parseDecimal(hpa),
    tempC: parseDecimal(temp),
  };
  const dirty = (Object.keys(patch) as (keyof typeof patch)[]).some((k) => {
    const before = k === 'text' && entry.text === '' ? undefined : entry[k];
    return patch[k] !== before;
  });

  /**
   * Schließen: Änderungen automatisch speichern (`force` = auch ohne Änderungen, für „Speichern“).
   * Gibt false zurück, wenn das Sheet offen bleiben muss (Eingabefehler, Speichern fehlgeschlagen).
   */
  const finish = async (force: boolean): Promise<boolean> => {
    if (closing.current) return false;
    const man = readManual(manual);
    if (man && 'error' in man) {
      setManError(man.error);
      return false;
    }
    if (!dirty && !force && !man) {
      onClose();
      return true;
    }
    closing.current = true;
    try {
      await updateEntry(db, entry.id, patch);
      if (man) await setEntryPosition(db, entry.id, { lat: man.lat, lon: man.lon });
    } catch (e) {
      closing.current = false;
      toast(writeErrorMessage(e, 'Eintrag konnte nicht gespeichert werden'));
      return false;
    }
    toast(`Eintrag ${formatTime(newTime, entry.tzOffsetMin)} gespeichert`);
    onClose();
    return true;
  };
  const save = (): Promise<boolean> => finish(true);

  const remove = async (): Promise<void> => {
    const t = formatTime(entry.time, entry.tzOffsetMin);
    try {
      await deleteEntry(db, entry.id);
    } catch (e) {
      toast(writeErrorMessage(e, 'Eintrag konnte nicht gelöscht werden'));
      return;
    }
    toast(`Eintrag ${t} gelöscht`);
    onClose();
  };

  const subtitle = subtitleOf(entry, by);

  const footer = confirming ? (
    <div className="confirm" role="alertdialog" aria-label="Löschen bestätigen">
      <p>Diesen Eintrag wirklich löschen?</p>
      <button
        className="btn"
        type="button"
        autoFocus
        onClick={() => {
          setConfirming(false);
          setTimeout(() => deleteBtn.current?.focus());
        }}
      >
        Abbrechen
      </button>
      <button className="btn danger" type="button" onClick={() => void remove()}>
        Endgültig löschen
      </button>
    </div>
  ) : (
    <>
      <button
        ref={deleteBtn}
        className="btn danger icon-only"
        type="button"
        aria-label="Löschen"
        onClick={() => setConfirming(true)}
      >
        <Icon name="trash" size={22} />
      </button>
      <button className="btn primary" type="button" onClick={() => void save()}>
        Speichern
      </button>
    </>
  );

  return (
    <Sheet title={title} subtitle={subtitle} onClose={() => finish(false)} footer={footer}>
      {adminEdit ? (
        <div className="note" role="note">
          <b>Admin-Bearbeitung</b>
          {originText(by, boats.find((b) => b.id === entry.boatId))}. Als Admin darfst du ihn ändern oder löschen.
        </div>
      ) : null}
      {boats.length > 1 ? (
        <fieldset>
          <legend>Boot</legend>
          <BoatChips boats={boats} value={boatId} onChange={(id) => id && setBoatId(id)} label="Boot" />
        </fieldset>
      ) : null}
      <label className="f">
        <span>Zeit</span>
        <input type="datetime-local" value={timeValue} onChange={(e) => setTimeValue(e.target.value)} />
      </label>
      <PositionSection entry={entry} manual={manual} />
      <fieldset>
        <legend>Typ</legend>
        <div className="chips" role="radiogroup" aria-label="Eintragstyp">
          {ENTRY_TYPES.map((t) => (
            <button
              key={t}
              className="chip"
              type="button"
              role="radio"
              aria-checked={type === t}
              onClick={() => setType(t)}
            >
              <Icon name={ENTRY_ICON[t]} size={18} />
              {ENTRY_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Windrichtung (Wind aus …)</legend>
        <WindRose valueDeg={dir} onChange={setDir} />
      </fieldset>
      <fieldset>
        <legend>Windstärke (Beaufort)</legend>
        <BeaufortBar value={bft} onChange={setBft} />
      </fieldset>
      <fieldset>
        <legend>Wetter</legend>
        <div className="grid3">
          {SKIES.map((s) => (
            <button key={s} className="chip" type="button" aria-pressed={sky === s} onClick={() => setSky(toggle(sky, s))}>
              <Icon name={SKY_ICON[s]} size={26} />
              {SKY_LABELS[s]}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Seegang</legend>
        <div className="chips">
          {SEAS.map((s) => (
            <button key={s} className="chip" type="button" aria-pressed={sea === s} onClick={() => setSea(toggle(sea, s))}>
              {SEA_STATE_LABELS[s]}
            </button>
          ))}
        </div>
      </fieldset>
      <details className="opt">
        <summary>Luftdruck &amp; Temperatur (optional)</summary>
        <div className="in row2">
          <label className="f">
            <span>Luftdruck (hPa)</span>
            <input type="number" inputMode="numeric" placeholder="1015" value={hpa} onChange={(e) => setHpa(e.target.value)} />
          </label>
          <label className="f">
            <span>Temperatur (°C)</span>
            <input type="number" inputMode="decimal" placeholder="19" value={temp} onChange={(e) => setTemp(e.target.value)} />
          </label>
        </div>
      </details>
      <label className="f">
        <span>Text</span>
        <textarea
          placeholder="Was ist passiert? Kurs, Segelstellung, Stimmung …"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <fieldset>
        <legend>Fotos (bis zu {MAX_PHOTOS_PER_ENTRY})</legend>
        <EntryPhotos entry={entry} caption={photoCaption([formatTime(entry.time, entry.tzOffsetMin), boats.find((b) => b.id === boatId)?.name, by])} />
      </fieldset>
    </Sheet>
  );
}
