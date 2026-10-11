import { describe, expect, it } from 'vitest';
import { dayReportId, timeOrderedId } from './ids';

describe('dayReportId', () => {
  it('is deterministic per trip, date and author (same section on every device)', () => {
    expect(dayReportId('t1', '2026-07-01', 'c1')).toBe(dayReportId('t1', '2026-07-01', 'c1'));
    expect(dayReportId('t1', '2026-07-01', 'c1')).not.toBe(dayReportId('t1', '2026-07-01', 'c2'));
    expect(dayReportId('t1', '2026-07-01', '')).not.toBe(dayReportId('t1', '2026-07-02', ''));
  });
  it('never contains an empty part (no empty author key)', () => {
    expect(dayReportId('t1', '2026-07-01', '')).toMatch(/[^|]$/);
  });
});

describe('timeOrderedId', () => {
  it('sorts lexicographically in time order (photoIds stay chronological under Dexie add())', () => {
    const ids = [timeOrderedId(1_000), timeOrderedId(2_000), timeOrderedId(30_000_000_000_000)];
    expect([...ids].reverse().sort()).toEqual(ids);
  });
  it('is unique for the same time', () => {
    expect(timeOrderedId(5)).not.toBe(timeOrderedId(5));
  });
});
