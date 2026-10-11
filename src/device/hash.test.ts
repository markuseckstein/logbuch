import { describe, expect, it } from 'vitest';
import { hashBlob } from './hash';

describe('hashBlob', () => {
  it('returns the lowercase hex SHA-256 of the content', async () => {
    expect(await hashBlob(new Blob(['abc']))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
  it('is stable for empty content', async () => {
    expect(await hashBlob(new Blob([]))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
