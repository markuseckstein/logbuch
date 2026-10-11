import { strFromU8, unzipSync } from 'fflate';
import type { LogEntry, Photo, PhotoMeta } from '../domain/types';
import { blobToBytes } from './blob';
import type { TripBundle } from './bundle';
import type { ExportedEntry, ExportedPhoto, LogbookJsonV2 } from './exportZip';

export class ImportFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportFormatError';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Only format version 2 (Flottille) is supported. */
function validate(raw: unknown): LogbookJsonV2 {
  if (!isRecord(raw) || raw.format !== 'segel-logbuch') {
    throw new ImportFormatError('Die Datei ist kein Logbuch-Export.');
  }
  if (raw.version !== 2) {
    throw new ImportFormatError(
      `Nicht unterstützte Version ${String(raw.version)} – diese App liest nur Version 2.`,
    );
  }
  if (
    !isRecord(raw.trip) || !Array.isArray(raw.entries) || !Array.isArray(raw.photos)
    || !Array.isArray(raw.dayReports) || !Array.isArray(raw.tracks)
  ) {
    throw new ImportFormatError('Der Logbuch-Export ist unvollständig oder beschädigt.');
  }
  return raw as unknown as LogbookJsonV2;
}

function parseJson(text: string): LogbookJsonV2 {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ImportFormatError('Die Datei enthält kein gültiges JSON.');
  }
  return validate(raw);
}

function dataUrlToBlob(dataUrl: string, mime: string): Blob {
  const m = /^data:[^;,]*(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) throw new ImportFormatError('Ein eingebettetes Foto ist beschädigt.');
  const bin = m[1] ? atob(m[2]!) : decodeURIComponent(m[2]!);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function toBundle(json: LogbookJsonV2, loadPhoto: (p: ExportedPhoto) => Blob): TripBundle {
  const tripId = json.trip.id;
  const entries = json.entries.map((e) => {
    const entry: Partial<ExportedEntry> = { ...e };
    delete entry.timeIso;
    return entry as LogEntry;
  });
  const photos: Photo[] = [];
  const missingPhotos: PhotoMeta[] = [];
  for (const p of json.photos) {
    const meta: PhotoMeta = {
      id: p.id, tripId, mime: p.mime, width: p.width, height: p.height,
      ...(p.hash ? { hash: p.hash } : {}), createdAt: p.createdAt,
    };
    if (p.photoOmitted) missingPhotos.push(meta);
    else photos.push({ ...meta, blob: loadPhoto(p) });
  }
  return {
    trip: json.trip, entries, photos, dayReports: json.dayReports, tracks: json.tracks, missingPhotos,
  };
}

export async function importZip(input: Blob | ArrayBuffer): Promise<TripBundle> {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : await blobToBytes(input);
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new ImportFormatError('Die Datei ist kein gültiges ZIP-Archiv.');
  }
  const jsonBytes = files['logbook.json'];
  if (!jsonBytes) throw new ImportFormatError('Im Archiv fehlt die Datei logbook.json.');
  const json = parseJson(strFromU8(jsonBytes));
  return toBundle(json, (p) => {
    if (p.file) {
      const data = files[p.file];
      if (!data) throw new ImportFormatError(`Im Archiv fehlt das Foto ${p.file}.`);
      return new Blob([data as Uint8Array<ArrayBuffer>], { type: p.mime });
    }
    if (p.dataUrl) return dataUrlToBlob(p.dataUrl, p.mime);
    throw new ImportFormatError(`Für Foto ${p.id} fehlen die Bilddaten.`);
  });
}

export async function importJson(text: string): Promise<TripBundle> {
  const json = parseJson(text);
  return toBundle(json, (p) => {
    if (!p.dataUrl) throw new ImportFormatError(`Für Foto ${p.id} fehlen die Bilddaten.`);
    return dataUrlToBlob(p.dataUrl, p.mime);
  });
}
