import { describe, expect, it } from 'vitest';
import {
  HOME_VIEW_TOKEN_LENGTH, buildHomeViewUrl, createHomeViewToken, formatAgo, isHomeViewToken, isViewerEmail, lastUpdatedAt,
  latestPosition, parseHomeViewHash, viewerEmail, viewerToken,
} from './homeView';
import { canEditRecord } from './access';

const zeros = (b: Uint8Array): Uint8Array => b.fill(0);
const ones = (b: Uint8Array): Uint8Array => b.fill(255);
let seed = 1;
const pseudo = (b: Uint8Array): Uint8Array => {
  for (let i = 0; i < b.length; i++) b[i] = (seed = (seed * 1103515245 + 12345) % 2 ** 31) & 255;
  return b;
};

describe('createHomeViewToken', () => {
  it('encodes 16 random bytes (128 bit) as 26 lowercase base32 characters', () => {
    let requested = 0;
    const t = createHomeViewToken((b) => {
      requested = b.length;
      return pseudo(b);
    });
    expect(requested).toBe(16);
    expect(t).toHaveLength(HOME_VIEW_TOKEN_LENGTH);
    expect(t).toMatch(/^[a-z2-7]{26}$/);
  });

  it('is deterministic for the given bytes (all zero / all one bits)', () => {
    expect(createHomeViewToken(zeros)).toBe('a'.repeat(26));
    // 128 one bits: 25 full groups '7', the last group holds 3 bits padded with zeros (11100 = 28 = '4')
    expect(createHomeViewToken(ones)).toBe(`${'7'.repeat(25)}4`);
  });

  it('differs between calls with real randomness', () => {
    const rnd = (b: Uint8Array<ArrayBuffer>): Uint8Array => crypto.getRandomValues(b);
    expect(createHomeViewToken(rnd)).not.toBe(createHomeViewToken(rnd));
  });
});

describe('isHomeViewToken', () => {
  it('accepts exactly 26 base32 characters', () => {
    expect(isHomeViewToken(createHomeViewToken(pseudo))).toBe(true);
    expect(isHomeViewToken('a'.repeat(25))).toBe(false);
    expect(isHomeViewToken('a'.repeat(27))).toBe(false);
    expect(isHomeViewToken(`${'a'.repeat(25)}1`)).toBe(false);
    expect(isHomeViewToken(`${'a'.repeat(25)}A`)).toBe(false);
    expect(isHomeViewToken('')).toBe(false);
  });
});

describe('viewer e-mail', () => {
  const token = createHomeViewToken(pseudo);

  it('builds daheim-<token>@demo.local and reads the token back', () => {
    expect(viewerEmail(token)).toBe(`daheim-${token}@demo.local`);
    expect(viewerToken(viewerEmail(token))).toBe(token);
    expect(viewerToken(` DAHEIM-${token.toUpperCase()}@Demo.Local `)).toBe(token);
  });

  it('recognises viewer accounts only', () => {
    expect(isViewerEmail(viewerEmail(token))).toBe(true);
    expect(isViewerEmail('alice@demo.local')).toBe(false);
    expect(isViewerEmail(`daheim-${token}@example.com`)).toBe(false);
    expect(isViewerEmail('daheim-short@demo.local')).toBe(false);
    expect(isViewerEmail(undefined)).toBe(false);
    expect(viewerToken('bob@demo.local')).toBeUndefined();
  });

  it('rejects malformed tokens', () => {
    expect(() => viewerEmail('nope')).toThrow();
  });
});

describe('home view link', () => {
  const token = createHomeViewToken(pseudo);

  it('puts the token into the hash (never sent to a server)', () => {
    expect(buildHomeViewUrl('https://example.github.io', '/logbook/', token)).toBe(
      `https://example.github.io/logbook/#daheim=${token}`,
    );
    expect(buildHomeViewUrl('http://localhost:4173/', '/', token)).toBe(`http://localhost:4173/#daheim=${token}`);
    expect(buildHomeViewUrl('http://localhost:4173', './', token)).toBe(`http://localhost:4173/#daheim=${token}`);
  });

  it('parses the hash', () => {
    expect(parseHomeViewHash(`#daheim=${token}`)).toBe(token);
    expect(parseHomeViewHash(`#x=1&daheim=${token}`)).toBe(token);
    expect(parseHomeViewHash(`#daheim=${token.toUpperCase()}`)).toBe(token);
    expect(parseHomeViewHash(`daheim=${token}`)).toBe(token);
  });

  it('ignores missing or malformed tokens', () => {
    expect(parseHomeViewHash('')).toBeUndefined();
    expect(parseHomeViewHash('#')).toBeUndefined();
    expect(parseHomeViewHash('#daheim=')).toBeUndefined();
    expect(parseHomeViewHash('#daheim=abc')).toBeUndefined();
    expect(parseHomeViewHash('#other=1')).toBeUndefined();
  });
});

describe('lastUpdatedAt', () => {
  it('is the newest change of entries, day report sections and tracks (points included), ignoring tombstones', () => {
    expect(
      lastUpdatedAt({
        entries: [{ updatedAt: 100 }, { updatedAt: 900, deletedAt: 900 }, { updatedAt: 300 }],
        dayReports: [{ updatedAt: 200 }],
        tracks: [{ updatedAt: 150, points: [{ time: 250 }, { time: 400 }, {}] }],
      }),
    ).toBe(400);
    expect(lastUpdatedAt({ entries: [{ updatedAt: 500 }], dayReports: [], tracks: [] })).toBe(500);
  });

  it('is undefined without any data', () => {
    expect(lastUpdatedAt({ entries: [], dayReports: [], tracks: [] })).toBeUndefined();
    expect(lastUpdatedAt({ entries: [{ updatedAt: 1, deletedAt: 2 }], dayReports: [], tracks: [] })).toBeUndefined();
  });
});

describe('formatAgo', () => {
  const now = Date.UTC(2026, 9, 11, 12, 0, 0);
  const min = 60_000;
  it('speaks German in big steps', () => {
    expect(formatAgo(now - 10_000, now)).toBe('gerade eben');
    expect(formatAgo(now + 5 * min, now)).toBe('gerade eben'); // Uhr eines Geräts geht vor
    expect(formatAgo(now - min, now)).toBe('vor 1 Minute');
    expect(formatAgo(now - 59 * min, now)).toBe('vor 59 Minuten');
    expect(formatAgo(now - 60 * min, now)).toBe('vor 1 Stunde');
    expect(formatAgo(now - 23 * 60 * min, now)).toBe('vor 23 Stunden');
    expect(formatAgo(now - 24 * 60 * min, now)).toBe('vor 1 Tag');
    expect(formatAgo(now - 3 * 24 * 60 * min, now)).toBe('vor 3 Tagen');
  });
});

describe('latestPosition', () => {
  it('is the newest position of entries and timed track points', () => {
    const p = (lat: number) => ({ lat, lon: 10 });
    expect(
      latestPosition(
        [{ time: 100, position: p(1) }, { time: 300, position: p(3) }, { time: 500 }],
        [{ points: [{ ...p(2), time: 200 }, { ...p(4), time: 400 }, p(9)] }],
      ),
    ).toEqual(p(4));
    expect(latestPosition([{ time: 300, position: p(3) }], [{ points: [{ ...p(2), time: 200 }] }])).toEqual(p(3));
  });

  it('falls back to the last untimed track point, else undefined', () => {
    expect(latestPosition([], [{ points: [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }] }])).toEqual({ lat: 3, lon: 4 });
    expect(latestPosition([{ time: 1 }], [])).toBeUndefined();
  });
});

describe('canEditRecord for viewers (Daheim-Link)', () => {
  it('is always false, even for records without owner', () => {
    const viewer = { userId: 'daheim-x@demo.local', admin: false, viewer: true };
    expect(canEditRecord({}, viewer)).toBe(false);
    expect(canEditRecord({ owner: 'unauthorized' }, viewer)).toBe(false);
    expect(canEditRecord({ owner: 'daheim-x@demo.local' }, viewer)).toBe(false);
    expect(canEditRecord({ owner: 'alice' }, { ...viewer, admin: true })).toBe(false);
  });
});
