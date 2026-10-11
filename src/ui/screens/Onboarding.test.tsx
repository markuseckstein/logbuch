import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { db } from '../../db/db';
import { getSettings, listBoats, listCrew } from '../../db/repo';
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
    await screen.findByLabelText('Name des Törns');
    await user.click(screen.getByRole('button', { name: 'Weiter' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Bitte gib dem Törn einen Namen.');
    expect(await db.trips.count()).toBe(0);
  });

  it('verlangt deinen Namen und mindestens ein Boot', async () => {
    const user = userEvent.setup();
    renderUi(<Onboarding onDone={vi.fn()} />);
    await screen.findByLabelText('Name des Törns');
    await user.type(screen.getByLabelText('Name des Törns'), 'T');
    await user.click(screen.getByRole('button', { name: 'Weiter' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Bitte gib deinen Namen an.');
    await user.type(screen.getByLabelText('Dein Name'), 'Anna');
    await user.click(screen.getByRole('button', { name: 'Weiter' }));
    await user.click(screen.getByRole('button', { name: 'Weiter' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Bitte lege mindestens ein Boot an.');
  });

  it('legt Törn mit Cover, zwei Booten (eins mit Foto) und dir als Admin an und setzt ihn aktiv', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    renderUi(<Onboarding onDone={onDone} />);
    await screen.findByLabelText('Name des Törns');

    await user.type(screen.getByLabelText('Name des Törns'), 'Dänische Südsee');
    await user.type(screen.getByLabelText('Revier (optional)'), 'Ostsee');
    await user.type(screen.getByLabelText('Dein Name'), 'Jonas');
    await user.upload(screen.getByLabelText('Cover-Bild wählen'), new File(['c'], 'cover.jpg', { type: 'image/jpeg' }));
    expect(await screen.findByAltText('Vorschau Cover-Bild')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Weiter' }));

    await user.type(screen.getByLabelText('Bootsname'), 'Seeschwalbe');
    await user.type(screen.getByLabelText('Typ / Modell'), 'Bavaria 37');
    await user.upload(screen.getByLabelText('Foto wählen (optional)'), new File(['x'], 'boot.jpg', { type: 'image/jpeg' }));
    await user.click(screen.getByRole('button', { name: 'Boot hinzufügen' }));
    await user.type(screen.getByLabelText('Bootsname'), 'Möwe');
    await user.click(screen.getByRole('button', { name: 'Weiter' }));
    expect(screen.getByRole('heading', { name: 'Crew einladen' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Törn anlegen' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    const [trip] = await db.trips.toArray();
    expect(trip).toMatchObject({ name: 'Dänische Südsee', area: 'Ostsee' });
    expect(trip?.coverPhotoId).toBeTruthy();
    const boats = await listBoats(db, trip!.id);
    expect(boats.map((b) => [b.name, b.model, b.colorIndex])).toEqual([['Seeschwalbe', 'Bavaria 37', 1], ['Möwe', undefined, 2]]);
    expect(boats[0]?.photoId).toBeTruthy();
    expect(await listCrew(db, trip!.id)).toMatchObject([{ name: 'Jonas', role: 'skipper', suggestedBoatId: boats[0]!.id }]);
    expect((await getSettings(db)).activeTripId).toBe(trip?.id);
  });
});
