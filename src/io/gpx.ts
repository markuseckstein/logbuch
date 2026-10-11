import type { TrackPoint } from '../domain/types';
import { ENTRY_TYPE_LABELS } from '../domain/labels';
import type { TripBundle } from './bundle';

export class GpxParseError extends Error {
  constructor(message = 'Die GPX-Datei ist kein gültiges XML.') {
    super(message);
    this.name = 'GpxParseError';
  }
}

export interface ParsedTrack {
  name: string;
  points: TrackPoint[];
}

export interface ParsedWaypoint {
  lat: number;
  lon: number;
  time?: number;
  name?: string;
}

export interface ParsedGpx {
  tracks: ParsedTrack[];
  waypoints: ParsedWaypoint[];
}

/** Direct element children by local name (namespace independent). */
function children(el: Element, name: string): Element[] {
  return Array.from(el.children).filter((c) => c.localName === name);
}

function childText(el: Element, name: string): string | undefined {
  const c = children(el, name)[0];
  const t = c?.textContent?.trim();
  return t ? t : undefined;
}

function parseNumber(s: string | null | undefined): number | undefined {
  if (s == null || s.trim() === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function parsePoint(el: Element): (TrackPoint & { name?: string }) | undefined {
  const lat = parseNumber(el.getAttribute('lat'));
  const lon = parseNumber(el.getAttribute('lon'));
  if (lat === undefined || lon === undefined) return undefined;
  const p: TrackPoint = { lat, lon };
  const timeStr = childText(el, 'time');
  if (timeStr) {
    const t = Date.parse(timeStr);
    if (Number.isFinite(t)) p.time = t;
  }
  const ele = parseNumber(childText(el, 'ele'));
  if (ele !== undefined) p.ele = ele;
  return p;
}

export function parseGpx(xml: string): ParsedGpx {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml');
  } catch {
    throw new GpxParseError();
  }
  const root = doc.documentElement;
  if (doc.getElementsByTagName('parsererror').length > 0 || root.localName !== 'gpx') {
    throw new GpxParseError(
      root.localName === 'gpx' || doc.getElementsByTagName('parsererror').length > 0
        ? undefined
        : 'Die Datei ist keine GPX-Datei.',
    );
  }

  const tracks: ParsedTrack[] = [];
  for (const trk of children(root, 'trk')) {
    const points = children(trk, 'trkseg')
      .flatMap((seg) => children(seg, 'trkpt'))
      .map(parsePoint)
      .filter((p): p is TrackPoint => p !== undefined);
    tracks.push({ name: childText(trk, 'name') ?? '', points });
  }
  for (const rte of children(root, 'rte')) {
    const points = children(rte, 'rtept')
      .map(parsePoint)
      .filter((p): p is TrackPoint => p !== undefined);
    tracks.push({ name: childText(rte, 'name') ?? '', points });
  }

  const waypoints: ParsedWaypoint[] = [];
  for (const wpt of children(root, 'wpt')) {
    const p = parsePoint(wpt);
    if (!p) continue;
    const name = childText(wpt, 'name');
    waypoints.push(name ? { ...p, name } : p);
  }
  return { tracks, waypoints };
}


function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function localClock(time: number, tzOffsetMin: number): string {
  const d = new Date(time + tzOffsetMin * 60000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function iso(time: number): string {
  return new Date(time).toISOString();
}

function ptXml(tag: string, p: TrackPoint, indent: string): string {
  const inner =
    (p.ele !== undefined ? `<ele>${p.ele}</ele>` : '') +
    (p.time !== undefined ? `<time>${iso(p.time)}</time>` : '');
  return `${indent}<${tag} lat="${p.lat}" lon="${p.lon}">${inner}</${tag}>`;
}

export function writeGpx(bundle: TripBundle): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Logbuch" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <metadata><name>${esc(bundle.trip.name)}</name></metadata>`,
  ];

  const positioned = bundle.entries
    .filter((e) => e.position)
    .sort((a, b) => a.time - b.time);

  for (const e of positioned) {
    const pos = e.position!;
    lines.push(`  <wpt lat="${pos.lat}" lon="${pos.lon}">`);
    lines.push(`    <time>${iso(e.time)}</time>`);
    lines.push(`    <name>${esc(`${ENTRY_TYPE_LABELS[e.type]} ${localClock(e.time, e.tzOffsetMin)}`)}</name>`);
    if (e.text) lines.push(`    <desc>${esc(e.text)}</desc>`);
    lines.push('  </wpt>');
  }

  const tracks =
    bundle.tracks.length > 0
      ? bundle.tracks.map((t) => ({ name: t.name, points: t.points }))
      : positioned.length > 0
        ? [
            {
              name: 'Route aus Logeinträgen',
              points: positioned.map((e) => ({ lat: e.position!.lat, lon: e.position!.lon, time: e.time })),
            },
          ]
        : [];
  for (const t of tracks) {
    lines.push('  <trk>', `    <name>${esc(t.name)}</name>`, '    <trkseg>');
    for (const p of t.points) lines.push(ptXml('trkpt', p, '      '));
    lines.push('    </trkseg>', '  </trk>');
  }
  lines.push('</gpx>', '');
  return lines.join('\n');
}
