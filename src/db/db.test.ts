import { describe, expect, it } from 'vitest';
import { db } from './db';

describe('db (test environment)', () => {
  it('unit tests run in local mode without the Dexie Cloud addon, even if .env.local sets a cloud URL', () => {
    expect(db.cloudEnabled).toBe(false);
    expect(db.cloudUser()).toBeUndefined();
  });
});
