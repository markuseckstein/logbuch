import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { saveOrShareFile } from '../../device';
import { db } from '../../db/db';
import { useEntries } from '../../db/hooks';
import { loadTripData } from '../../db/repo';
import { getStorageEstimate } from '../../db/storage';
import type { Trip } from '../../domain';
import { exportFileName, exportJson, exportZip } from '../../io';
import { Icon } from '../icons';
import { useToast } from '../toast';
import { ImportLogbook } from './ImportLogbook';

const mb = (bytes: number): string => (bytes / 1_000_000).toFixed(1).replace('.', ',');

/** Export (ZIP / JSON) und Logbuch-Import (Merge). */
export function ExportCard({ trip }: { trip: Trip }) {
  const toast = useToast();
  const entries = useEntries(trip.id);
  const photoCount = useLiveQuery(() => db.photos.where('tripId').equals(trip.id).count(), [trip.id]);
  const [usage, setUsage] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

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

  return (
    <section className="card" aria-label="Export">
      <div className="legend">Export &amp; Import</div>
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
      <ImportLogbook />
      {error ? (
        <div className="err" role="alert">
          {error}
        </div>
      ) : null}
      <p className="muted">
        Sichere den Törn regelmäßig (ZIP) und lege die Datei an einem zweiten Ort ab – die Daten liegen nur in diesem
        Browser. Beim Import werden Einträge mit dem vorhandenen Logbuch zusammengeführt.
      </p>
    </section>
  );
}
