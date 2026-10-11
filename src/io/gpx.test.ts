import { describe, expect, it } from 'vitest';
import { GpxParseError, parseGpx, writeGpx } from './gpx';
import type { TripBundle } from './bundle';

const gpx11 = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="OsmAnd" xmlns="http://www.topografix.com/GPX/1/1" xmlns:osmand="https://osmand.net">
  <metadata><name>Test</name></metadata>
  <wpt lat="47.5" lon="9.5"><time>2026-08-10T12:32:00Z</time><name>Hafen</name>
    <extensions><osmand:color>#ff0000</osmand:color></extensions></wpt>
  <wpt lat="47.6" lon="9.6"/>
  <trk><name>Tag 1</name>
    <trkseg>
      <trkpt lat="47.1" lon="9.1"><ele>395.5</ele><time>2026-08-10T10:00:00Z</time><extensions><speed>3</speed></extensions></trkpt>
      <trkpt lat="47.2" lon="9.2"><time>2026-08-10T10:01:00.500Z</time></trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="47.3" lon="9.3"/>
    </trkseg>
  </trk>
  <rte><name>Plan</name><rtept lat="1" lon="2"/><rtept lat="3" lon="4"/></rte>
</gpx>`;

describe('parseGpx', () => {
  it('parses tracks, merging segments, with time and ele', () => {
    const r = parseGpx(gpx11);
    const t = r.tracks[0]!;
    expect(t.name).toBe('Tag 1');
    expect(t.points).toEqual([
      { lat: 47.1, lon: 9.1, ele: 395.5, time: Date.UTC(2026, 7, 10, 10, 0, 0) },
      { lat: 47.2, lon: 9.2, time: Date.UTC(2026, 7, 10, 10, 1, 0, 500) },
      { lat: 47.3, lon: 9.3 },
    ]);
  });

  it('treats routes as tracks', () => {
    const r = parseGpx(gpx11);
    expect(r.tracks[1]).toEqual({
      name: 'Plan',
      points: [
        { lat: 1, lon: 2 },
        { lat: 3, lon: 4 },
      ],
    });
  });

  it('parses waypoints and ignores extensions', () => {
    const r = parseGpx(gpx11);
    expect(r.waypoints).toEqual([
      { lat: 47.5, lon: 9.5, time: Date.UTC(2026, 7, 10, 12, 32), name: 'Hafen' },
      { lat: 47.6, lon: 9.6 },
    ]);
  });

  it('supports GPX 1.0 namespace', () => {
    const r = parseGpx(
      '<gpx version="1.0" xmlns="http://www.topografix.com/GPX/1/0"><trk><trkseg><trkpt lat="1" lon="2"/></trkseg></trk></gpx>',
    );
    expect(r.tracks[0]).toEqual({ name: '', points: [{ lat: 1, lon: 2 }] });
  });

  it('works without namespace and skips points with invalid coordinates', () => {
    const r = parseGpx('<gpx><trk><trkseg><trkpt lat="x" lon="2"/><trkpt lat="1" lon="2"><time>kaputt</time></trkpt></trkseg></trk></gpx>');
    expect(r.tracks[0]!.points).toEqual([{ lat: 1, lon: 2 }]);
  });

  it('throws GpxParseError on invalid XML or wrong root', () => {
    expect(() => parseGpx('<gpx><trk>')).toThrow(GpxParseError);
    expect(() => parseGpx('<html/>')).toThrow(GpxParseError);
  });
});

function bundle(withTracks: boolean): TripBundle {
  return {
    trip: { id: 't', name: 'Törn <Ost> & "Co"', boat: { name: 'B' }, crew: [], createdAt: 0, updatedAt: 0, updatedBy: 'd' },
    entries: [
      {
        id: 'e1', tripId: 't', time: Date.UTC(2026, 7, 10, 12, 32), tzOffsetMin: 120,
        position: { lat: 54.1, lon: 10.2 }, type: 'harbour', text: 'a < b & "c"', photoIds: [], createdAt: 0, updatedAt: 0, updatedBy: 'd',
      },
      { id: 'e2', tripId: 't', time: Date.UTC(2026, 7, 10, 13), tzOffsetMin: 120, type: 'note', photoIds: [], createdAt: 0, updatedAt: 0, updatedBy: 'd' },
      {
        id: 'e3', tripId: 't', time: Date.UTC(2026, 7, 10, 14), tzOffsetMin: 120,
        position: { lat: 54.2, lon: 10.3 }, type: 'departure', photoIds: [], createdAt: 0, updatedAt: 0, updatedBy: 'd',
      },
    ],
    photos: [],
    missingPhotos: [],
    dayReports: [],
    tracks: withTracks
      ? [{ id: 'k', tripId: 't', name: 'Live & <1>', source: 'live', createdAt: 0, updatedAt: 0, updatedBy: 'd',
          points: [{ lat: 54, lon: 10, time: 1000, ele: 2 }, { lat: 54.1, lon: 10.1 }] }]
      : [],
  };
}

describe('writeGpx', () => {
  it('writes GPX 1.1 header, metadata and escapes XML', () => {
    const xml = writeGpx(bundle(true));
    expect(xml).toContain('version="1.1"');
    expect(xml).toContain('creator="Logbuch"');
    expect(xml).toContain('<name>Törn &lt;Ost&gt; &amp; "Co"</name>');
    expect(xml).toContain('<desc>a &lt; b &amp; "c"</desc>');
  });

  it('roundtrips tracks and waypoints', () => {
    const r = parseGpx(writeGpx(bundle(true)));
    expect(r.tracks).toEqual([
      { name: 'Live & <1>', points: [{ lat: 54, lon: 10, time: 1000, ele: 2 }, { lat: 54.1, lon: 10.1 }] },
    ]);
    expect(r.waypoints).toHaveLength(2);
    expect(r.waypoints[0]).toMatchObject({ lat: 54.1, lon: 10.2, time: Date.UTC(2026, 7, 10, 12, 32) });
    expect(r.waypoints[0]!.name).toMatch(/Hafen.*14:32/);
  });

  it('derives a route track from entry positions when there are no tracks', () => {
    const r = parseGpx(writeGpx(bundle(false)));
    expect(r.tracks).toEqual([
      {
        name: 'Route aus Logeinträgen',
        points: [
          { lat: 54.1, lon: 10.2, time: Date.UTC(2026, 7, 10, 12, 32) },
          { lat: 54.2, lon: 10.3, time: Date.UTC(2026, 7, 10, 14) },
        ],
      },
    ]);
  });
});
