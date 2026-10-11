import type { TripBundle } from './bundle';

/** Test fixture shared by export/import tests. */
export function sampleBundle(): TripBundle {
  return {
    trip: {
      id: 'trip-1',
      name: 'Ostsee Törn Süd',
      startDate: '2026-08-08',
      boat: { name: 'Möwe', lengthM: 10.5 },
      crew: [{ id: 'c1', name: 'Ann', role: 'skipper' }],
      createdAt: 1,
      updatedAt: 2,
    },
    entries: [
      {
        id: 'e1', tripId: 'trip-1', time: Date.UTC(2026, 7, 10, 12, 32), tzOffsetMin: 120,
        position: { lat: 54.1, lon: 10.2, accuracyM: 5 }, type: 'harbour', text: 'Angekommen & fest',
        windDirDeg: 270, windBft: 4, photoIds: ['p1', 'p2'], createdAt: 3, updatedAt: 4,
      },
      {
        id: 'e2', tripId: 'trip-1', time: Date.UTC(2026, 7, 10, 20, 0), tzOffsetMin: -90,
        type: 'note', photoIds: [], createdAt: 5, updatedAt: 6,
      },
    ],
    photos: [
      { id: 'p1', tripId: 'trip-1', blob: new Blob([new Uint8Array([1, 2, 3, 255])], { type: 'image/jpeg' }), mime: 'image/jpeg', width: 4, height: 3, createdAt: 7 },
      { id: 'p2', tripId: 'trip-1', blob: new Blob([new Uint8Array([9, 8, 7])], { type: 'image/webp' }), mime: 'image/webp', width: 2, height: 2, createdAt: 8 },
    ],
    dayReports: [{ tripId: 'trip-1', date: '2026-08-10', title: 'Tag 3', text: 'Schön.', updatedAt: 9 }],
    tracks: [
      { id: 'k1', tripId: 'trip-1', name: 'Tag 3', source: 'live', createdAt: 10, points: [{ lat: 54, lon: 10, time: 1000 }, { lat: 54.1, lon: 10.1, ele: 3 }] },
    ],
  };
}
