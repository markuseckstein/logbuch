import { describe, expect, it } from 'vitest';
import { ENTRY_ICON } from './icons';

describe('ENTRY_ICON', () => {
  it('Motor an und Motor aus haben verschiedene Symbole', () => {
    expect(ENTRY_ICON['engine-on']).not.toBe(ENTRY_ICON['engine-off']);
  });
});
