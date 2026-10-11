import Dexie from 'dexie';
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { LEGACY_DB_NAMES, deleteLegacyDb } from './legacy';

describe('deleteLegacyDb', () => {
  it('löscht die alten Datenbanken "logbook", "logbook-v3" und "logbook-v4" und lässt andere unberührt', async () => {
    for (const name of [...LEGACY_DB_NAMES, 'logbook-v5-legacy-test']) {
      const d = new Dexie(name);
      d.version(1).stores({ x: 'id' });
      await d.open();
      d.close();
    }
    await deleteLegacyDb();
    const names = await Dexie.getDatabaseNames();
    for (const name of LEGACY_DB_NAMES) expect(names).not.toContain(name);
    expect(names).toContain('logbook-v5-legacy-test');
  });

  it('wirft nicht, wenn nichts zu löschen ist', async () => {
    await expect(deleteLegacyDb()).resolves.toBeUndefined();
  });
});
