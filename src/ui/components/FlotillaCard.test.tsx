import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { saveOrShareFile } from '../../device';
import { db } from '../../db/db';
import { createTrip, setFlotilla, setTripOwnership } from '../../db/repo';
import { renderUi, seedTrip, useCleanDb } from '../test-utils';
import { FlotillaCard } from './FlotillaCard';

vi.mock('../../device', () => ({ saveOrShareFile: vi.fn(), pickFile: vi.fn() }));

describe('FlotillaCard', () => {
  useCleanDb();

  it('gründet eine Flottille mit neuer ID und zeigt Namen und Boote', async () => {
    const trip = await seedTrip();
    const user = userEvent.setup();
    const view = renderUi(<FlotillaCard trip={trip} readOnly={false} />);

    await user.click(screen.getByRole('button', { name: 'Flottille gründen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Namen/);

    await user.type(screen.getByLabelText('Name der Flottille'), 'Sommerflotte');
    await user.click(screen.getByRole('button', { name: 'Flottille gründen' }));
    await waitFor(async () => expect((await db.trips.get(trip.id))?.flotilla?.name).toBe('Sommerflotte'));
    const flotilla = (await db.trips.get(trip.id))!.flotilla!;
    expect(flotilla.id).toMatch(/^[0-9a-f-]{36}$/);

    view.rerender(<FlotillaCard trip={(await db.trips.get(trip.id))!} readOnly={false} />);
    expect(await screen.findByText('Sommerflotte')).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Boote der Flottille' });
    await waitFor(() => expect(list).toHaveTextContent('eigenes Boot'));
  });

  it('listet Boote der Flottille mit Status und wechselt per Antippen', async () => {
    const mine = await seedTrip('Mein Törn');
    await setFlotilla(db, mine.id, { id: 'f1', name: 'Flotte' });
    const other = await createTrip(db, { name: 'Anderer Törn', boat: { name: 'Möwe' }, crew: [], flotilla: { id: 'f1', name: 'Flotte' } });
    await setTripOwnership(db, other.id, 'foreign');
    const user = userEvent.setup();
    renderUi(<FlotillaCard trip={(await db.trips.get(mine.id))!} readOnly={false} />);

    const list = await screen.findByRole('list', { name: 'Boote der Flottille' });
    await waitFor(() => expect(list).toHaveTextContent('Möwe'));
    expect(list).toHaveTextContent('nur lesen');
    await user.click(screen.getByRole('button', { name: 'Zu Logbuch „Möwe“ wechseln' }));
    await waitFor(async () => expect((await db.settings.get('activeTripId'))?.value).toBe(other.id));
  });

  it('teilt wahlweise ohne Fotos als ZIP mit Bootsnamen im Dateinamen', async () => {
    vi.mocked(saveOrShareFile).mockResolvedValue('downloaded');
    const trip = await seedTrip();
    const user = userEvent.setup();
    renderUi(<FlotillaCard trip={trip} readOnly={false} />);

    await user.click(screen.getByRole('button', { name: 'Logbuch teilen' }));
    expect(await screen.findByRole('dialog', { name: 'Logbuch teilen' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ohne Fotos (klein)' }));

    await waitFor(() => expect(saveOrShareFile).toHaveBeenCalledTimes(1));
    const [blob, name] = vi.mocked(saveOrShareFile).mock.calls[0] ?? [];
    expect(name).toMatch(/^logbuch-seeschwalbe-\d{4}-\d{2}-\d{2}-ohne-fotos\.zip$/);
    expect((blob as Blob).type).toBe('application/zip');
  });

  it('Flottille gründen entfällt im fremden Logbuch', async () => {
    const trip = await seedTrip();
    renderUi(<FlotillaCard trip={trip} readOnly />);
    expect(screen.queryByRole('button', { name: 'Flottille gründen' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Logbuch teilen' })).toBeInTheDocument();
  });
});
