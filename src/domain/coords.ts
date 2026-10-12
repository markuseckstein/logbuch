export type CoordAxis = 'lat' | 'lon';
export type CoordResult = { ok: true; value: number } | { ok: false; error: string };

const EXAMPLE: Record<CoordAxis, string> = {
  lat: 'z. B. 54°19,1 N, 54 19,1 oder 54.318',
  lon: 'z. B. 010°08,4 E, 10 8,4 oder 10.141',
};
const LIMIT: Record<CoordAxis, number> = { lat: 90, lon: 180 };
const NAME: Record<CoordAxis, string> = { lat: 'Breite', lon: 'Länge' };
const HEMI: Record<string, { axis: CoordAxis; sign: 1 | -1 }> = {
  N: { axis: 'lat', sign: 1 },
  S: { axis: 'lat', sign: -1 },
  E: { axis: 'lon', sign: 1 },
  O: { axis: 'lon', sign: 1 },
  W: { axis: 'lon', sign: -1 },
};

/**
 * Liest eine Koordinate: Dezimalgrad („54.318“, „54,318“), Grad und Minuten („54 19,1“, „54°19,1′“, „54°19.1'N“),
 * auch mit Sekunden. Die Halbkugel steht als Buchstabe vorn oder hinten (N/S bzw. E/W/O) oder als Vorzeichen.
 * Prüft die Grenzen (Breite ±90°, Länge ±180°, Minuten/Sekunden < 60).
 */
export function parseCoordinate(input: string, axis: CoordAxis): CoordResult {
  const fail = (why: string): CoordResult => ({ ok: false, error: `${NAME[axis]}: ${why} (${EXAMPLE[axis]}).` });
  const raw = input.trim();
  if (raw === '') return fail('bitte angeben');

  const m = /^([A-Za-z])?\s*([^A-Za-z]*?)\s*([A-Za-z])?$/.exec(raw);
  if (!m) return fail('nicht lesbar');
  const [, head, body = '', tail] = m;
  if (head && tail) return fail('Himmelsrichtung nur einmal angeben');
  const letter = (head ?? tail)?.toUpperCase();
  let hemiSign = 1;
  if (letter) {
    const h = HEMI[letter];
    if (!h) return fail('nicht lesbar');
    if (h.axis !== axis) return fail(`„${letter}“ passt nicht zur ${NAME[axis]}`);
    hemiSign = h.sign;
  }

  const cleaned = body
    .replace(/−/g, '-')
    .replace(/,/g, '.')
    .replace(/[°º˚′″"'’´`‘]/g, ' ')
    .trim();
  const sm = /^([+-])?\s*(.*)$/.exec(cleaned);
  const signChar = sm?.[1];
  const nums = (sm?.[2] ?? '').split(/\s+/).filter((s) => s !== '');
  if (nums.length === 0 || nums.length > 3 || !nums.every((n) => /^\d+(\.\d+)?$/.test(n))) return fail('nicht lesbar');
  if (letter && signChar === '-') return fail('Vorzeichen und Himmelsrichtung nicht zugleich angeben');

  const [d = 0, mi, s] = nums.map(Number);
  if (nums.length > 1) {
    if (!Number.isInteger(d)) return fail('bei Minuten müssen die Grad ganzzahlig sein');
    if ((mi ?? 0) >= 60 || (s ?? 0) >= 60) return fail('Minuten und Sekunden müssen kleiner als 60 sein');
    if (nums.length === 3 && !Number.isInteger(mi)) return fail('bei Sekunden müssen die Minuten ganzzahlig sein');
  }
  const abs = d + (mi ?? 0) / 60 + (s ?? 0) / 3600;
  if (abs > LIMIT[axis]) return fail(`höchstens ${LIMIT[axis]}°`);
  const sign = signChar === '-' ? -1 : hemiSign;
  return { ok: true, value: sign * abs };
}
