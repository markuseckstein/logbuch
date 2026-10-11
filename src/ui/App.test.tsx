import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { App } from './App';
import { seedTrip, useCleanDb } from './test-utils';

vi.mock('./UpdatePrompt', () => ({ UpdatePrompt: () => null }));
vi.mock('../device', () => ({ captureFix: vi.fn(), resizeImage: vi.fn() }));

describe('App', () => {
  useCleanDb();

  it('zeigt ohne Törn automatisch das Onboarding und danach die Shell', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole('dialog', { name: 'Neuer Törn' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abbrechen' })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Name des Törns'), 'Sommertörn');
    await user.click(screen.getByRole('button', { name: 'Weiter' }));
    await user.click(screen.getByRole('button', { name: 'Weiter' }));
    await user.click(screen.getByRole('button', { name: 'Törn anlegen' }));

    const nav = await screen.findByRole('navigation', { name: 'Hauptnavigation' });
    expect(nav).toBeInTheDocument();
    expect(await screen.findByText('Sommertörn · Tag 1', { exact: false })).toBeInTheDocument();
    expect(await db.trips.count()).toBe(1);
  });

  it('wechselt Tabs und schaltet das Theme um', async () => {
    await seedTrip('Testtörn');
    const user = userEvent.setup();
    render(<App />);
    const nav = await screen.findByRole('navigation', { name: 'Hauptnavigation' });
    await user.click(screen.getByRole('button', { name: 'Karte' }));
    expect(screen.getByRole('button', { name: 'Karte' })).toHaveAttribute('aria-current', 'page');
    expect(nav).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Darstellung wechseln/ }));
    await vi.waitFor(() => expect(document.documentElement.dataset['theme']).toBe('dark'));
  });
});
