import { COMPASS_16, compass16ToDeg, degToCompass16 } from '../../domain';
import { Icon } from '../icons';

interface WindRoseProps {
  /** Windrichtung (Wind aus …) in Grad oder undefined. */
  valueDeg: number | undefined;
  onChange: (deg: number | undefined) => void;
}

const C = 100;
const R_OUT = 78;
const R_IN = 30;
const pt = (r: number, a: number): [string, string] => [
  (C + r * Math.sin((a * Math.PI) / 180)).toFixed(2),
  (C - r * Math.cos((a * Math.PI) / 180)).toFixed(2),
];

export function sectorIndex(deg: number): number {
  return COMPASS_16.indexOf(degToCompass16(deg));
}

export function WindRose({ valueDeg, onChange }: WindRoseProps) {
  const selected = valueDeg === undefined ? undefined : sectorIndex(valueDeg);

  const select = (i: number): void => onChange(selected === i ? undefined : compass16ToDeg(i));
  const step = (k: number): void =>
    onChange(compass16ToDeg(selected === undefined ? (k > 0 ? 0 : 15) : selected + k));

  return (
    <div className="rose-wrap">
      <svg className="rose" viewBox="0 0 200 200" role="radiogroup" aria-label="Windrichtung">
        {COMPASS_16.map((name, i) => {
          const a = i * 22.5;
          const [x0, y0] = pt(R_OUT, a - 11.25);
          const [x1, y1] = pt(R_OUT, a + 11.25);
          const [x2, y2] = pt(R_IN, a + 11.25);
          const [x3, y3] = pt(R_IN, a - 11.25);
          return (
            <path
              key={name}
              className={i % 4 === 0 ? 'w card4' : 'w'}
              role="radio"
              tabIndex={0}
              aria-checked={selected === i}
              aria-label={`Wind aus ${name}`}
              d={`M${x0} ${y0}A${R_OUT} ${R_OUT} 0 0 1 ${x1} ${y1}L${x2} ${y2}A${R_IN} ${R_IN} 0 0 0 ${x3} ${y3}Z`}
              onClick={() => select(i)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault();
                  select(i);
                }
              }}
            />
          );
        })}
        {COMPASS_16.map((name, i) => {
          if (i % 2) return null;
          const [tx, ty] = pt(90, i * 22.5);
          return (
            <text key={name} x={tx} y={ty} style={i % 4 === 0 ? { fontWeight: 700 } : undefined}>
              {name}
            </text>
          );
        })}
        <text className="ctr" x="100" y="100">
          {selected === undefined ? '–' : COMPASS_16[selected]}
        </text>
      </svg>
      <div className="windbar">
        <button className="icon-btn" type="button" aria-label="Eine Richtung zurück" onClick={() => step(-1)}>
          <Icon name="chev-l" />
        </button>
        <output>
          {selected === undefined ? 'keine Angabe' : `aus ${COMPASS_16[selected]} · ${Math.round(compass16ToDeg(selected))}°`}
        </output>
        <button className="icon-btn" type="button" aria-label="Eine Richtung weiter" onClick={() => step(1)}>
          <Icon name="chev-r" />
        </button>
      </div>
    </div>
  );
}
