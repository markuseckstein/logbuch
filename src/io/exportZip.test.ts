import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { blobToBytes } from './blob';
import { buildLogbookJson, exportFileName, exportJson, exportZip } from './exportZip';
import { sampleBundle } from './fixtures';

describe('buildLogbookJson', () => {
  it('has the v1 envelope and timeIso with offset from tzOffsetMin', async () => {
    const j = await buildLogbookJson(sampleBundle(), { photoMode: 'file' });
    expect(j.format).toBe('segel-logbuch');
    expect(j.version).toBe(1);
    expect(new Date(j.exportedAt).toISOString()).toBe(j.exportedAt);
    expect(j.entries[0]!.timeIso).toBe('2026-08-10T14:32:00+02:00');
    expect(j.entries[1]!.timeIso).toBe('2026-08-10T18:30:00-01:30');
    expect(j.entries[0]!.time).toBe(Date.UTC(2026, 7, 10, 12, 32));
    expect(j.trip.name).toBe('Ostsee Törn Süd');
    expect(j.dayReports).toHaveLength(1);
    expect(j.tracks).toHaveLength(1);
  });

  it('references photo files with extension from mime', async () => {
    const j = await buildLogbookJson(sampleBundle(), { photoMode: 'file' });
    expect(j.photos).toEqual([
      { id: 'p1', file: 'images/p1.jpg', mime: 'image/jpeg', width: 4, height: 3, createdAt: 7 },
      { id: 'p2', file: 'images/p2.webp', mime: 'image/webp', width: 2, height: 2, createdAt: 8 },
    ]);
  });

  it('embeds data URLs in dataUrl mode', async () => {
    const j = await buildLogbookJson(sampleBundle(), { photoMode: 'dataUrl' });
    expect(j.photos[0]).toEqual({
      id: 'p1', dataUrl: 'data:image/jpeg;base64,AQID/w==', mime: 'image/jpeg', width: 4, height: 3, createdAt: 7,
    });
  });
});

describe('exportZip', () => {
  it('contains logbook.json, uncompressed images and route.gpx', async () => {
    const blob = await exportZip(sampleBundle());
    expect(blob.type).toBe('application/zip');
    const files = unzipSync(await blobToBytes(blob));
    expect(Object.keys(files).sort()).toEqual(['images/p1.jpg', 'images/p2.webp', 'logbook.json', 'route.gpx']);
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
    expect(j.photos[1].dataUrl).toMatch(/^data:image\/webp;base64,/);
  });
});

describe('exportFileName', () => {
  it('slugifies the trip name with German umlauts', () => {
    const trip = { ...sampleBundle().trip, name: 'Ostsee Törn  Süd – Groß!' };
    expect(exportFileName(trip, new Date(2026, 9, 11, 12))).toBe('logbuch-ostsee-toern-sued-gross-2026-10-11.zip');
  });
});
