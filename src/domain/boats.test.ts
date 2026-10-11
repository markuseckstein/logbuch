import { describe, expect, it } from 'vitest';
import {
  activeBoats,
  boatInUse,
  clampFocus,
  coverPosition,
  defaultEntryBoat,
  nameFromEmail,
  nextColorIndex,
  resolveBoatSelection,
  shownBoatIds,
} from './boats';
import type { Boat } from './types';

const boat = (id: string, colorIndex: number, extra: Partial<Boat> = {}): Boat => ({
  id, tripId: 't', name: id.toUpperCase(), colorIndex, createdAt: colorIndex, updatedAt: 1, updatedBy: 'd', ...extra,
});

describe('activeBoats', () => {
  it('drops tombstones and sorts by creation', () => {
    const a = boat('a', 2, { createdAt: 5 });
    const b = boat('b', 1, { createdAt: 1 });
    const c = boat('c', 3, { deletedAt: 9 });
    expect(activeBoats([a, c, b]).map((x) => x.id)).toEqual(['b', 'a']);
  });
});

describe('nextColorIndex', () => {
  it('starts with 1 and takes the first free index of 1..4', () => {
    expect(nextColorIndex([])).toBe(1);
    expect(nextColorIndex([boat('a', 1), boat('b', 3)])).toBe(2);
  });
  it('ignores removed boats and reuses the least used index beyond four boats', () => {
    expect(nextColorIndex([boat('a', 1, { deletedAt: 1 })])).toBe(1);
    const four = [boat('a', 1), boat('b', 2), boat('c', 3), boat('d', 4), boat('e', 1)];
    expect(nextColorIndex(four)).toBe(2);
  });
});

describe('resolveBoatSelection', () => {
  const boats = [boat('a', 1), boat('b', 2)];
  it('is undefined without boats and the only boat with one', () => {
    expect(resolveBoatSelection({ boats: [] })).toBeUndefined();
    expect(resolveBoatSelection({ boats: [boats[0]!], stored: 'all' })).toBe('a');
  });
  it('keeps a valid stored choice (boat or all)', () => {
    expect(resolveBoatSelection({ boats, stored: 'b', suggested: 'a' })).toBe('b');
    expect(resolveBoatSelection({ boats, stored: 'all', suggested: 'a' })).toBe('all');
  });
  it('falls back to the suggested boat, then to the first boat', () => {
    expect(resolveBoatSelection({ boats, stored: 'gone', suggested: 'b' })).toBe('b');
    expect(resolveBoatSelection({ boats, suggested: 'gone' })).toBe('a');
  });
});

describe('shownBoatIds', () => {
  const boats = [boat('a', 1), boat('b', 2)];
  it('all boats for "all" (or nothing chosen), otherwise the chosen one', () => {
    expect(shownBoatIds(boats, 'all')).toEqual(['a', 'b']);
    expect(shownBoatIds(boats, undefined)).toEqual(['a', 'b']);
    expect(shownBoatIds(boats, 'b')).toEqual(['b']);
  });
});

describe('defaultEntryBoat', () => {
  const boats = [boat('a', 1), boat('b', 2)];
  it('uses the selected boat', () => {
    expect(defaultEntryBoat({ boats, selection: 'b', last: 'a' })).toBe('b');
  });
  it('with "all": last boat of this device, then the suggestion', () => {
    expect(defaultEntryBoat({ boats, selection: 'all', last: 'b', suggested: 'a' })).toBe('b');
    expect(defaultEntryBoat({ boats, selection: 'all', last: 'gone', suggested: 'a' })).toBe('a');
  });
  it('no preselection with several boats and no hint; the only boat otherwise', () => {
    expect(defaultEntryBoat({ boats, selection: 'all' })).toBeUndefined();
    expect(defaultEntryBoat({ boats: [boats[1]!], selection: 'all' })).toBe('b');
  });
});

describe('boatInUse', () => {
  it('a boat with live entries or tracks cannot be removed', () => {
    expect(boatInUse('a', [{ boatId: 'a' }], [])).toBe(true);
    expect(boatInUse('a', [], [{ boatId: 'a' }])).toBe(true);
    expect(boatInUse('a', [{ boatId: 'a', deletedAt: 1 }], [{ boatId: 'b' }])).toBe(false);
  });
});

describe('nameFromEmail', () => {
  it('derives a display name from the local part', () => {
    expect(nameFromEmail('anna.berg@example.com')).toBe('Anna Berg');
    expect(nameFromEmail('ben_k-1@x.de')).toBe('Ben K 1');
    expect(nameFromEmail('@x')).toBe('@x');
  });
});

describe('cover focus', () => {
  it('clamps to 0..100 percent, invalid values become the center', () => {
    expect(clampFocus({ x: -5, y: 120 })).toEqual({ x: 0, y: 100 });
    expect(clampFocus({ x: Number.NaN, y: 33.33 })).toEqual({ x: 50, y: 33.3 });
  });
  it('object-position string, center without focus', () => {
    expect(coverPosition(undefined)).toBe('50% 50%');
    expect(coverPosition({ x: 20, y: 75 })).toBe('20% 75%');
  });
});
