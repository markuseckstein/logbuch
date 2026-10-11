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
    await expect(importZip(mk({ format: 'segel-logbuch', version: 2 }))).rejects.toThrow(/Version 2/);
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
