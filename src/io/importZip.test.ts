import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { blobToBytes } from './blob';
import type { TripBundle } from './bundle';
import { exportJson, exportZip } from './exportZip';
import { sampleBundle } from './fixtures';
import { ImportFormatError, importJson, importZip } from './importZip';

async function normalize(b: TripBundle) {
  return {
    ...b,
    photos: await Promise.all(
      b.photos.map(async (p) => ({ ...p, blob: undefined, bytes: Array.from(await blobToBytes(p.blob)), blobType: p.blob.type })),
    ),
  };
}

describe('importZip', () => {
  it('roundtrips a bundle through exportZip', async () => {
    const src = sampleBundle();
    const out = await importZip(await exportZip(src));
    expect(await normalize(out)).toEqual(await normalize(src));
    expect('timeIso' in out.entries[0]!).toBe(false);
  });

  it('roundtrips boats, cover, tombstones and authors', async () => {
    const src = sampleBundle();
    const out = await importZip(await exportZip(src));
    expect(out.boats).toEqual(src.boats);
    expect(out.trip.coverFocus).toEqual({ x: 30, y: 60 });
    expect(out.entries.find((e) => e.id === 'e3')!.deletedAt).toBe(12);
    expect(out.dayReports.map((r) => r.authorId)).toEqual(['c1', '']);
    expect(out.missingPhotos).toEqual([]);
  });

  it('exports without photos import as missingPhotos (metadata only), references kept', async () => {
    const src = sampleBundle();
    const out = await importZip(await exportZip(src, { includePhotos: false }));
    expect(out.photos).toEqual([]);
    expect(out.missingPhotos!.map((p) => p.id)).toEqual(['p1', 'p3', 'p2', 'p4']);
    expect(out.missingPhotos![0]).toEqual({ id: 'p1', tripId: 'trip-1', mime: 'image/jpeg', width: 4, height: 3, hash: 'hash-p1', createdAt: 7 });
    expect(out.entries[0]!.photoIds).toEqual(['p1', 'p2']);
  });

  it('a missing image file is still an error when the photo is not flagged photoOmitted', async () => {
    const z = await unzipWithout(await exportZip(sampleBundle()), 'images/p2.webp');
    await expect(importZip(z)).rejects.toThrow(ImportFormatError);
  });

  it('accepts an ArrayBuffer', async () => {
    const blob = await exportZip(sampleBundle());
    const bytes = await blobToBytes(blob);
    const out = await importZip(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    expect(out.trip.id).toBe('trip-1');
  });

  it('rejects a zip without logbook.json', async () => {
    const z = zipSync({ 'a.txt': strToU8('x') });
    await expect(importZip(new Blob([z as Uint8Array<ArrayBuffer>]))).rejects.toThrow(ImportFormatError);
  });

  it('rejects non-zip data', async () => {
    await expect(importZip(new Blob(['kein zip']))).rejects.toThrow(ImportFormatError);
  });

  it('rejects wrong format or version with a German message', async () => {
    const mk = (o: object) => new Blob([zipSync({ 'logbook.json': strToU8(JSON.stringify(o)) }) as Uint8Array<ArrayBuffer>]);
    await expect(importZip(mk({ format: 'x', version: 1 }))).rejects.toThrow(/Logbuch/);
    await expect(importZip(mk({ format: 'segel-logbuch', version: 3 }))).rejects.toThrow(/Version 3/);
    await expect(importZip(mk({ format: 'segel-logbuch', version: 2 }))).rejects.toThrow(/Version 2/);
    await expect(importZip(mk({ format: 'segel-logbuch', version: 1 }))).rejects.toThrow(/Version 1/);
  });

  it('rejects a v4 file without boats', async () => {
    const mk = (o: object) => new Blob([zipSync({ 'logbook.json': strToU8(JSON.stringify(o)) }) as Uint8Array<ArrayBuffer>]);
    const base = { format: 'segel-logbuch', version: 4, trip: { id: 't' }, crew: [], entries: [], dayReports: [], tracks: [], trackChunks: [], photos: [] };
    await expect(importZip(mk(base))).rejects.toThrow(/unvollständig/);
  });

  it('rejects records that belong to another trip or have no id (would be written into a foreign trip)', async () => {
    const mk = (o: object) => new Blob([zipSync({ 'logbook.json': strToU8(JSON.stringify(o)) }) as Uint8Array<ArrayBuffer>]);
    const text = new TextDecoder().decode(await blobToBytes(await exportJson(sampleBundle())));
    const good = JSON.parse(text) as { entries: { tripId?: string; id?: string }[]; trip: { id?: string } };
    const foreign = structuredClone(good);
    foreign.entries[0]!.tripId = 'other-trip';
    await expect(importZip(mk(foreign))).rejects.toThrow(/beschädigt/);
    const noId = structuredClone(good);
    delete noId.trip.id;
    await expect(importZip(mk(noId))).rejects.toThrow(/beschädigt/);
    const noEntryId = structuredClone(good);
    delete noEntryId.entries[0]!.id;
    await expect(importZip(mk(noEntryId))).rejects.toThrow(/beschädigt/);
  });

  it('rejects a missing image file', async () => {
    const bundle = sampleBundle();
    const z = unzipWithout(await exportZip(bundle), 'images/p1.jpg');
    await expect(importZip(await z)).rejects.toThrow(ImportFormatError);
  });
});

async function unzipWithout(blob: Blob, path: string): Promise<Blob> {
  const { unzipSync } = await import('fflate');
  const files = unzipSync(await blobToBytes(blob));
  delete files[path];
  return new Blob([zipSync(files) as Uint8Array<ArrayBuffer>]);
}

describe('importJson', () => {
  it('roundtrips the single-file variant (data URLs to Blobs)', async () => {
    const src = sampleBundle();
    const text = new TextDecoder().decode(await blobToBytes(await exportJson(src)));
    const out = await importJson(text);
    expect(await normalize(out)).toEqual(await normalize(src));
  });

  it('rejects invalid JSON', async () => {
    await expect(importJson('{nope')).rejects.toThrow(ImportFormatError);
  });
});
