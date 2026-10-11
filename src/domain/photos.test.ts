import { describe, expect, it } from 'vitest';
import { planPhotoAdds } from './photos';

const c = (...hashes: string[]) => hashes.map((hash) => ({ hash }));

describe('planPhotoAdds', () => {
  it('accepts all new photos within the limit', () => {
    expect(planPhotoAdds({ candidates: c('a', 'b'), existingDayHashes: new Set(), currentCount: 0, max: 5 }))
      .toEqual({ accept: [0, 1], skippedDuplicate: 0, skippedLimit: 0 });
  });
  it('skips photos already present on the day', () => {
    expect(planPhotoAdds({ candidates: c('a', 'b', 'c'), existingDayHashes: new Set(['b']), currentCount: 0, max: 5 }))
      .toEqual({ accept: [0, 2], skippedDuplicate: 1, skippedLimit: 0 });
  });
  it('skips duplicates inside the selection', () => {
    expect(planPhotoAdds({ candidates: c('a', 'a', 'b', 'a'), existingDayHashes: new Set(), currentCount: 0, max: 5 }))
      .toEqual({ accept: [0, 2], skippedDuplicate: 2, skippedLimit: 0 });
  });
  it('respects the remaining capacity and counts the rest as limit skips', () => {
    expect(planPhotoAdds({ candidates: c('a', 'b', 'c', 'd'), existingDayHashes: new Set(), currentCount: 3, max: 5 }))
      .toEqual({ accept: [0, 1], skippedDuplicate: 0, skippedLimit: 2 });
  });
  it('does not count duplicates as limit skips', () => {
    expect(planPhotoAdds({ candidates: c('x', 'a', 'b'), existingDayHashes: new Set(['x']), currentCount: 4, max: 5 }))
      .toEqual({ accept: [1], skippedDuplicate: 1, skippedLimit: 1 });
  });
  it('accepts nothing when full', () => {
    expect(planPhotoAdds({ candidates: c('a'), existingDayHashes: new Set(), currentCount: 5, max: 5 }))
      .toEqual({ accept: [], skippedDuplicate: 0, skippedLimit: 1 });
  });
});
