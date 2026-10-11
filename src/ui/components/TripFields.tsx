import type { Boat, Trip } from '../../domain';

export interface TripDraft {
  name: string;
  startDate: string;
  endDate: string;
  area: string;
}

export interface BoatDraft {
  name: string;
  model: string;
  lengthM: string;
  homePort: string;
  callSign: string;
  mmsi: string;
}

export const emptyTripDraft = (): TripDraft => ({ name: '', startDate: '', endDate: '', area: '' });
export const emptyBoatDraft = (): BoatDraft => ({ name: '', model: '', lengthM: '', homePort: '', callSign: '', mmsi: '' });

export const tripDraftOf = (t: Trip): TripDraft => ({
  name: t.name,
  startDate: t.startDate ?? '',
  endDate: t.endDate ?? '',
  area: t.area ?? '',
});

export const boatDraftOf = (b: Pick<Boat, 'name' | 'model' | 'lengthM' | 'homePort' | 'callSign' | 'mmsi'>): BoatDraft => ({
  name: b.name,
  model: b.model ?? '',
  lengthM: b.lengthM === undefined ? '' : String(b.lengthM),
  homePort: b.homePort ?? '',
  callSign: b.callSign ?? '',
  mmsi: b.mmsi ?? '',
});

const opt = (s: string): string | undefined => (s.trim() === '' ? undefined : s.trim());

export const tripPatchOf = (d: TripDraft) => ({
  name: d.name.trim(),
  startDate: opt(d.startDate),
  endDate: opt(d.endDate),
  area: opt(d.area),
});

/** Gibt eine Fehlermeldung zurück, wenn der Entwurf nicht gespeichert werden darf. */
export function validateTrip(d: TripDraft): string | undefined {
  if (!d.name.trim()) return 'Bitte gib dem Törn einen Namen.';
  if (d.startDate && d.endDate && d.endDate < d.startDate) return 'Das Ende liegt vor dem Start.';
  return undefined;
}

interface FieldsProps<T> {
  value: T;
  onChange: (next: T) => void;
  autoFocus?: boolean;
}

export function TripFields({ value, onChange, autoFocus }: FieldsProps<TripDraft>) {
  const set = (patch: Partial<TripDraft>): void => onChange({ ...value, ...patch });
  return (
    <>
      <label className="f">
        <span>Name des Törns</span>
        <input
          type="text"
          autoFocus={autoFocus}
          placeholder="z. B. Sommertörn 2027"
          value={value.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>
      <div className="row2">
        <label className="f">
          <span>Von</span>
          <input type="date" value={value.startDate} onChange={(e) => set({ startDate: e.target.value })} />
        </label>
        <label className="f">
          <span>Bis</span>
          <input type="date" value={value.endDate} onChange={(e) => set({ endDate: e.target.value })} />
        </label>
      </div>
      <label className="f">
        <span>Revier (optional)</span>
        <input type="text" value={value.area} onChange={(e) => set({ area: e.target.value })} />
      </label>
    </>
  );
}

export function BoatFields({ value, onChange, full = true }: FieldsProps<BoatDraft> & { full?: boolean }) {
  const set = (patch: Partial<BoatDraft>): void => onChange({ ...value, ...patch });
  return (
    <>
      <label className="f">
        <span>Bootsname</span>
        <input type="text" value={value.name} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <div className="row2">
        <label className="f">
          <span>Typ / Modell</span>
          <input type="text" value={value.model} onChange={(e) => set({ model: e.target.value })} />
        </label>
        <label className="f">
          <span>Länge (m)</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            value={value.lengthM}
            onChange={(e) => set({ lengthM: e.target.value })}
          />
        </label>
      </div>
      <label className="f">
        <span>Heimathafen</span>
        <input type="text" value={value.homePort} onChange={(e) => set({ homePort: e.target.value })} />
      </label>
      {full ? (
        <div className="row2">
          <label className="f">
            <span>Rufzeichen</span>
            <input type="text" value={value.callSign} onChange={(e) => set({ callSign: e.target.value })} />
          </label>
          <label className="f">
            <span>MMSI</span>
            <input type="text" inputMode="numeric" value={value.mmsi} onChange={(e) => set({ mmsi: e.target.value })} />
          </label>
        </div>
      ) : null}
    </>
  );
}
