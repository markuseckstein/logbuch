import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { blobToBytes } from './blob';
import { buildLogbookJson, exportFileName, exportJson, exportZip } from './exportZip';
import { sampleBundle } from './fixtures';

describe('buildLogbookJson', () => {
  it('has the v3 envelope and timeIso with offset from tzOffsetMin', async () => {
    const j = await buildLogbookJson(sampleBundle(), { photoMode: 'file' });
    expect(j.format).toBe('segel-logbuch');
    expect(j.version).toBe(3);
    expect(new Date(j.exportedAt).toISOString()).toBe(j.exportedAt);
    expect(j.entries[0]!.timeIso).toBe('2026-08-10T14:32:00+02:00');
    expect(j.entries[1]!.timeIso).toBe('2026-08-10T18:30:00-01:30');
    expect(j.entries[0]!.time).toBe(Date.UTC(2026, 7, 10, 12, 32));
    expect(j.trip.name).toBe('Ostsee Törn Süd');
    expect(j.dayReports).toHaveLength(2);
    expect(j.dayReports[0]!.photoIds).toEqual(['p3']);
    expect(j.tracks).toHaveLength(1);
    expect(j.trackChunks).toHaveLength(2);
    expect(j.crew.map((c) => c.name)).toEqual(['Ann', 'Ben']);
  });

  it('references photo files with extension from mime', async () => {
    const j = await buildLogbookJson(sampleBundle(), { photoMode: 'file' });
    expect(j.photos).toEqual([
      { id: 'p1', file: 'images/p1.jpg', mime: 'image/jpeg', width: 4, height: 3, hash: 'hash-p1', createdAt: 7 },
      { id: 'p3', file: 'images/p3.jpg', mime: 'image/jpeg', width: 3, height: 3, hash: 'hash-p3', createdAt: 9 },
      { id: 'p2', file: 'images/p2.webp', mime: 'image/webp', width: 2, height: 2, createdAt: 8 },
    ]);
  });

  it('embeds data URLs in dataUrl mode', async () => {
    const j = await buildLogbookJson(sampleBundle(), { photoMode: 'dataUrl' });
    expect(j.photos[0]).toEqual({
      id: 'p1', dataUrl: 'data:image/jpeg;base64,AQID/w==', mime: 'image/jpeg', width: 4, height: 3, hash: 'hash-p1', createdAt: 7,
    });
  });
});

describe('buildLogbookJson merge fields', () => {
  it('exports version stamps, authors, flotilla and tombstones', async () => {
    const j = await buildLogbookJson(sampleBundle(), { photoMode: 'file' });
    expect(j.trip.flotilla).toEqual({ id: 'fl-1', name: 'Ostsee-Flottille' });
    expect(j.trip.updatedBy).toBe('dev-a');
    expect(j.crew[1]!.deletedAt).toBe(3);
    expect(j.entries[0]).toMatchObject({ authorId: 'c1', updatedBy: 'dev-a' });
    expect(j.entries.find((e) => e.id === 'e3')!.deletedAt).toBe(12);
    expect(j.dayReports.map((r) => r.authorId)).toEqual(['c1', '']);
    expect(j.tracks[0]).toMatchObject({ updatedAt: 10, updatedBy: 'dev-a' });
  });

  it('never exports the user-specific cloud fields realmId/owner', async () => {
    const b = sampleBundle();
    const cloud = { realmId: 'rlm~trip-1', owner: 'alice' };
    b.trip = { ...b.trip, ...cloud };
    b.entries = b.entries.map((e) => ({ ...e, ...cloud }));
    b.crew = b.crew.map((c) => ({ ...c, ...cloud }));
    b.trackChunks = b.trackChunks.map((c) => ({ ...c, ...cloud }));
    const text = JSON.stringify(await buildLogbookJson(b, { photoMode: 'file' }));
    expect(text).not.toContain('realmId');
    expect(text).not.toContain('alice');
  });

  it('includePhotos: false lists photo metadata flagged photoOmitted without files', async () => {
    const j = await buildLogbookJson(sampleBundle(), { photoMode: 'file', includePhotos: false });
    expect(j.photos).toHaveLength(3);
    expect(j.photos[0]).toEqual({
      id: 'p1', photoOmitted: true, mime: 'image/jpeg', width: 4, height: 3, hash: 'hash-p1', createdAt: 7,
    });
    expect(j.photos.every((p) => !p.file && !p.dataUrl)).toBe(true);
  });
});

describe('exportZip', () => {
  it('without photos contains no images', async () => {
    const files = unzipSync(await blobToBytes(await exportZip(sampleBundle(), { includePhotos: false })));
    expect(Object.keys(files).sort()).toEqual(['logbook.json', 'route.gpx']);
  });

  it('keeps tombstoned entries and tracks out of route.gpx', async () => {
    const bundle = sampleBundle();
    bundle.tracks.push({ ...bundle.tracks[0]!, id: 'k2', name: 'Geloeschter Track', deletedAt: 11, updatedAt: 11 });
    bundle.entries.push({ ...bundle.entries[0]!, id: 'e4', text: 'GELOESCHT', deletedAt: 99, updatedAt: 99 });
    const gpx = strFromU8(unzipSync(await blobToBytes(await exportZip(bundle)))['route.gpx']!);
    expect(gpx).not.toContain('Geloeschter Track');
    expect(gpx).not.toContain('GELOESCHT');
  });

  it('contains logbook.json, uncompressed images and route.gpx', async () => {
    const blob = await exportZip(sampleBundle());
    expect(blob.type).toBe('application/zip');
    const files = unzipSync(await blobToBytes(blob));
    expect(Object.keys(files).sort()).toEqual(['images/p1.jpg', 'images/p2.webp', 'images/p3.jpg', 'logbook.json', 'route.gpx']);
    expect(Array.from(files['images/p1.jpg']!)).toEqual([1, 2, 3, 255]);
    expect(JSON.parse(strFromU8(files['logbook.json']!)).format).toBe('segel-logbuch');
    expect(strFromU8(files['route.gpx']!)).toContain('<gpx');
  });
});

describe('exportJson', () => {
  it('is a single JSON with data URLs', async () => {
    const blob = await exportJson(sampleBundle());
    expect(blob.type).toBe('application/json');
    const j = JSON.parse(strFromU8(await blobToBytes(blob)));
    expect(j.photos[2].dataUrl).toMatch(/^data:image\/webp;base64,/);
  });
});

describe('exportFileName', () => {
  it('slugifies the trip name with German umlauts', () => {
    const trip = { ...sampleBundle().trip, name: 'Ostsee Törn  Süd – Groß!' };
    expect(exportFileName(trip, new Date(2026, 9, 11, 12))).toBe('logbuch-ostsee-toern-sued-gross-2026-10-11.zip');
  });
});
