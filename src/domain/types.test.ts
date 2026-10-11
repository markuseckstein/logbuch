import { describe, expect, it } from 'vitest';
import type { LogEntry, Trip } from './types';

describe('domain/types', () => {
  it('ist importierbar und das Datenmodell ist typisierbar', () => {
    const trip: Trip = {
      id: 't1',
      name: 'Test',
      createdAt: 0,
      updatedAt: 0,
      updatedBy: 'd',
    };
    const entry: LogEntry = {
      id: 'e1',
      tripId: trip.id,
      boatId: 'b1',
      time: 0,
      tzOffsetMin: 120,
      type: 'note',
      photoIds: [],
      createdAt: 0,
      updatedAt: 0,
      updatedBy: 'd',
    };
    expect(entry.tripId).toBe('t1');
  });
});
