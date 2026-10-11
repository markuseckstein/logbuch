import { usePhotoImage } from '../../db/hooks';
import type { ID } from '../../domain';
import { Icon } from '../icons';
import { usePhotoViewer } from './PhotoViewer';

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

/**
 * Nur-Lese-Raster (fremde Abschnitte, Eintrag ansehen, Daheim-Ansicht); antippen öffnet das Foto im Vollbild,
 * Wischen blättert durch die Fotos dieses Rasters.
 */
export function PhotoGrid({ photoIds, caption, className }: { photoIds: readonly ID[]; caption?: string | undefined; className?: string }) {
  const { open, viewer } = usePhotoViewer(photoIds.map((id) => ({ id, caption })));
  if (photoIds.length === 0) return null;
  return (
    <div className={className ? `photogrid ${className}` : 'photogrid'}>
      {photoIds.map((id, i) => (
        <div key={id} className="slotwrap">
          <button type="button" className="slot filled" aria-label={`Foto ${i + 1} groß anzeigen`} onClick={() => open(i)}>
            <PhotoImage photoId={id} alt={`Foto ${i + 1}`} />
          </button>
        </div>
      ))}
      {viewer}
    </div>
  );
}
