import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { pickFile } from '../../device';
import { db } from '../../db/db';
import { listTracks, setBoatSelection } from '../../db/repo';
import { renderUi, seedBoats, seedEntry, seedTrip, useCleanDb } from '../test-utils';
import { MapScreen } from './MapScreen';

vi.mock('../components/ChartMap', () => ({ ChartMap: () => null }));
vi.mock('../../device', () => ({ pickFile: vi.fn(), keepScreenOn: vi.fn(), startLiveTracking: vi.fn() }));

const GPX = `<?xml version="1.0"?>
<gpx version="1.1" creator="t" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Kiel-Eckernförde</name><trkseg>
    <trkpt lat="54.40" lon="10.20"><time>2026-08-10T08:00:00Z</time></trkpt>
    <trkpt lat="54.45" lon="10.25"><time>2026-08-10T09:00:00Z</time></trkpt>
  </trkseg></trk>
</gpx>`;

describe('MapScreen – GPX', () => {
  useCleanDb();

  it('importiert eine GPX-Datei als Track, zeigt ihn an und löscht nach Bestätigung', async () => {
    vi.mocked(pickFile).mockResolvedValue(new File([GPX], 'fahrt.gpx', { type: 'application/gpx+xml' }));
    const trip = await seedTrip();
    const user = userEvent.setup();
    renderUi(<MapScreen trip={trip} />);

    await user.click(await screen.findByRole('button', { name: 'GPX importieren' }));
    await waitFor(async () => expect(await db.tracks.count()).toBe(1));
    const [track] = await listTracks(db, trip.id);
    expect(track).toMatchObject({ tripId: trip.id, name: 'Kiel-Eckernförde', source: 'gpx' });
    expect(track?.points).toHaveLength(2);
    expect(await screen.findByRole('list', { name: 'Tracks' })).toHaveTextContent(/Seeschwalbe · GPX · 2 Punkte · 10\.08\./);
    // Track-Punkte mit Zeit erzeugen einen Törntag -> Filter-Chip
    expect(screen.getByRole('button', { name: 'Tag 1' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Track „Kiel-Eckernförde“ löschen/ }));
    expect(await db.tracks.count()).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Endgültig löschen' }));
    await waitFor(async () => expect((await db.tracks.toArray())[0]!.deletedAt).toBeDefined()); // Tombstone
  });

  it('meldet ungültige Dateien verständlich', async () => {
    vi.mocked(pickFile).mockResolvedValue(new File(['kein xml <<'], 'kaputt.gpx'));
    const trip = await seedTrip();
    renderUi(<MapScreen trip={trip} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'GPX importieren' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/GPX|XML/);
    expect(await db.tracks.count()).toBe(0);
  });

  it('importiert GPX bei „Alle“ erst nach der Bootswahl', async () => {
    vi.mocked(pickFile).mockResolvedValue(new File([GPX], 'fahrt.gpx', { type: 'application/gpx+xml' }));
    const trip = await seedTrip('F', ['Seeschwalbe', 'Möwe']);
    const [, moewe] = await seedBoats(trip.id);
    await setBoatSelection(db, trip.id, 'all');
    const user = userEvent.setup();
    renderUi(<MapScreen trip={trip} />);
    await user.click(await screen.findByRole('button', { name: 'GPX importieren' }));
    const dialog = await screen.findByRole('dialog', { name: 'GPX importieren' });
    await user.click(within(dialog).getByRole('radio', { name: 'Möwe' }));
    await user.click(within(dialog).getByRole('button', { name: 'Datei wählen' }));
    await waitFor(async () => expect((await db.tracks.toArray())[0]?.boatId).toBe(moewe!.id));
  });

  it('Legende: alle Boote mit Statistik, Ein-/Ausblenden', async () => {
    const trip = await seedTrip('F', ['Seeschwalbe', 'Möwe']);
    const [a, b] = await seedBoats(trip.id);
    await seedEntry(trip.id, Date.UTC(2026, 7, 10, 10), a!.id);
    await seedEntry(trip.id, Date.UTC(2026, 7, 10, 11), b!.id);
    await seedEntry(trip.id, Date.UTC(2026, 7, 10, 12), b!.id);
    const user = userEvent.setup();
    renderUi(<MapScreen trip={trip} />);
    const legend = await screen.findByRole('region', { name: 'Legende' });
    expect(legend).toHaveTextContent('Seeschwalbe');
    expect(legend).toHaveTextContent('Möwe');
    expect(legend).toHaveTextContent('2 Einträge');
    expect(screen.getByText(/3 Einträge · 2 von 2 Booten sichtbar/)).toBeInTheDocument();
    const toggle = within(legend).getByRole('button', { name: 'Möwe ausblenden' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await user.click(toggle);
    expect(within(legend).getByRole('button', { name: 'Möwe einblenden' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(/1 Einträge · 1 von 2 Booten sichtbar/)).toBeInTheDocument();
  });
});

describe('MapScreen – Live-Route', () => {
  useCleanDb();

  it('Live-Karte steht vor der GPX-Karte', async () => {
    const trip = await seedTrip();
    renderUi(<MapScreen trip={trip} />);
    const live = await screen.findByRole('region', { name: 'Live-Route' });
    const gpx = screen.getByRole('region', { name: 'GPX' });
    expect(live.compareDocumentPosition(gpx) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('focusLive (Tipp auf REC): Schalter bekommt Fokus, danach wird zurückgemeldet', async () => {
    const trip = await seedTrip();
    const done = vi.fn();
    renderUi(<MapScreen trip={trip} focusLive onFocusLiveDone={done} />);
    const toggle = await screen.findByRole('switch', { name: /Live-Route aufzeichnen/ });
    await waitFor(() => expect(toggle).toHaveFocus());
    expect(done).toHaveBeenCalledTimes(1);
  });
});
