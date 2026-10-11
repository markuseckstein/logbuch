import Dexie from 'dexie';

export const LEGACY_DB_NAME = 'logbook';

/** Removes the pre-Flottille database once (no data to carry over); errors are ignored. */
export async function deleteLegacyDb(): Promise<void> {
  try {
    await Dexie.delete(LEGACY_DB_NAME);
  } catch {
    // nothing to clean up or deletion blocked: irrelevant for the new database
  }
}
