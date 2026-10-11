import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { pickFile, saveOrShareFile } from '../../device';
import { db } from '../../db/db';
import { useEntries } from '../../db/hooks';
import { loadTripData, replaceTripData, setActiveTrip, type TripBundle } from '../../db/repo';
import { getStorageEstimate } from '../../db/storage';
import type { Trip } from '../../domain';
import { ImportFormatError, exportFileName, exportJson, exportZip, importJson, importZip } from '../../io';
import { Icon } from '../icons';
import { useToast } from '../toast';

const mb = (bytes: number): string => (bytes / 1_000_000).toFixed(1).replace('.', ',');

/** Export (ZIP / JSON), Backup-Import mit Bestätigung vor dem Ersetzen. */
export function ExportCard({ trip }: { trip: Trip }) {
  const toast = useToast();
  const entries = useEntries(trip.id);
  const photoCount = useLiveQuery(() => db.photos.where('tripId').equals(trip.id).count(), [trip.id]);
  const [usage, setUsage] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState<TripBundle>();

  useEffect(() => {
    let cancelled = false;
    void getStorageEstimate().then((e) => {
      if (!cancelled && e) setUsage(e.usage);
    });
    return () => {
      cancelled = true;
    };
  }, [entries?.length, photoCount]);

  const run = async (kind: 'zip' | 'json'): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      const bundle = await loadTripData(db, trip.id);
      const blob = kind === 'zip' ? await exportZip(bundle) : await exportJson(bundle);
      const zipName = exportFileName(trip, new Date());
      const name = kind === 'zip' ? zipName : zipName.replace(/\.zip$/, '.json');
      const res = await saveOrShareFile(blob, name);
      if (res === 'downloaded') toast(`${name} gespeichert`);
      else if (res === 'shared') toast(`${name} geteilt`);
    } catch {
      setError('Der Export ist fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const apply = async (bundle: TripBundle): Promise<void> => {
    await replaceTripData(db, bundle);
    await setActiveTrip(db, bundle.trip.id);
    toast(`Törn „${bundle.trip.name}“ importiert`);
  };

  const importBackup = async (): Promise<void> => {
    setError(undefined);
    const file = await pickFile('.zip,application/zip,.json,application/json');
    if (!file) return;
    setBusy(true);
    try {
      const isJson = /\.json$/i.test(file.name) || file.type === 'application/json';
      const bundle = isJson ? await importJson(await file.text()) : await importZip(file);
      if (await db.trips.get(bundle.trip.id)) setPending(bundle);
      else await apply(bundle);
    } catch (e) {
      setError(
        e instanceof ImportFormatError
          ? `Import nicht möglich: ${e.message}`
          : 'Die Datei konnte nicht importiert werden. Ist es ein Logbuch-Backup (ZIP oder JSON)?',
      );
    } finally {
      setBusy(false);
    }
  };

  const confirmReplace = async (): Promise<void> => {
    const bundle = pending;
    setPending(undefined);
    if (!bundle) return;
    setBusy(true);
    try {
      await apply(bundle);
    } catch {
      setError('Der Import ist fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-label="Export">
      <div className="legend">Export &amp; Backup</div>
      <p className="muted num">
        {entries?.length ?? 0} Einträge · {photoCount ?? 0} Bilder
        {usage !== undefined ? ` · Speicher belegt ${mb(usage)} MB` : ''}
      </p>
      <button className="btn primary block" type="button" disabled={busy} onClick={() => void run('zip')}>
        <Icon name="down" size={20} />
        ZIP mit Bildern exportieren
      </button>
      <button className="btn block" type="button" disabled={busy} onClick={() => void run('json')}>
        Einzelnes JSON (Bilder eingebettet)
      </button>
      <button className="btn block" type="button" disabled={busy} onClick={() => void importBackup()}>
        <Icon name="up" size={20} />
        Backup importieren
      </button>
      {pending ? (
        <div className="confirm" role="alertdialog" aria-label="Import bestätigen">
          <p>
            Vorhandenen Törn „{pending.trip.name}“ ersetzen? Alle lokalen Einträge, Fotos und Tracks dieses Törns werden
            überschrieben.
          </p>
          <button className="btn" type="button" autoFocus onClick={() => setPending(undefined)}>
            Abbrechen
          </button>
          <button className="btn danger" type="button" onClick={() => void confirmReplace()}>
            Ersetzen
          </button>
        </div>
      ) : null}
      {error ? (
        <div className="err" role="alert">
          {error}
        </div>
      ) : null}
      <p className="muted">
        Sichere den Törn regelmäßig (ZIP) und lege die Datei an einem zweiten Ort ab – die Daten liegen nur in diesem
        Browser.
      </p>
    </section>
  );
}
