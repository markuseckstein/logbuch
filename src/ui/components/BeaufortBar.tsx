import type { CSSProperties } from 'react';
import { BEAUFORT } from '../../domain';

interface BeaufortBarProps {
  value: number | undefined;
  onChange: (bft: number | undefined) => void;
}

const knRange = (min: number, max: number | null): string =>
  max === null ? `≥ ${min}` : min === max ? '< 1' : `${min}–${max}`;

export function BeaufortBar({ value, onChange }: BeaufortBarProps) {
  const level = value === undefined ? undefined : BEAUFORT[value];
  return (
    <>
      <div className="bft">
        {BEAUFORT.map((b) => (
          <button
            key={b.bft}
            type="button"
            style={{ '--lv': b.bft / 12 } as CSSProperties}
            aria-pressed={value === b.bft}
            aria-label={`${b.bft} Beaufort, ${b.name}`}
            onClick={() => onChange(value === b.bft ? undefined : b.bft)}
          >
            {b.bft}
          </button>
        ))}
      </div>
      <div className="bft-desc">
        {level ? (
          <>
            <b>
              {level.bft} – {level.name}
            </b>
            <small>ca. {knRange(level.minKn, level.maxKn)} kn</small>
          </>
        ) : (
          'Nicht gesetzt'
        )}
      </div>
    </>
  );
}
