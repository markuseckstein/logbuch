import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { db } from '../../db/db';
import { addBoat, addPhotosToEntry, updateEntry, upsertDayReport } from '../../db/repo';
import type { MapLayer } from '../components/ChartMap';
import { ToastProvider } from '../toast';
import { seedBoats, seedEntry, seedTrip, useCleanDb } from '../test-utils';
import { HomeViewScreen } from './HomeViewScreen';

const layersSeen: MapLayer[][] = [];
vi.mock('../components/ChartMap', () => ({
  ChartMap: ({ layers, label }: { layers: MapLayer[]; label: string }) => {
    layersSeen.push(layers);
    return <div role="group" aria-label={label} />;
  },
}));

describe('HomeViewScreen (Daheim-Ansicht)', () => {
  useCleanDb();

  it('zeigt Törn, Karte, Tage absteigend mit Berichten, Einträgen und Fotos – ohne Bearbeiten-Elemente', async () => {
    const trip = await seedTrip('Ostsee 2026', ['Seeschwalbe']);
    await addBoat(db, trip.id, { name: 'Möwe' });
    const [b1, b2] = await seedBoats(trip.id);
    const e1 = await seedEntry(trip.id, Date.UTC(2026, 7, 10, 8, 0), b1!.id);
    await updateEntry(db, e1.id, { text: 'Ablegen in Kiel', position: { lat: 54.3, lon: 10.1 } });
    await addPhotosToEntry(db, e1.id, [{ blob: new Blob(['x'], { type: 'image/jpeg' }), mime: 'image/jpeg', width: 2000, height: 1500 }]);
    const e2 = await seedEntry(trip.id, Date.UTC(2026, 7, 11, 9, 0), b2!.id);
    await updateEntry(db, e2.id, { text: 'Möwe in Marstal', position: { lat: 54.85, lon: 10.5 } });
    await upsertDayReport(db, trip.id, '2026-08-11', { title: 'Überfahrt', text: 'Schöner Segeltag' });
    const t = (await db.trips.get(trip.id))!;

    render(<ToastProvider><HomeViewScreen trip={t} onLeave={() => undefined} /></ToastProvider>);

    expect(await screen.findByRole('heading', { name: 'Ostsee 2026', level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/^Zuletzt aktualisiert (gerade eben|vor)/)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Karte aller Boote' })).toBeInTheDocument();
    const days = await screen.findAllByRole('region', { name: /^Tag \d$/ });
    expect(days.map((d) => d.getAttribute('aria-label'))).toEqual(['Tag 2', 'Tag 1']);
    expect(within(days[0]!).getByRole('article', { name: 'Tagesbericht von Anna' })).toHaveTextContent('Schöner Segeltag');
    expect(within(days[0]!).getByText('Möwe in Marstal')).toBeInTheDocument();
    expect(within(days[0]!).getByText('Möwe', { selector: '.bb' })).toBeInTheDocument();
    expect(within(days[1]!).getByText('Ablegen in Kiel')).toBeInTheDocument();
    // letzte Position je Boot hervorgehoben
    const layers = layersSeen[layersSeen.length - 1]!;
    expect(layers.find((l) => l.id === b2!.id)?.last).toEqual({ lat: 54.85, lon: 10.5 });

    // nur lesen: keine Bearbeiten-/Anlegen-/Export-/Einladen-Elemente, keine Tab-Leiste
    for (const name of [/Bearbeiten/, /Eintrag jetzt/, /Speichern/, /Löschen/, /Export/, /einladen/i, /Abschnitt schreiben/]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.queryByRole('navigation')).toBeNull();

    // Foto antippen = groß
    await userEvent.setup().click(within(days[1]!).getByRole('button', { name: 'Foto 1 groß anzeigen' }));
    expect(screen.getByRole('dialog', { name: 'Foto 1 / 1' })).toHaveTextContent('Seeschwalbe · Anna');
  });

  it('ohne Einträge: freundlicher Hinweis', async () => {
    const trip = await seedTrip('Leer');
    render(<ToastProvider><HomeViewScreen trip={trip} onLeave={() => undefined} /></ToastProvider>);
    expect(await screen.findByText('Noch keine Einträge')).toBeInTheDocument();
    expect(screen.getByText('Sobald die Crew etwas einträgt, erscheint es hier.')).toBeInTheDocument();
  });

  it('„Zur Crew-Anmeldung“: erst nachfragen, dann verlassen', async () => {
    const trip = await seedTrip('Ostsee');
    const onLeave = vi.fn();
    const user = userEvent.setup();
    render(<ToastProvider><HomeViewScreen trip={trip} onLeave={onLeave} /></ToastProvider>);

    await user.click(await screen.findByRole('button', { name: 'Zur Crew-Anmeldung' }));
    const dlg = screen.getByRole('dialog', { name: 'Daheim-Ansicht verlassen?' });
    expect(dlg).toHaveTextContent('Um sie wieder zu sehen, brauchst du den Link.');
    await user.click(within(dlg).getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onLeave).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Zur Crew-Anmeldung' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Verlassen' }));
    expect(onLeave).toHaveBeenCalledOnce();
  });
});
