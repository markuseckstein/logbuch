import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStorageEstimate, requestPersistentStorage } from './storage';

afterEach(() => { vi.unstubAllGlobals(); });

describe('requestPersistentStorage', () => {
  it('returns the result of navigator.storage.persist', async () => {
    vi.stubGlobal('navigator', { storage: { persist: vi.fn().mockResolvedValue(true) } });
    expect(await requestPersistentStorage()).toBe(true);
  });

  it('returns false when the API is missing', async () => {
    vi.stubGlobal('navigator', {});
    expect(await requestPersistentStorage()).toBe(false);
  });

  it('returns false when persist rejects', async () => {
    vi.stubGlobal('navigator', { storage: { persist: vi.fn().mockRejectedValue(new Error('x')) } });
    expect(await requestPersistentStorage()).toBe(false);
  });
});

describe('getStorageEstimate', () => {
  it('returns usage and quota', async () => {
    vi.stubGlobal('navigator', { storage: { estimate: vi.fn().mockResolvedValue({ usage: 10, quota: 100 }) } });
    expect(await getStorageEstimate()).toEqual({ usage: 10, quota: 100 });
  });

  it('returns undefined when the API is missing or fails', async () => {
    vi.stubGlobal('navigator', {});
    expect(await getStorageEstimate()).toBeUndefined();
    vi.stubGlobal('navigator', { storage: { estimate: vi.fn().mockRejectedValue(new Error('x')) } });
    expect(await getStorageEstimate()).toBeUndefined();
  });
});
