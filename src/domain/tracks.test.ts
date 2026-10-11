import { describe, expect, it } from 'vitest';
import { TRACK_CHUNK_SIZE, assembleTracks, chunkPoints, orderChunks } from './tracks';
import type { TrackChunk, TrackPoint, TrackRecord } from './types';

const pts = (n: number, from = 0): TrackPoint[] => Array.from({ length: n }, (_, i) => ({ lat: from + i, lon: 0, time: from + i }));
const chunk = (id: string, trackId: string, seq: number, points: TrackPoint[], extra: Partial<TrackChunk> = {}): TrackChunk => ({
  id, tripId: 't', trackId, seq, points, updatedAt: 1, updatedBy: 'A', ...extra,
});
const rec = (id: string, extra: Partial<TrackRecord> = {}): TrackRecord => ({
  id, tripId: 't', name: id, source: 'live', createdAt: 1, updatedAt: 1, updatedBy: 'A', ...extra,
});

describe('chunkPoints', () => {
  it('splits into slices of TRACK_CHUNK_SIZE', () => {
    const parts = chunkPoints(pts(TRACK_CHUNK_SIZE * 2 + 3));
    expect(parts.map((p) => p.length)).toEqual([TRACK_CHUNK_SIZE, TRACK_CHUNK_SIZE, 3]);
    expect(parts[1]![0]!.lat).toBe(TRACK_CHUNK_SIZE);
  });
  it('no points -> no chunks', () => {
    expect(chunkPoints([])).toEqual([]);
  });
});

describe('orderChunks / assembleTracks', () => {
  it('orders by seq, then first point time, then id', () => {
    const c = [chunk('b', 'k', 2, pts(1, 50)), chunk('z', 'k', 1, pts(1, 20)), chunk('a', 'k', 1, pts(1, 10))];
    expect(orderChunks(c).map((x) => x.id)).toEqual(['a', 'z', 'b']);
  });
  it('assembles points per track in chunk order and ignores deleted chunks', () => {
    const tracks = assembleTracks(
      [rec('k1'), rec('k2')],
      [
        chunk('c2', 'k1', 2, pts(2, 10)),
        chunk('c1', 'k1', 1, pts(2, 0)),
        chunk('c3', 'k2', 1, pts(1, 99)),
        chunk('c4', 'k1', 3, pts(1, 77), { deletedAt: 5 }),
      ],
    );
    expect(tracks.map((t) => [t.id, t.points.map((p) => p.lat)])).toEqual([
      ['k1', [0, 1, 10, 11]],
      ['k2', [99]],
    ]);
  });
  it('a track without chunks has no points', () => {
    expect(assembleTracks([rec('k')], [])[0]!.points).toEqual([]);
  });
});
