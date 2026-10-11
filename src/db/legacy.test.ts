import Dexie from 'dexie';
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { LEGACY_DB_NAME, deleteLegacyDb } from './legacy';

describe('deleteLegacyDb', () => {
  it('löscht die alte Datenbank "logbook" und lässt andere unberührt', async () => {
    for (const name of [LEGACY_DB_NAME, 'logbook-v3-legacy-test']) {
      const d = new Dexie(name);
      d.version(1).stores({ x: 'id' });
      await d.open();
      d.close();
    }
    await deleteLegacyDb();
    const names = await Dexie.getDatabaseNames();
    expect(names).not.toContain(LEGACY_DB_NAME);
    expect(names).toContain('logbook-v3-legacy-test');
  });

  it('wirft nicht, wenn nichts zu löschen ist', async () => {
    await expect(deleteLegacyDb()).resolves.toBeUndefined();
  });
});
