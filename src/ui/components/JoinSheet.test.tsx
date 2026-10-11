import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PersonInfo } from '../../db/cloud';
import type { Trip } from '../../domain';
import { renderUi, useCleanDb } from '../test-utils';
import { JoinSheet } from './JoinSheet';

const trip = { id: 't-1', name: 'Ostsee' } as Trip;
const bob: PersonInfo = { crewId: 'c2', name: 'Bob', email: 'bob@x.de', admin: false, status: 'invited', self: false };

describe('JoinSheet', () => {
  useCleanDb();
  it('zeigt QR-Code, Link mit join= und Anleitung', async () => {
    renderUi(<JoinSheet trip={trip} people={[bob]} onClose={vi.fn()} />);
    expect(await screen.findByRole('img', { name: /QR-Code zum Beitreten/ })).toBeInTheDocument();
    expect(screen.getByTestId('join-link').textContent).toContain('?join=t-1');
    expect(screen.getByText(/Crew scannt den Code/)).toBeInTheDocument();
    expect(screen.queryByText(/Noch niemand eingetragen/)).toBeNull();
  });
  it('weist darauf hin, wenn noch niemand eingetragen ist', async () => {
    renderUi(<JoinSheet trip={trip} people={[]} onClose={vi.fn()} />);
    expect(await screen.findByText(/Noch niemand eingetragen/)).toBeInTheDocument();
  });
  it('kopiert den Link, wenn Teilen nicht verfügbar ist', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    renderUi(<JoinSheet trip={trip} people={[bob]} onClose={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Link teilen' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('?join=t-1'));
    expect(await screen.findByText('Link in die Zwischenablage kopiert')).toBeInTheDocument();
  });
});
