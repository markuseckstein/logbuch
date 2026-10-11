import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepScreenOn } from './wakeLock';

afterEach(() => vi.unstubAllGlobals());

function fakeLock() {
  const sentinel = { release: vi.fn().mockResolvedValue(undefined) };
  const request = vi.fn().mockResolvedValue(sentinel);
  vi.stubGlobal('navigator', { wakeLock: { request } });
  return { request, sentinel };
}

describe('keepScreenOn', () => {
  it('returns null when unsupported', async () => {
    vi.stubGlobal('navigator', {});
    expect(await keepScreenOn()).toBeNull();
  });

  it('returns null when the request is rejected', async () => {
    vi.stubGlobal('navigator', { wakeLock: { request: vi.fn().mockRejectedValue(new Error('x')) } });
    expect(await keepScreenOn()).toBeNull();
  });

  it('requests a screen lock and releases it', async () => {
    const { request, sentinel } = fakeLock();
    const release = await keepScreenOn();
    expect(request).toHaveBeenCalledWith('screen');
    release?.();
    expect(sentinel.release).toHaveBeenCalled();
  });

  it('re-requests on visibilitychange to visible until released', async () => {
    const { request } = fakeLock();
    const release = await keepScreenOn();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(request).toHaveBeenCalledTimes(2);
    release?.();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not re-request while hidden', async () => {
    const { request } = fakeLock();
    const release = await keepScreenOn();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(request).toHaveBeenCalledTimes(1);
    release?.();
  });
});
