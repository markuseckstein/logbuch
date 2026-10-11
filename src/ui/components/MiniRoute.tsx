import type { LatLon } from '../../domain';

interface MiniRouteProps {
  points: readonly LatLon[];
  label: string;
}

const W = 368;
const H = 200;
const PAD = 24;

/** Schematische Route ohne Land (Platzhalter bis zur Leaflet-Karte in Teil 2). */
export function MiniRoute({ points, label }: MiniRouteProps) {
  if (points.length === 0) {
    return <p className="muted mini-empty">Noch keine Positionen heute.</p>;
  }
  const lats = points.map((p) => p.lat);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const xs = points.map((p) => p.lon * kx);
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
  const [minY, maxY] = [Math.min(...lats), Math.max(...lats)];
  const span = Math.max(maxX - minX, maxY - minY, 1e-4);
  const scale = Math.min((W - 2 * PAD) / span, (H - 2 * PAD) / span);
  const ox = (W - (maxX - minX) * scale) / 2;
  const oy = (H - (maxY - minY) * scale) / 2;
  const xy = points.map((_, i) => {
    const x = ox + ((xs[i] ?? 0) - minX) * scale;
    const y = oy + (maxY - (lats[i] ?? 0)) * scale;
    return [x, y] as const;
  });
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const last = xy[xy.length - 1];

  return (
    <div className="mapframe">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <rect width={W} height={H} fill="var(--water-deep)" />
        <path d={`M0 ${H / 2}H${W}M${W / 2} 0V${H}`} stroke="var(--grid)" strokeWidth=".7" opacity=".6" />
        {xy.length > 1 ? (
          <polyline points={line} fill="none" stroke="var(--magenta)" strokeWidth="2.2" strokeLinejoin="round" />
        ) : null}
        {xy.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i === xy.length - 1 ? 6 : 4} fill={i === xy.length - 1 ? 'var(--magenta)' : 'var(--surface)'} stroke="var(--magenta)" strokeWidth="2" />
        ))}
        {last ? <text x={W - 10} y={H - 10} textAnchor="end" fontSize="11" fontFamily="IBM Plex Mono,monospace" fill="var(--ink-2)">N ↑</text> : null}
      </svg>
    </div>
  );
}
