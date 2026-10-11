/** Reads a Blob's bytes; falls back where Blob.arrayBuffer is missing (older jsdom). */
export async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error ?? new Error('Blob konnte nicht gelesen werden.'));
    r.readAsArrayBuffer(blob);
  });
}

export async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blobToArrayBuffer(blob));
}
