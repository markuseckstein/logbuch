/** Fordert Screen Wake Lock an, erneuert ihn bei visibilitychange. Rückgabe: release(). null wenn nicht unterstützt. */
export async function keepScreenOn(): Promise<(() => void) | null> {
  if (typeof navigator === 'undefined' || !navigator.wakeLock) return null;
  let sentinel: WakeLockSentinel;
  try {
    sentinel = await navigator.wakeLock.request('screen');
  } catch {
    return null;
  }
  let released = false;
  const onVisible = (): void => {
    if (released || document.visibilityState !== 'visible') return;
    navigator.wakeLock
      .request('screen')
      .then((s) => {
        if (released) void s.release();
        else sentinel = s;
      })
      .catch(() => {});
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    released = true;
    document.removeEventListener('visibilitychange', onVisible);
    void sentinel.release().catch(() => {});
  };
}
