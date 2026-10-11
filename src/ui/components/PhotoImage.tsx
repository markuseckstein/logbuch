import { usePhotoImage } from '../../db/hooks';
import type { ID } from '../../domain';
import { Icon } from '../icons';

/** Foto aus dem lokalen Speicher; fehlt das Bild (Export ohne Fotos), erscheint die Platzhalter-Kachel. */
export function PhotoImage({ photoId, alt }: { photoId: ID; alt: string }) {
  const { url, missing } = usePhotoImage(photoId);
  if (missing) {
    return (
      <span className="photo-missing" role="img" aria-label="Foto nicht übertragen">
        <Icon name="cam" size={18} />
        <span className="ph-text" aria-hidden="true">
          Foto nicht übertragen
        </span>
      </span>
    );
  }
  return url ? <img src={url} alt={alt} /> : null;
}

/** Nur-Lese-Raster (fremde Abschnitte, fremdes Logbuch). */
export function PhotoGrid({ photoIds }: { photoIds: readonly ID[] }) {
  if (photoIds.length === 0) return null;
  return (
    <div className="photogrid">
      {photoIds.map((id, i) => (
        <div key={id} className="slotwrap">
          <div className="slot filled">
            <PhotoImage photoId={id} alt={`Foto ${i + 1}`} />
          </div>
        </div>
      ))}
    </div>
  );
}
