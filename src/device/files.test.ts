import { afterEach, describe, expect, it, vi } from 'vitest';
import { pickFile, saveOrShareFile } from './files';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const blob = new Blob(['data'], { type: 'application/zip' });

describe('saveOrShareFile', () => {
  it('shares when canShare accepts files', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { canShare: () => true, share });
    expect(await saveOrShareFile(blob, 'a.zip')).toBe('shared');
    const arg = share.mock.calls[0]?.[0] as { files: File[] };
    expect(arg.files[0]?.name).toBe('a.zip');
  });

  it('returns cancelled on AbortError', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('x', 'AbortError'));
    vi.stubGlobal('navigator', { canShare: () => true, share });
    expect(await saveOrShareFile(blob, 'a.zip')).toBe('cancelled');
  });

  it('falls back to download on other share errors', async () => {
    vi.stubGlobal('navigator', { canShare: () => true, share: vi.fn().mockRejectedValue(new Error('x')) });
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    expect(await saveOrShareFile(blob, 'a.zip')).toBe('downloaded');
    expect(click).toHaveBeenCalled();
  });

  it('downloads via <a download> when sharing is unsupported', async () => {
    vi.stubGlobal('navigator', {});
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    expect(await saveOrShareFile(blob, 'a.zip')).toBe('downloaded');
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('a.zip');
    expect(anchor.href).toBe('blob:x');
  });
});

describe('pickFile', () => {
  function capture() {
    let input: HTMLInputElement | undefined;
    const orig = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = orig(tag);
      if (tag === 'input') {
        input = el as HTMLInputElement;
        vi.spyOn(input, 'click').mockImplementation(() => {});
      }
      return el;
    });
    return () => input as HTMLInputElement;
  }

  it('resolves with the chosen file', async () => {
    const get = capture();
    const p = pickFile('.zip');
    const input = get();
    expect(input.type).toBe('file');
    expect(input.accept).toBe('.zip');
    const file = new File(['x'], 'x.zip');
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    expect(await p).toBe(file);
  });

  it('resolves null on cancel', async () => {
    const get = capture();
    const p = pickFile('.zip');
    get().dispatchEvent(new Event('cancel'));
    expect(await p).toBeNull();
  });
});
