import { useId } from 'react';
import { usePhotoUrl } from '../../db/hooks';
import type { ID } from '../../domain';
import { Icon } from '../icons';

interface PhotoPickerProps {
  maxCount: number;
  photoIds: readonly ID[];
  onAdd: (files: File[]) => void | Promise<void>;
  onRemove: (id: ID) => void | Promise<void>;
  /** Fortschrittstext, solange Fotos verarbeitet werden (sperrt die Buttons). */
  progress?: string;
}

function Tile({ photoId, index, onRemove }: { photoId: ID; index: number; onRemove: () => void }) {
  const url = usePhotoUrl(photoId);
  return (
    <div className="slotwrap">
      <div className="slot filled">{url ? <img src={url} alt={`Foto ${index + 1}`} /> : null}</div>
      <button className="slot-x" type="button" aria-label={`Foto ${index + 1} entfernen`} onClick={onRemove}>
        <span>
          <Icon name="x" size={16} />
        </span>
      </button>
    </div>
  );
}

/** Galerie (Mehrfachauswahl) + Kamera, Vorschau-Raster der vorhandenen Fotos mit Entfernen. */
export function PhotoPicker({ maxCount, photoIds, onAdd, onRemove, progress }: PhotoPickerProps) {
  const uid = useId();
  const full = photoIds.length >= maxCount;
  const disabled = full || progress !== undefined;
  const pick = (files: FileList | null, input: HTMLInputElement): void => {
    const list = files ? Array.from(files) : [];
    input.value = '';
    if (list.length > 0) void onAdd(list);
  };
  return (
    <div className="photopicker">
      <div className="photo-actions">
        <input
          className="sr-only"
          type="file"
          accept="image/*"
          multiple
          id={`${uid}-gallery`}
          disabled={disabled}
          onChange={(ev) => pick(ev.target.files, ev.target)}
        />
        <label className="btn" htmlFor={`${uid}-gallery`} aria-disabled={disabled}>
          <Icon name="cam" size={20} />
          Galerie
        </label>
        <input
          className="sr-only"
          type="file"
          accept="image/*"
          capture="environment"
          id={`${uid}-camera`}
          disabled={disabled}
          onChange={(ev) => pick(ev.target.files, ev.target)}
        />
        <label className="btn" htmlFor={`${uid}-camera`} aria-disabled={disabled}>
          <Icon name="cam" size={20} />
          Kamera
        </label>
      </div>
      <div className="muted photo-count" aria-live="polite">
        {progress ?? `${photoIds.length} / ${maxCount}`}
      </div>
      {photoIds.length > 0 ? (
        <div className="photogrid">
          {photoIds.map((id, i) => (
            <Tile key={id} photoId={id} index={i} onRemove={() => void onRemove(id)} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
