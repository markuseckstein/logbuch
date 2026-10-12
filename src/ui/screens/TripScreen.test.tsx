import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { db } from '../../db/db';
import { addCrewMember } from '../../db/repo';
import { renderUi, seedTrip, useCleanDb } from '../test-utils';
import { TripScreen } from './TripScreen';

const before = (a: Element, b: Element): boolean => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('TripScreen', () => {
  useCleanDb();

  it('Reihenfolge: Konto, Einladen und Mitglieder, Boote, Törndaten, Törn-Liste, Export, Löschen', async () => {
    const trip = await seedTrip('Ostsee', ['Seeschwalbe', 'Möwe']);
    renderUi(<TripScreen trip={trip} />);
    const account = await screen.findByRole('region', { name: 'Konto' });
    const members = screen.getByRole('region', { name: 'Mitglieder' });
    const boat = screen.getByRole('article', { name: 'Boot Seeschwalbe' });
    const data = screen.getByLabelText('Törndaten');
    const list = await screen.findByRole('region', { name: 'Alle Törns' });
    const exp = screen.getByRole('region', { name: 'Export' });
    const del = screen.getByRole('button', { name: /Diesen Törn auf diesem Gerät löschen/ });
    const order = [account, members, boat, data, list, exp, del];
    for (let i = 0; i < order.length - 1; i++) expect(before(order[i]!, order[i + 1]!)).toBe(true);
  });

  it('„Ich bin …“ bietet nur Personen ohne E-Mail oder die schon dabei sind', async () => {
    const trip = await seedTrip('Ostsee');
    await addCrewMember(db, trip.id, { name: 'Ben' });
    await addCrewMember(db, trip.id, { name: 'Carla', email: 'carla@example.com' });
    renderUi(<TripScreen trip={trip} />);
    const card = await screen.findByRole('region', { name: 'Ich bin …' });
    const names = within(card).getAllByRole('radio').map((r) => r.textContent);
    expect(names).toEqual(['Anna', 'Ben']);
  });

  it('Boot-Vorschlag hat ein sichtbares Label', async () => {
    const trip = await seedTrip('Ostsee');
    renderUi(<TripScreen trip={trip} />);
    expect(await screen.findByText('Boot-Vorschlag:')).toBeVisible();
  });
});
