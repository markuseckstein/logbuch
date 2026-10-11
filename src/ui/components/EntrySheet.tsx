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
  type Boat,
  type EntryType,
  type ID,
  type LogEntry,
} from '../../domain';
import { ENTRY_ICON, Icon, SKY_ICON } from '../icons';
import { BoatChips, boatColor } from '../boats';
import { useMyCrewId, useTripAccessState } from '../cloudHooks';
import { ENTRY_TYPES, FIX_ERROR_LABEL, authorName, fromLocalInput, parseDecimal, toLocalInput, writeErrorMessage } from '../lib';
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
      <EntryReadOnly entry={entry} />
    </Sheet>
  );
}

function PositionSection({ entry }: { entry: LogEntry }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const stopRef = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => stopRef.current?.(), []);

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
    if (!res.position) setError(`Keine Position (GPS: ${res.error ? FIX_ERROR_LABEL[res.error] : 'nicht verfügbar'})`);
    setBusy(false);
  };

  const applyManual = async (): Promise<void> => {
    const la = parseDecimal(lat);
    const lo = parseDecimal(lon);
    if (la === undefined || lo === undefined || Math.abs(la) > 90 || Math.abs(lo) > 180) {
      setError('Bitte Breite (−90 bis 90) und Länge (−180 bis 180) als Dezimalgrad angeben.');
      return;
    }
    setError(undefined);
    await setEntryPosition(db, entry.id, { lat: la, lon: lo });
    setLat('');
    setLon('');
    toast('Position übernommen');
  };

  return (
    <div className="card pos-card">
      {!entry.position ? (
        <button className="btn block" type="button" disabled={busy} onClick={() => void capture()}>
          {busy ? 'Position wird bestimmt …' : 'Position jetzt erfassen'}
        </button>
      ) : null}
      <details className="opt">
        <summary>Position manuell eingeben</summary>
        <div className="in">
          <div className="row2">
            <label className="f">
              <span>Breite (°, z. B. 54.318)</span>
              <input type="text" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
            </label>
            <label className="f">
              <span>Länge (°, z. B. 10.141)</span>
              <input type="text" inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} />
            </label>
          </div>
          <button className="btn block" type="button" style={{ marginTop: 12 }} onClick={() => void applyManual()}>
            Position übernehmen
          </button>
        </div>
      </details>
      {error ? <div className="err" role="alert">{error}</div> : null}
    </div>
  );
}

function EntryPhotos({ entry }: { entry: LogEntry }) {
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
  const deleteBtn = useRef<HTMLButtonElement>(null);

  const newTime = fromLocalInput(timeValue, entry.tzOffsetMin) ?? entry.time;
  const title = `${isNew ? 'Eintrag ergänzen' : 'Eintrag'} · ${formatTime(newTime, entry.tzOffsetMin)}`;

  const save = async (): Promise<void> => {
    try {
      await updateEntry(db, entry.id, {
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
      });
    } catch (e) {
      toast(writeErrorMessage(e, 'Eintrag konnte nicht gespeichert werden'));
      return;
    }
    toast(`Eintrag ${formatTime(newTime, entry.tzOffsetMin)} gespeichert`);
    onClose();
  };

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
      <button ref={deleteBtn} className="btn danger" type="button" onClick={() => setConfirming(true)}>
        <Icon name="trash" size={20} />
        Löschen
      </button>
      <button className="btn primary" type="button" onClick={() => void save()}>
        Speichern
      </button>
    </>
  );

  return (
    <Sheet title={title} subtitle={subtitle} onClose={onClose} footer={footer}>
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
      <PositionSection entry={entry} />
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
        <EntryPhotos entry={entry} />
      </fieldset>
    </Sheet>
  );
}
