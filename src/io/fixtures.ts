import type { TripBundle } from './bundle';

/** Test fixture shared by export/import tests. */
export function sampleBundle(): TripBundle {
  return {
    trip: {
      id: 'trip-1',
      name: 'Ostsee Törn Süd',
      startDate: '2026-08-08',
      coverPhotoId: 'p4',
      coverFocus: { x: 30, y: 60 },
      createdAt: 1,
      updatedAt: 2,
      updatedBy: 'dev-a',
    },
    boats: [
      { id: 'b1', tripId: 'trip-1', name: 'Möwe', lengthM: 10.5, colorIndex: 1, createdAt: 1, updatedAt: 2, updatedBy: 'dev-a' },
      { id: 'b2', tripId: 'trip-1', name: 'Seeschwalbe', colorIndex: 2, createdAt: 2, updatedAt: 2, updatedBy: 'dev-a' },
    ],
    crew: [
      { id: 'c1', tripId: 'trip-1', name: 'Ann', role: 'skipper', suggestedBoatId: 'b1', createdAt: 1, updatedAt: 2, updatedBy: 'dev-a' },
      { id: 'c2', tripId: 'trip-1', name: 'Ben', createdAt: 1, updatedAt: 3, updatedBy: 'dev-b', deletedAt: 3 },
    ],
    entries: [
      {
        id: 'e1', tripId: 'trip-1', boatId: 'b1', time: Date.UTC(2026, 7, 10, 12, 32), tzOffsetMin: 120,
        position: { lat: 54.1, lon: 10.2, accuracyM: 5 }, type: 'harbour', text: 'Angekommen & fest',
        windDirDeg: 270, windBft: 4, photoIds: ['p1', 'p2'], authorId: 'c1', createdAt: 3, updatedAt: 4, updatedBy: 'dev-a',
      },
      {
        id: 'e2', tripId: 'trip-1', boatId: 'b2', time: Date.UTC(2026, 7, 10, 20, 0), tzOffsetMin: -90,
        type: 'note', photoIds: [], createdAt: 5, updatedAt: 6, updatedBy: 'dev-b',
      },
      {
        id: 'e3', tripId: 'trip-1', boatId: 'b1', time: Date.UTC(2026, 7, 11, 8, 0), tzOffsetMin: 120,
        type: 'note', text: 'gelöscht', photoIds: [], createdAt: 11, updatedAt: 12, updatedBy: 'dev-b', deletedAt: 12,
      },
    ],
    photos: [
      { id: 'p1', tripId: 'trip-1', blob: new Blob([new Uint8Array([1, 2, 3, 255])], { type: 'image/jpeg' }), mime: 'image/jpeg', width: 4, height: 3, hash: 'hash-p1', createdAt: 7 },
      { id: 'p3', tripId: 'trip-1', blob: new Blob([new Uint8Array([5, 6])], { type: 'image/jpeg' }), mime: 'image/jpeg', width: 3, height: 3, hash: 'hash-p3', createdAt: 9 },
      { id: 'p2', tripId: 'trip-1', blob: new Blob([new Uint8Array([9, 8, 7])], { type: 'image/webp' }), mime: 'image/webp', width: 2, height: 2, createdAt: 8 },
      { id: 'p4', tripId: 'trip-1', blob: new Blob([new Uint8Array([4, 4])], { type: 'image/jpeg' }), mime: 'image/jpeg', width: 16, height: 9, createdAt: 10 },
    ],
    dayReports: [
      { id: 'trip-1|2026-08-10|c1', tripId: 'trip-1', date: '2026-08-10', authorId: 'c1', title: 'Tag 3', text: 'Schön.', photoIds: ['p3'], updatedAt: 9, updatedBy: 'dev-a' },
      { id: 'trip-1|2026-08-10|-', tripId: 'trip-1', date: '2026-08-10', authorId: '', text: 'alt', photoIds: [], updatedAt: 9, updatedBy: 'dev-a', deletedAt: 9 },
    ],
    missingPhotos: [],
    tracks: [
      { id: 'k1', tripId: 'trip-1', boatId: 'b2', name: 'Tag 3', source: 'live', createdAt: 10, updatedAt: 10, updatedBy: 'dev-a' },
    ],
    trackChunks: [
      { id: 'k1-a', tripId: 'trip-1', trackId: 'k1', seq: 0, points: [{ lat: 54, lon: 10, time: 1000 }], updatedAt: 10, updatedBy: 'dev-a' },
      { id: 'k1-b', tripId: 'trip-1', trackId: 'k1', seq: 0, points: [{ lat: 54.1, lon: 10.1, ele: 3 }], updatedAt: 11, updatedBy: 'dev-b' },
    ],
  };
}
