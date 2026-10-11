import { createContext, useContext, useMemo, useState, type CSSProperties } from 'react';
import { db } from '../db/db';
import { setBoatSelection } from '../db/repo';
import {
  boatStyle, defaultEntryBoat, resolveBoatSelection, shownBoatIds, type Boat, type BoatSelection, type CrewMember, type ID,
  type Settings,
} from '../domain';
import { Dialog } from './components/Dialog';

/** CSS-Variable `--c` mit der Bootsfarbe (für Rahmen, Symbole, Timeline-Punkte). */
export function boatColor(boat: Pick<Boat, 'colorIndex'>): CSSProperties {
  return { '--c': `var(--b${boatStyle(boat)})` } as CSSProperties;
}

/** Symbolform des Boots (1 Kreis, 2 Quadrat, 3 Dreieck, 4 Raute) in Bootsfarbe. */
export function BoatShape({ boat, size }: { boat: Pick<Boat, 'colorIndex'>; size?: number }) {
  const style = { ...boatColor(boat), ...(size ? { width: size, height: size } : {}) };
  return <i className={`bsh s${boatStyle(boat)}`} style={style} aria-hidden="true" />;
}

export function BoatBadge({ boat }: { boat: Boat }) {
  return (
    <span className="bb" style={boatColor(boat)}>
      <BoatShape boat={boat} />
      {boat.name}
    </span>
  );
}

export interface BoatSelectionState {
  /** Boote des Törns (ohne entfernte). */
  boats: Boat[];
  /** Stellung des Schalters (bei einem Boot dieses Boot); undefined ohne Boote. */
  selection: BoatSelection | undefined;
  /** Gewähltes Boot (undefined bei „Alle“). */
  selected: Boat | undefined;
  /** Ids der angezeigten Boote. */
  shownIds: ID[];
  select: (s: BoatSelection) => void;
  /** Vorauswahl für einen neuen Eintrag (Pflichtauswahl, falls undefined). */
  entryDefault: ID | undefined;
  /** Vorgeschlagenes Boot der eigenen Person. */
  suggested: ID | undefined;
}

/** Boot-Schalter des aktiven Törns (lokal gespeichert, Erstwahl = Vorschlag der eigenen Person). */
export function useBoatSelectionState(
  tripId: ID, boats: readonly Boat[], settings: Settings | undefined, me: CrewMember | undefined,
): BoatSelectionState {
  const suggested = me?.suggestedBoatId;
  const stored = settings?.boatSelectionByTrip[tripId];
  const last = settings?.lastBoatByTrip[tripId];
  // sofortige Anzeige, auch bevor der Wert in den Einstellungen angekommen ist
  const [optimistic, setOptimistic] = useState<BoatSelection>();
  return useMemo(() => {
    const list = [...boats];
    const selection = resolveBoatSelection({ boats: list, stored: optimistic ?? stored, suggested });
    const selected = selection && selection !== 'all' ? list.find((b) => b.id === selection) : undefined;
    return {
      boats: list,
      selection,
      selected,
      shownIds: shownBoatIds(list, selection),
      select: (s: BoatSelection) => {
        setOptimistic(s);
        void setBoatSelection(db, tripId, s);
      },
      entryDefault: defaultEntryBoat({ boats: list, selection, last, suggested }),
      suggested,
    };
  }, [boats, optimistic, stored, suggested, last, tripId]);
}

const NO_SELECTION: BoatSelectionState = {
  boats: [], selection: undefined, selected: undefined, shownIds: [], select: () => undefined,
  entryDefault: undefined, suggested: undefined,
};

export const BoatSelectionContext = createContext<BoatSelectionState>(NO_SELECTION);
export const useBoatSelection = (): BoatSelectionState => useContext(BoatSelectionContext);

/** Segment-Schalter „Boot A | Boot B | Alle“ (ausgeblendet bei nur einem Boot). */
export function BoatSwitch() {
  const { boats, selection, select } = useBoatSelection();
  if (boats.length < 2) return null;
  const columns = [...boats.map(() => 'minmax(0,1.3fr)'), 'minmax(0,.75fr)'].join(' ');
  return (
    <div className="seg" role="radiogroup" aria-label="Boot wählen" style={{ gridTemplateColumns: columns }}>
      {boats.map((b) => (
        <button key={b.id} type="button" role="radio" aria-checked={selection === b.id} style={boatColor(b)} onClick={() => select(b.id)}>
          <BoatShape boat={b} />
          <span className="t">{b.name}</span>
        </button>
      ))}
      <button type="button" role="radio" aria-checked={selection === 'all'} onClick={() => select('all')}>
        <span className="t">Alle</span>
      </button>
    </div>
  );
}

interface BoatChipsProps {
  boats: readonly Boat[];
  value: ID | undefined;
  onChange: (id: ID | undefined) => void;
  label: string;
  /** Zusätzliche Option „Kein Vorschlag“ (value undefined). */
  noneLabel?: string;
  disabled?: boolean;
}

/** Bootsauswahl als Chips (Radiogruppe). */
export function BoatChips({ boats, value, onChange, label, noneLabel, disabled }: BoatChipsProps) {
  return (
    <div className="chips" role="radiogroup" aria-label={label}>
      {noneLabel ? (
        <button className="chip" type="button" role="radio" aria-checked={value === undefined} disabled={disabled} onClick={() => onChange(undefined)}>
          {noneLabel}
        </button>
      ) : null}
      {boats.map((b) => (
        <button
          key={b.id}
          className="chip"
          type="button"
          role="radio"
          aria-checked={value === b.id}
          style={boatColor(b)}
          disabled={disabled}
          onClick={() => onChange(b.id)}
        >
          <BoatShape boat={b} />
          {b.name}
        </button>
      ))}
    </div>
  );
}

interface BoatChooserProps {
  title: string;
  confirmLabel: string;
  hint?: string;
  onConfirm: (boatId: ID) => void;
  onCancel: () => void;
}

/** Pflichtauswahl „Für welches Boot?“ (Boot-Schalter auf „Alle“). */
export function BoatChooser({ title, confirmLabel, hint, onConfirm, onCancel }: BoatChooserProps) {
  const { boats, entryDefault } = useBoatSelection();
  // Vorauswahl folgt `entryDefault` (Einstellungen kommen per liveQuery evtl. erst nach dem Öffnen), bis der Nutzer wählt
  const [picked, setBoatId] = useState<ID>();
  const boatId = picked ?? entryDefault;
  const [error, setError] = useState(false);
  return (
    <Dialog title={title} onClose={onCancel}>
      <fieldset>
        <legend>
          Für welches Boot? <em className="req">Pflicht</em>
        </legend>
        <BoatChips boats={boats} value={boatId} onChange={(id) => { setBoatId(id); setError(false); }} label="Für welches Boot?" />
      </fieldset>
      {error ? (
        <div className="err" role="alert">
          Bitte zuerst ein Boot wählen.
        </div>
      ) : null}
      {hint ? <p className="muted">{hint}</p> : null}
      <div className="share-choice">
        <button
          className="btn primary block"
          type="button"
          onClick={() => (boatId ? onConfirm(boatId) : setError(true))}
        >
          {confirmLabel}
        </button>
        <button className="btn block" type="button" onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </Dialog>
  );
}
