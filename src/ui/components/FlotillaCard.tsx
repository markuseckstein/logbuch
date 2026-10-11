import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { saveOrShareFile } from '../../device';
import { db } from '../../db/db';
import { listFlotillaTrips, loadTripData, setActiveTrip, setFlotilla } from '../../db/repo';
import type { Trip } from '../../domain';
import { exportZip } from '../../io';
import { Icon } from '../icons';
import { shareFileName } from '../lib';
import { useSettings } from '../hooks';
import { useToast } from '../toast';
import { Dialog } from './Dialog';
import { OwnershipBadge } from './OwnershipBadge';

const boatLabel = (t: Trip): string => t.boat.name.trim() || t.name;

/** Logbuch als ZIP teilen (Web Share bzw. Download); `includePhotos: false` = klein, ohne Bilddaten. */
export async function shareLogbook(
  trip: Trip,
  includePhotos: boolean,
): Promise<'shared' | 'downloaded' | 'cancelled' | undefined> {
  const bundle = await loadTripData(db, trip.id);
  const blob = await exportZip(bundle, { includePhotos });
  const name = shareFileName(trip, new Date(), includePhotos);
  const res = await saveOrShareFile(blob, name);
  return res;
}

export function FlotillaCard({ trip, readOnly }: { trip: Trip; readOnly: boolean }) {
  const toast = useToast();
  const settings = useSettings();
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const flotilla = trip.flotilla;
  const boats = useLiveQuery(() => (flotilla ? listFlotillaTrips(db, flotilla.id) : []), [flotilla?.id]) ?? [];

  const found = async (): Promise<void> => {
    const n = name.trim();
    if (!n) {
      setError('Bitte einen Namen für die Flottille eingeben.');
      return;
    }
    setError(undefined);
    try {
      await setFlotilla(db, trip.id, { id: crypto.randomUUID(), name: n });
      setName('');
      toast(`Flottille „${n}“ gegründet`);
    } catch {
      setError('Die Flottille konnte nicht gegründet werden.');
    }
  };

  const share = async (includePhotos: boolean): Promise<void> => {
    setChoosing(false);
    setBusy(true);
    try {
      const res = await shareLogbook(trip, includePhotos);
      if (res === 'downloaded') toast('Logbuch gespeichert – jetzt per WhatsApp o. Ä. verschicken');
      else if (res === 'shared') toast('Logbuch geteilt');
    } catch {
      setError('Das Logbuch konnte nicht exportiert werden.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="card" aria-label="Flottille">
        <div className="legend">Flottille</div>
        {flotilla ? (
          <>
            <p>
              <b>{flotilla.name}</b>
            </p>
            <ul className="fleetlist" aria-label="Boote der Flottille">
              {boats.map((t) => {
                const own = settings?.writableTripIds.includes(t.id) ?? false;
                return (
                  <li key={t.id}>
                    <span className="triplist-name">
                      <b>{boatLabel(t)}</b>
                      <span className="dmeta">{t.name}</span>
                    </span>
                    <OwnershipBadge own={own} />
                    {t.id === trip.id ? (
                      <span className="role">Aktiv</span>
                    ) : (
                      <button
                        className="btn"
                        type="button"
                        aria-label={`Zu Logbuch „${boatLabel(t)}“ wechseln`}
                        onClick={() =>
                          void setActiveTrip(db, t.id).then(() => toast(`Logbuch „${boatLabel(t)}“ aktiv`))
                        }
                      >
                        Ansehen
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        ) : readOnly ? (
          <p className="muted">Dieses Logbuch gehört zu keiner Flottille.</p>
        ) : (
          <>
            <p className="muted">
              Eine Flottille verbindet die Logbücher mehrerer Boote, damit ihr euch gegenseitig auf der Karte seht.
            </p>
            <label className="f">
              <span>Name der Flottille</span>
              <input type="text" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <button className="btn block" type="button" onClick={() => void found()}>
              Flottille gründen
            </button>
          </>
        )}
        <button className="btn primary block" type="button" disabled={busy} onClick={() => setChoosing(true)}>
          <Icon name="up" size={20} />
          Logbuch teilen
        </button>
        {error ? (
          <div className="err" role="alert">
            {error}
          </div>
        ) : null}
        <p className="muted">
          So tauscht ihr aus: „Logbuch teilen“ erzeugt eine Datei, die ihr per WhatsApp oder Quick Share verschickt. Die
          anderen importieren sie unter „Logbuch importieren“ – dabei werden die Einträge zusammengeführt. Jedes Handy
          desselben Boots teilt seine Version; der Import führt alle zusammen.
        </p>
      </section>
      {choosing ? (
        <Dialog title="Logbuch teilen" onClose={() => setChoosing(false)}>
          <p className="muted">
            Mit Fotos kann die Datei sehr groß werden. Ohne Fotos ist sie klein; die Bilder fehlen dann beim Empfänger.
          </p>
          <div className="share-choice">
            <button className="btn primary block" type="button" onClick={() => void share(true)}>
              Mit Fotos
            </button>
            <button className="btn block" type="button" onClick={() => void share(false)}>
              Ohne Fotos (klein)
            </button>
            <button className="btn block" type="button" onClick={() => setChoosing(false)}>
              Abbrechen
            </button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
