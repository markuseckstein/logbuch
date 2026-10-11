import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { pickFile } from '../../device';
import { db } from '../../db/db';
import { renderUi, seedTrip, useCleanDb } from '../test-utils';
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
    const [track] = await db.tracks.toArray();
    expect(track).toMatchObject({ tripId: trip.id, name: 'Kiel-Eckernförde', source: 'gpx' });
    expect(track?.points).toHaveLength(2);
    expect(await screen.findByRole('list', { name: 'Tracks' })).toHaveTextContent(/GPX · 2 Punkte · 10\.08\./);
    // Track-Punkte mit Zeit erzeugen einen Törntag -> Filter-Chip
    expect(screen.getByRole('button', { name: 'Tag 1' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Track „Kiel-Eckernförde“ löschen/ }));
    expect(await db.tracks.count()).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Endgültig löschen' }));
    await waitFor(async () => expect(await db.tracks.count()).toBe(0));
  });

  it('meldet ungültige Dateien verständlich', async () => {
    vi.mocked(pickFile).mockResolvedValue(new File(['kein xml <<'], 'kaputt.gpx'));
    const trip = await seedTrip();
    renderUi(<MapScreen trip={trip} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'GPX importieren' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/GPX|XML/);
    expect(await db.tracks.count()).toBe(0);
  });
});
