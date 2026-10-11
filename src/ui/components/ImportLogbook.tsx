import { useState } from 'react';
import { pickFile } from '../../device';
import { db } from '../../db/db';
import { listCrew, listWritableTripIds, mergeBundle, setActiveTrip, setAuthor, setFlotilla, type MergeSummary, type TripBundle } from '../../db/repo';
import { activeCrew, type Flotilla, type Trip } from '../../domain';
import { ImportFormatError, importJson, importZip } from '../../io';
import { Icon } from '../icons';
import { useToast } from '../toast';
import { requestAuthorPrompt } from '../authorPrompt';
import { Dialog } from './Dialog';

/** „Logbuch ‹Boot›: 5 neu · 2 geändert · 1 gelöscht · 3 Fotos“ */
export function mergeMessage(boat: string, r: Pick<MergeSummary, 'added' | 'updated' | 'deleted' | 'photosAdded'>): string {
  const photos = `${r.photosAdded} ${r.photosAdded === 1 ? 'Foto' : 'Fotos'}`;
  return `Logbuch ${boat}: ${r.added} neu · ${r.updated} geändert · ${r.deleted} gelöscht · ${photos}`;
}

const boatOf = (bundle: TripBundle): string => bundle.trip.boat.name.trim() || bundle.trip.name;

interface JoinOffer {
  flotilla: Flotilla;
  tripId: string;
}


/**
 * „Logbuch importieren“: Datei wählen, bei unbekanntem Logbuch nach dem Besitz fragen, mergen,
 * Zusammenfassung melden, ggf. „Ich bin …“ klären bzw. Flottille-Beitritt anbieten.
 * `trip` = aktiver Törn (fehlt beim ersten Start).
 */
export function ImportLogbook({ trip }: { trip?: Trip }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [unknown, setUnknown] = useState<TripBundle>();
  const [offer, setOffer] = useState<JoinOffer>();
  const finishImport = async (bundle: TripBundle, ownership: 'own' | 'foreign'): Promise<void> => {
    setBusy(true);
    try {
      const sum = await mergeBundle(db, bundle, { ownership });
      toast(mergeMessage(boatOf(bundle), sum), 5000);
      const merged = await db.trips.get(sum.tripId);
      const writable = await listWritableTripIds(db);
      if (sum.tripCreated && ownership === 'own' && merged) {
        // Mein Boot: aktiv setzen, vorher „Ich bin …“ klären.
        const crew = activeCrew(await listCrew(db, merged.id));
        const [only] = crew;
        if (crew.length === 1 && only) await setAuthor(db, merged.id, only.id);
        await setActiveTrip(db, merged.id);
        if (crew.length > 1) requestAuthorPrompt(merged.id);
      } else if (merged?.flotilla && !writable.includes(merged.id) && trip !== undefined && writable.includes(trip.id) && !trip.flotilla) {
        setOffer({ flotilla: merged.flotilla, tripId: trip.id });
      }
    } catch {
      setError('Der Import ist fehlgeschlagen.');
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
      if (!(await db.trips.get(bundle.trip.id))) {
        setUnknown(bundle);
        return;
      }
    } catch (e) {
      setError(
        e instanceof ImportFormatError
          ? `Import nicht möglich: ${e.message}`
          : 'Die Datei konnte nicht importiert werden. Ist es ein Logbuch (ZIP oder JSON)?',
      );
      return;
    } finally {
      setBusy(false);
    }
    await finishImport(bundle, 'foreign'); // bekannter Trip: Besitz bleibt unverändert
  };

  const chooseOwnership = (ownership: 'own' | 'foreign'): void => {
    const bundle = unknown;
    setUnknown(undefined);
    if (bundle) void finishImport(bundle, ownership);
  };

  const joinFlotilla = async (): Promise<void> => {
    const o = offer;
    setOffer(undefined);
    if (!o) return;
    try {
      await setFlotilla(db, o.tripId, o.flotilla);
      toast(`Flottille „${o.flotilla.name}“ beigetreten`);
    } catch {
      setError('Der Flottille konnte nicht beigetreten werden.');
    }
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
      {unknown ? (
        <Dialog title={`Neues Logbuch: ${boatOf(unknown)}`} onClose={() => setUnknown(undefined)}>
          <p className="muted">
            Dieses Logbuch ist auf diesem Gerät noch nicht vorhanden. Gehört es zu deinem Boot und schreibst du hier
            mit – oder willst du es nur ansehen?
          </p>
          <div className="share-choice">
            <button className="btn primary block" type="button" onClick={() => chooseOwnership('own')}>
              Mein Boot – ich schreibe mit
            </button>
            <button className="btn block" type="button" onClick={() => chooseOwnership('foreign')}>
              Anderes Boot – nur lesen
            </button>
            <button className="btn block" type="button" onClick={() => setUnknown(undefined)}>
              Abbrechen
            </button>
          </div>
        </Dialog>
      ) : null}
      {offer ? (
        <Dialog title={`Flottille „${offer.flotilla.name}“ beitreten?`} onClose={() => setOffer(undefined)}>
          <p className="muted">
            Das importierte Logbuch gehört zur Flottille „{offer.flotilla.name}“. Tritt mit deinem Boot bei, um die
            anderen Boote auf der Karte zu sehen.
          </p>
          <div className="share-choice">
            <button className="btn primary block" type="button" onClick={() => void joinFlotilla()}>
              Beitreten
            </button>
            <button className="btn block" type="button" onClick={() => setOffer(undefined)}>
              Nicht jetzt
            </button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
