import { createDb, type LogbookDB } from './db';

let counter = 0;

/** Creates an isolated DB with a unique name; call `dispose` afterwards. */
export function freshDb(): LogbookDB {
  counter += 1;
  return createDb(`logbook-test-${Date.now()}-${counter}-${Math.random().toString(36).slice(2)}`);
}

export async function dispose(db: LogbookDB): Promise<void> {
  db.close();
  await db.delete();
}

/** Trip input with boats (names) for tests. */
export const tripInput = (name = 'T', boats: readonly string[] = ['Seeschwalbe']) => ({
  name, boats: boats.map((b) => ({ name: b })),
});

/** Ids of the trip's boats in creation order. */
export async function boatIds(db: LogbookDB, tripId: string): Promise<string[]> {
  const all = await db.boats.where('tripId').equals(tripId).sortBy('createdAt');
  return all.map((b) => b.id);
}

/** Id of the trip's first boat. */
export async function firstBoat(db: LogbookDB, tripId: string): Promise<string> {
  const [id] = await boatIds(db, tripId);
  if (!id) throw new Error('trip without boat');
  return id;
}
