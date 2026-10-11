import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { db } from '../../db/db';
import { getSettings, listCrew } from '../../db/repo';
import { renderUi, useCleanDb } from '../test-utils';
import { Onboarding } from './Onboarding';

vi.mock('../../device', () => ({
  resizeImage: vi.fn(async () => ({
    blob: new Blob(['x'], { type: 'image/jpeg' }),
    width: 10,
    height: 10,
    mime: 'image/jpeg',
  })),
}));

describe('Onboarding', () => {
  useCleanDb();

  it('verlangt einen Törnnamen', async () => {
    const user = userEvent.setup();
    renderUi(<Onboarding onDone={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Weiter' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Bitte gib dem Törn einen Namen.');
    expect(await db.trips.count()).toBe(0);
  });

  it('legt Törn mit Boot und Crew an und setzt ihn aktiv', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    renderUi(<Onboarding onDone={onDone} />);

    await user.type(screen.getByLabelText('Name des Törns'), 'Dänische Südsee');
    await user.type(screen.getByLabelText('Revier (optional)'), 'Ostsee');
    await user.click(screen.getByRole('button', { name: 'Weiter' }));

    await user.type(screen.getByLabelText('Bootsname'), 'Seeschwalbe');
    await user.type(screen.getByLabelText('Länge (m)'), '10.3');
    await user.upload(screen.getByLabelText('Bootsfoto wählen'), new File(['x'], 'boot.jpg', { type: 'image/jpeg' }));
    await user.click(screen.getByRole('button', { name: 'Weiter' }));

    await user.type(screen.getByLabelText('Name'), 'Jonas');
    await user.selectOptions(screen.getByLabelText('Rolle'), 'skipper');
    await user.click(screen.getByRole('button', { name: 'Crew hinzufügen' }));
    await user.click(screen.getByRole('button', { name: 'Törn anlegen' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    const [trip] = await db.trips.toArray();
    expect(trip).toMatchObject({ name: 'Dänische Südsee', area: 'Ostsee' });
    expect(trip?.boat).toMatchObject({ name: 'Seeschwalbe', lengthM: 10.3 });
    expect(trip?.boat.photoId).toBeTruthy();
    expect(await listCrew(db, trip!.id)).toMatchObject([{ name: 'Jonas', role: 'skipper' }]);
    expect((await getSettings(db)).activeTripId).toBe(trip?.id);
  });
});
