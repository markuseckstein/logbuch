export interface StorageEstimateResult {
  usage: number;
  quota: number;
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.storage?.persist !== 'function') return false;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function getStorageEstimate(): Promise<StorageEstimateResult | undefined> {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.storage?.estimate !== 'function') return undefined;
    const { usage, quota } = await navigator.storage.estimate();
    if (usage === undefined || quota === undefined) return undefined;
    return { usage, quota };
  } catch {
    return undefined;
  }
}
