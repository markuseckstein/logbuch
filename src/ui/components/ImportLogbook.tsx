import { useState } from 'react';
import { pickFile } from '../../device';
import { db } from '../../db/db';
import { getAuthor, listCrew, mergeBundle, setActiveTrip, setAuthor, type MergeSummary, type TripBundle } from '../../db/repo';
import { activeCrew } from '../../domain';
import { ImportFormatError, importJson, importZip } from '../../io';
import { Icon } from '../icons';
import { useToast } from '../toast';
import { requestAuthorPrompt } from '../authorPrompt';
import { Dialog } from './Dialog';
import { useCloudUser } from '../cloudHooks';
import { writeErrorMessage } from '../lib';

/** „Törn ‹Name›: 5 neu · 2 geändert · 1 gelöscht · 3 Fotos“ */
export function mergeMessage(trip: string, r: Pick<MergeSummary, 'added' | 'updated' | 'deleted' | 'photosAdded'>): string {
  const photos = `${r.photosAdded} ${r.photosAdded === 1 ? 'Foto' : 'Fotos'}`;
  return `Törn ${trip}: ${r.added} neu · ${r.updated} geändert · ${r.deleted} gelöscht · ${photos}`;
}

/**
 * „Logbuch importieren“: Datei wählen und in denselben Törn mergen bzw. ihn wiederherstellen (gleiche Törn-Id).
 * Ein neuer Törn wird aktiv; mit mehreren Personen fragt die App „Ich bin …“.
 */
export function ImportLogbook() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [confirmNew, setConfirmNew] = useState<TripBundle>();
  const signedIn = useCloudUser()?.isLoggedIn === true;

  const finishImport = async (bundle: TripBundle): Promise<void> => {
    setBusy(true);
    try {
      const sum = await mergeBundle(db, bundle);
      toast(mergeMessage(bundle.trip.name, sum), 5000);
      if (sum.tripCreated) {
        const crew = activeCrew(await listCrew(db, sum.tripId));
        const [only] = crew;
        if (crew.length === 1 && only) await setAuthor(db, sum.tripId, only.id);
        await setActiveTrip(db, sum.tripId);
        if (crew.length > 1 && !(await getAuthor(db, sum.tripId))) requestAuthorPrompt(sum.tripId);
      }
    } catch (e) {
      setError(writeErrorMessage(e, 'Der Import ist fehlgeschlagen.'));
    } finally {
      setBusy(false);
    }
  };

  const importLogbook = async (): Promise<void> => {
    setError(undefined);
    const file = await pickFile('.zip,application/zip,.json,application/json');
    if (!file) return;
    setBusy(true);
    let bundle: TripBundle;
    try {
      const isJson = /\.json$/i.test(file.name) || file.type === 'application/json';
      bundle = isJson ? await importJson(await file.text()) : await importZip(file);
    } catch (e) {
      setError(
        e instanceof ImportFormatError
          ? `Import nicht möglich: ${e.message}`
          : 'Die Datei konnte nicht importiert werden. Ist es ein Logbuch (ZIP oder JSON)?',
      );
      setBusy(false);
      return;
    }
    setBusy(false);
    if (signedIn && !(await db.trips.get(bundle.trip.id))) setConfirmNew(bundle);
    else await finishImport(bundle);
  };

  return (
    <>
      <button className="btn block" type="button" disabled={busy} onClick={() => void importLogbook()}>
        <Icon name="up" size={20} />
        Logbuch importieren
      </button>
      {error ? (
        <div className="err" role="alert">
          {error}
        </div>
      ) : null}
      {confirmNew ? (
        <Dialog title={`Törn importieren: ${confirmNew.trip.name}`} onClose={() => setConfirmNew(undefined)}>
          <p className="muted">
            Du bist angemeldet. Ist dieser Törn schon mit der Crew geteilt, lass dich lieber einladen: eine
            importierte Kopie würde sich mit der geteilten Fassung überschneiden und wieder entfernt.
          </p>
          <div className="share-choice">
            <button
              className="btn primary block"
              type="button"
              onClick={() => {
                const b = confirmNew;
                setConfirmNew(undefined);
                void finishImport(b);
              }}
            >
              Trotzdem importieren
            </button>
            <button className="btn block" type="button" onClick={() => setConfirmNew(undefined)}>
              Abbrechen
            </button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
