import { useState } from 'react';
import { resizeImage } from '../../device';
import { db } from '../../db/db';
import { MAX_PHOTOS_PER_ENTRY, addPhotoToEntry, removePhotoFromEntry } from '../../db/repo';
import { usePhotoUrl } from '../../db/hooks';
import type { ID } from '../../domain';
import { Icon } from '../icons';
import { useToast } from '../toast';

interface PhotoSlotsProps {
  entryId: ID;
  photoIds: readonly ID[];
}

function FilledSlot({ photoId, index, onRemove }: { photoId: ID; index: number; onRemove: () => void }) {
  const url = usePhotoUrl(photoId);
  return (
    <div className="slotwrap">
      <div className="slot">{url ? <img src={url} alt={`Foto ${index + 1}`} /> : null}</div>
      <button className="slot-x" type="button" aria-label={`Foto ${index + 1} entfernen`} onClick={onRemove}>
        <span>
          <Icon name="x" size={16} />
        </span>
      </button>
    </div>
  );
}

/** Bis zu 3 Fotos; Hinzufügen/Entfernen wird sofort in der DB persistiert. */
export function PhotoSlots({ entryId, photoIds }: PhotoSlotsProps) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const add = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setBusy(true);
    try {
      const img = await resizeImage(file);
      await addPhotoToEntry(db, entryId, img);
    } catch {
      toast('Foto konnte nicht gespeichert werden');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (photoId: ID): Promise<void> => {
    try {
      await removePhotoFromEntry(db, entryId, photoId);
    } catch {
      toast('Foto konnte nicht entfernt werden');
    }
  };

  return (
    <div className="slots">
      {Array.from({ length: MAX_PHOTOS_PER_ENTRY }, (_, i) => {
        const photoId = photoIds[i];
        if (photoId) return <FilledSlot key={photoId} photoId={photoId} index={i} onRemove={() => void remove(photoId)} />;
        return (
          <div className="slotwrap" key={`empty-${i}`}>
            <input
              className="sr-only"
              type="file"
              accept="image/*"
              id={`photo-${i}`}
              aria-label={`Foto ${i + 1} wählen`}
              disabled={busy}
              onChange={(ev) => {
                const file = ev.target.files?.[0];
                ev.target.value = '';
                void add(file);
              }}
            />
            <label className="slot" htmlFor={`photo-${i}`}>
              <Icon name="cam" size={24} />
              Foto {i + 1}
            </label>
          </div>
        );
      })}
    </div>
  );
}
