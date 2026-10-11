/** Skaliert (w,h) so, dass die lange Kante maxEdge nicht überschreitet; nie hochskalieren. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

const MIME = 'image/jpeg';

/** Verkleinert auf max. Kantenlänge (Default 2000 px), JPEG Qualität 0.85, EXIF-Orientierung beachtet.
 *  Immer neu kodiert, dadurch werden EXIF/GPS-Metadaten entfernt. */
export async function resizeImage(
  file: Blob,
  opts: { maxEdge?: number; quality?: number } = {},
): Promise<{ blob: Blob; width: number; height: number; mime: string }> {
  const maxEdge = opts.maxEdge ?? 2000;
  const quality = opts.quality ?? 0.85;
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge);
    let blob: Blob;
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D nicht verfügbar');
      ctx.drawImage(bitmap, 0, 0, width, height);
      blob = await canvas.convertToBlob({ type: MIME, quality });
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D nicht verfügbar');
      ctx.drawImage(bitmap, 0, 0, width, height);
      const encoded = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, MIME, quality));
      if (!encoded) throw new Error('Bild konnte nicht kodiert werden');
      blob = encoded;
    }
    return { blob, width, height, mime: MIME };
  } finally {
    bitmap.close();
  }
}
