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
