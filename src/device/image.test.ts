import { afterEach, describe, expect, it, vi } from 'vitest';
import { fitWithin, resizeImage } from './image';

describe('fitWithin', () => {
  it('scales landscape so the long edge equals maxEdge', () => {
    expect(fitWithin(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 });
  });
  it('scales portrait', () => {
    expect(fitWithin(3000, 4000, 2000)).toEqual({ width: 1500, height: 2000 });
  });
  it('never upscales', () => {
    expect(fitWithin(800, 600, 2000)).toEqual({ width: 800, height: 600 });
  });
  it('rounds and keeps at least 1px', () => {
    expect(fitWithin(3001, 1, 2000)).toEqual({ width: 2000, height: 1 });
  });
});

describe('resizeImage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('decodes with EXIF orientation, scales and encodes as JPEG', async () => {
    const close = vi.fn();
    const createImageBitmap = vi.fn().mockResolvedValue({ width: 4000, height: 3000, close });
    const drawImage = vi.fn();
    const out = new Blob(['x'], { type: 'image/jpeg' });
    const convertToBlob = vi.fn().mockResolvedValue(out);
    class FakeOffscreen {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        return { drawImage };
      }
      convertToBlob = convertToBlob;
    }
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    vi.stubGlobal('OffscreenCanvas', FakeOffscreen);

    const file = new Blob(['in']);
    const res = await resizeImage(file, { maxEdge: 2000, quality: 0.7 });

    expect(createImageBitmap).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' });
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2000, 1500);
    expect(convertToBlob).toHaveBeenCalledWith({ type: 'image/jpeg', quality: 0.7 });
    expect(res).toEqual({ blob: out, width: 2000, height: 1500, mime: 'image/jpeg' });
    expect(close).toHaveBeenCalled();
  });

  it('re-encodes small images without upscaling', async () => {
    const createImageBitmap = vi.fn().mockResolvedValue({ width: 800, height: 600, close: vi.fn() });
    const convertToBlob = vi.fn().mockResolvedValue(new Blob(['x']));
    class FakeOffscreen {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        return { drawImage: vi.fn() };
      }
      convertToBlob = convertToBlob;
    }
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    vi.stubGlobal('OffscreenCanvas', FakeOffscreen);
    const res = await resizeImage(new Blob(['in']));
    expect(res.width).toBe(800);
    expect(convertToBlob).toHaveBeenCalledWith({ type: 'image/jpeg', quality: 0.85 });
  });

  it('falls back to <canvas>.toBlob without OffscreenCanvas', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 100, height: 50, close: vi.fn() }));
    vi.stubGlobal('OffscreenCanvas', undefined);
    const out = new Blob(['x'], { type: 'image/jpeg' });
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (cb: (b: Blob | null) => void, type: string, q: number) => {
        expect(type).toBe('image/jpeg');
        expect(q).toBe(0.85);
        cb(out);
      },
    };
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement);
    const res = await resizeImage(new Blob(['in']));
    expect(res.blob).toBe(out);
    expect(canvas.width).toBe(100);
    vi.restoreAllMocks();
  });

  it('rejects when encoding yields null', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 10, height: 10, close: vi.fn() }));
    vi.stubGlobal('OffscreenCanvas', undefined);
    vi.spyOn(document, 'createElement').mockReturnValue({
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (cb: (b: Blob | null) => void) => cb(null),
    } as unknown as HTMLCanvasElement);
    await expect(resizeImage(new Blob(['in']))).rejects.toThrow();
    vi.restoreAllMocks();
  });
});
