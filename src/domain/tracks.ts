import type { Track, TrackChunk, TrackPoint, TrackRecord } from './types';

/** Punkte je Chunk: klein genug für häufiges Anhängen, groß genug für wenige Datensätze. */
export const TRACK_CHUNK_SIZE = 200;

export function chunkPoints(points: readonly TrackPoint[], size = TRACK_CHUNK_SIZE): TrackPoint[][] {
  const out: TrackPoint[][] = [];
  for (let i = 0; i < points.length; i += size) out.push(points.slice(i, i + size));
  return out;
}

const firstTime = (c: TrackChunk): number => c.points[0]?.time ?? Number.MAX_SAFE_INTEGER;

/** Deterministische Reihenfolge: seq, dann Zeit des ersten Punkts, dann id. */
export function orderChunks(chunks: readonly TrackChunk[]): TrackChunk[] {
  return [...chunks].sort(
    (a, b) => a.seq - b.seq || firstTime(a) - firstTime(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** Tracks mit ihren Punkten (Chunks ohne Tombstones), Reihenfolge der Tracks bleibt. */
export function assembleTracks(tracks: readonly TrackRecord[], chunks: readonly TrackChunk[]): Track[] {
  const byTrack = new Map<string, TrackChunk[]>();
  for (const c of chunks) {
    if (c.deletedAt !== undefined) continue;
    const list = byTrack.get(c.trackId) ?? [];
    list.push(c);
    byTrack.set(c.trackId, list);
  }
  return tracks.map((t) => ({ ...t, points: orderChunks(byTrack.get(t.id) ?? []).flatMap((c) => c.points) }));
}
