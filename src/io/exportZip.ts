import { strToU8, zipSync, type Zippable } from 'fflate';
import type { DayReport, LogEntry, PhotoMeta, Track, Trip } from '../domain/types';
import { blobToBytes } from './blob';
import type { TripBundle } from './bundle';
import { writeGpx } from './gpx';

export interface ExportedEntry extends LogEntry {
  timeIso: string;
}

export interface ExportedPhoto {
  id: string;
  file?: string;
  dataUrl?: string;
  mime: string;
  width: number;
  height: number;
  hash?: string;
  createdAt: number;
  /** Export without photos: metadata only, no `file`/`dataUrl`; the image can arrive with a later import. */
  photoOmitted?: true;
}

/** Version 2 (Flottille): version stamps, tombstones, authors, flotilla; photos may be omitted. */
export interface LogbookJsonV2 {
  format: 'segel-logbuch';
  version: 2;
  exportedAt: string;
  trip: Trip;
  entries: ExportedEntry[];
  dayReports: DayReport[];
  tracks: Track[];
  photos: ExportedPhoto[];
}

export type PhotoMode = 'file' | 'dataUrl';

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' };

export function extensionForMime(mime: string): string {
  return EXT[mime] ?? 'bin';
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

/** ISO-8601 string in the entry's local time, e.g. 2026-08-10T14:32:00+02:00. */
export function toIsoWithOffset(time: number, tzOffsetMin: number): string {
  const d = new Date(time + tzOffsetMin * 60000);
  const sign = tzOffsetMin < 0 ? '-' : '+';
  const abs = Math.abs(tzOffsetMin);
  return (
    `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export interface ExportOptions {
  /** false: photo metadata only (flag `photoOmitted`), no image data. Default true. */
  includePhotos?: boolean;
}

function photoBase(p: PhotoMeta) {
  return { id: p.id, mime: p.mime, width: p.width, height: p.height, ...(p.hash ? { hash: p.hash } : {}), createdAt: p.createdAt };
}

export async function buildLogbookJson(
  bundle: TripBundle,
  opts: { photoMode: PhotoMode } & ExportOptions,
): Promise<LogbookJsonV2> {
  const photos: ExportedPhoto[] = [];
  for (const p of bundle.photos) {
    const base = photoBase(p);
    if (opts.includePhotos === false) {
      photos.push({ ...base, photoOmitted: true });
    } else if (opts.photoMode === 'file') {
      photos.push({ ...base, file: `images/${p.id}.${extensionForMime(p.mime)}` });
    } else {
      const bytes = await blobToBytes(p.blob);
      photos.push({ ...base, dataUrl: `data:${p.mime};base64,${toBase64(bytes)}` });
    }
  }
  for (const p of bundle.missingPhotos) photos.push({ ...photoBase(p), photoOmitted: true });
  return {
    format: 'segel-logbuch',
    version: 2,
    exportedAt: new Date().toISOString(),
    trip: bundle.trip,
    entries: bundle.entries.map((e) => ({ ...e, timeIso: toIsoWithOffset(e.time, e.tzOffsetMin) })),
    dayReports: bundle.dayReports,
    tracks: bundle.tracks,
    photos,
  };
}

/** Bundle without tombstones, for human-facing outputs (GPX). */
function liveOnly(bundle: TripBundle): TripBundle {
  return {
    ...bundle,
    entries: bundle.entries.filter((e) => e.deletedAt === undefined),
    tracks: bundle.tracks.filter((t) => t.deletedAt === undefined),
  };
}

export async function exportZip(bundle: TripBundle, opts: ExportOptions = {}): Promise<Blob> {
  const json = await buildLogbookJson(bundle, { photoMode: 'file', ...opts });
  const files: Zippable = {
    'logbook.json': strToU8(JSON.stringify(json, null, 2)),
    'route.gpx': strToU8(writeGpx(liveOnly(bundle))),
  };
  const exported = new Map(json.photos.map((p) => [p.id, p]));
  for (const p of bundle.photos) {
    const path = exported.get(p.id)?.file;
    if (path) files[path] = [await blobToBytes(p.blob), { level: 0 }];
  }
  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}

export async function exportJson(bundle: TripBundle, opts: ExportOptions = {}): Promise<Blob> {
  const json = await buildLogbookJson(bundle, { photoMode: 'dataUrl', ...opts });
  return new Blob([JSON.stringify(json)], { type: 'application/json' });
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function exportFileName(trip: Pick<Trip, 'name'>, date: Date): string {
  const day = `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `logbuch-${slugify(trip.name) || 'toern'}-${day}.zip`;
}
