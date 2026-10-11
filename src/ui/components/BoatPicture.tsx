import { useId } from 'react';
import { usePhotoUrl } from '../../db/hooks';
import type { ID } from '../../domain';
import { Icon } from '../icons';

interface BoatPictureProps {
  /** Gespeichertes Foto (Trip-Screen) … */
  photoId?: ID | undefined;
  /** … oder lokale Vorschau-URL (Onboarding). */
  previewUrl?: string | undefined;
  busy?: boolean;
  onPick: (file: File) => void;
}

const BoatSvg = () => (
  <svg viewBox="0 0 300 140" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <rect width="300" height="140" fill="var(--water-mid)" />
    <rect y="96" width="300" height="44" fill="var(--water-shallow)" />
    <path d="M60 98h180l-22 20H84z" fill="var(--ink)" />
    <path d="M148 22v74M148 24l56 66h-56M144 40l-48 50h48" fill="var(--surface)" stroke="var(--ink)" strokeWidth="2" />
  </svg>
);

export function BoatPicture({ photoId, previewUrl, busy, onPick }: BoatPictureProps) {
  const stored = usePhotoUrl(photoId);
  const url = previewUrl ?? stored;
  const inputId = useId();
  return (
    <>
      <div className="boatpic">{url ? <img src={url} alt="Bootsfoto" /> : <BoatSvg />}</div>
      <input
        className="sr-only"
        id={inputId}
        type="file"
        accept="image/*"
        aria-label="Bootsfoto wählen"
        disabled={busy}
        onChange={(ev) => {
          const file = ev.target.files?.[0];
          ev.target.value = '';
          if (file) onPick(file);
        }}
      />
      <label className="btn block" htmlFor={inputId}>
        <Icon name="cam" size={20} />
        {busy ? 'Foto wird verarbeitet …' : url ? 'Foto ändern' : 'Foto wählen (optional)'}
      </label>
    </>
  );
}
