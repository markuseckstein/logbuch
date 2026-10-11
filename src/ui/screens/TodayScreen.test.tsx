import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { FixResult } from '../../device';
import { captureFix } from '../../device';
import { db } from '../../db/db';
import { addBoat, addCrewMember, getAuthor, setAuthor, setBoatSelection, setLastBoat } from '../../db/repo';
import { asCloudMember, makeActions, renderUi, seedBoats, seedTrip, useCleanDb } from '../test-utils';
import { TodayScreen } from './TodayScreen';

vi.mock('../components/ChartMap', () => ({ ChartMap: () => null }));
vi.mock('../../device', () => ({ captureFix: vi.fn() }));

const mockFix = (result: FixResult): void => {
  vi.mocked(captureFix).mockReturnValue({ first: Promise.resolve(result), stop: vi.fn() });
};

describe('TodayScreen – Eintrag jetzt', () => {
  useCleanDb();

  it('legt auch bei verweigertem GPS einen Eintrag ohne Position an', async () => {
    mockFix({ error: 'denied' });
    const trip = await seedTrip();
    const actions = makeActions();
    renderUi(<TodayScreen trip={trip} reports={[]} />, actions);

    await userEvent.setup().click(await screen.findByRole('button', { name: /Eintrag jetzt/ }));

    await waitFor(() => expect(actions.openEntry).toHaveBeenCalled(), { timeout: 4000 });
    const entries = await db.entries.toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.position).toBeUndefined();
    expect(entries[0]?.tripId).toBe(trip.id);
    expect(entries[0]?.tzOffsetMin).toBe(-new Date().getTimezoneOffset());
    expect(screen.getByRole('status')).toHaveTextContent(
      /Eintrag \d\d:\d\d gespeichert · ohne Position \(GPS: Zugriff verweigert\)/,
    );
    expect(actions.openEntry).toHaveBeenCalledWith(entries[0]?.id, true);
  });

  it('übernimmt die Position und zeigt sie im Toast; Verbesserung aktualisiert sie', async () => {
    let improve: ((p: { lat: number; lon: number }) => void) | undefined;
    vi.mocked(captureFix).mockImplementation((opts) => {
      improve = opts?.onImproved;
      return { first: Promise.resolve({ position: { lat: 54.3185, lon: 10.1407, accuracyM: 40 } }), stop: vi.fn() };
    });
    const trip = await seedTrip();
    const actions = makeActions();
    renderUi(<TodayScreen trip={trip} reports={[]} />, actions);

    await userEvent.setup().click(await screen.findByRole('button', { name: /Eintrag jetzt/ }));
    await waitFor(() => expect(actions.openEntry).toHaveBeenCalled(), { timeout: 4000 });

    expect(screen.getByRole('status')).toHaveTextContent('· 54°19,1′N 010°08,4′E');
    expect((await db.entries.toArray())[0]?.position).toMatchObject({ lat: 54.3185, lon: 10.1407 });

    improve?.({ lat: 54.32, lon: 10.15 });
    await waitFor(async () => expect((await db.entries.toArray())[0]?.position?.lat).toBe(54.32));
    // Der Eintrag erscheint in der Timeline des Tages.
    expect(await screen.findByRole('button', { name: /Eintrag \d\d:\d\d Eintrag.* öffnen/ })).toBeInTheDocument();
  });

  it('fragt „Ich bin …“ vor dem ersten Eintrag, wenn mehrere Personen und kein Autor gesetzt sind', async () => {
    mockFix({ error: 'denied' });
    const trip = await seedTrip();
    const ben = await addCrewMember(db, trip.id, { name: 'Ben' });
    await setAuthor(db, trip.id, undefined);
    const actions = makeActions();
    renderUi(<TodayScreen trip={trip} reports={[]} />, actions);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /Eintrag jetzt/ }, { timeout: 4000 }));
    const dialog = await screen.findByRole('dialog', { name: /Wer schreibt/ }, { timeout: 4000 });
    expect(await db.entries.count()).toBe(0);
    await user.click(within(dialog).getByRole('button', { name: /Ben/ }));

    await waitFor(() => expect(actions.openEntry).toHaveBeenCalled(), { timeout: 4000 });
    expect(await getAuthor(db, trip.id)).toBe(ben.id);
    expect((await db.entries.toArray())[0]?.authorId).toBe(ben.id);
  });

  it('Gründer ist automatisch Autor, ohne Rückfrage', async () => {
    mockFix({ error: 'denied' });
    const trip = await seedTrip();
    const actions = makeActions();
    renderUi(<TodayScreen trip={trip} reports={[]} />, actions);
    await userEvent.setup().click(await screen.findByRole('button', { name: /Eintrag jetzt/ }));
    await waitFor(() => expect(actions.openEntry).toHaveBeenCalled(), { timeout: 4000 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect((await db.entries.toArray())[0]?.authorId).toBe(await getAuthor(db, trip.id));
  });

  it('mit Boot gewählt: Ein-Tipp-Eintrag für dieses Boot', async () => {
    mockFix({ error: 'denied' });
    const trip = await seedTrip('F', ['Seeschwalbe', 'Möwe']);
    const [, moewe] = await seedBoats(trip.id);
    await setBoatSelection(db, trip.id, moewe!.id);
    const actions = makeActions();
    renderUi(<TodayScreen trip={trip} reports={[]} />, actions);
    await userEvent.setup().click(await screen.findByRole('button', { name: /Eintrag jetzt · Möwe/ }));
    await waitFor(() => expect(actions.openEntry).toHaveBeenCalled(), { timeout: 4000 });
    expect((await db.entries.toArray())[0]?.boatId).toBe(moewe!.id);
    expect(screen.getByRole('status')).toHaveTextContent(/gespeichert · Möwe/);
  });

  it('bei „Alle“: Pflichtauswahl des Boots, vorausgewählt das zuletzt gewählte', async () => {
    mockFix({ error: 'denied' });
    const trip = await seedTrip('F', ['Seeschwalbe', 'Möwe']);
    const [seeschwalbe, moewe] = await seedBoats(trip.id);
    await setBoatSelection(db, trip.id, 'all');
    const actions = makeActions();
    const user = userEvent.setup();
    renderUi(<TodayScreen trip={trip} reports={[]} />, actions);
    await user.click(await screen.findByRole('button', { name: /Eintrag jetzt/ }));
    let dialog = await screen.findByRole('dialog', { name: 'Neuer Eintrag' });
    // Vorschlag der eigenen Person (Gründer → erstes Boot)
    expect(within(dialog).getByRole('radio', { name: 'Seeschwalbe' })).toHaveAttribute('aria-checked', 'true');
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await setLastBoat(db, trip.id, moewe!.id);
    await user.click(screen.getByRole('button', { name: /Eintrag jetzt/ }));
    dialog = await screen.findByRole('dialog', { name: 'Neuer Eintrag' });
    await waitFor(() => expect(within(dialog).getByRole('radio', { name: 'Möwe' })).toHaveAttribute('aria-checked', 'true'));
    await user.click(within(dialog).getByRole('button', { name: 'Eintrag speichern' }));
    await waitFor(() => expect(actions.openEntry).toHaveBeenCalled(), { timeout: 4000 });
    expect((await db.entries.toArray())[0]?.boatId).toBe(moewe!.id);
    expect(seeschwalbe).toBeDefined();
  });

  it('bei „Alle“ ohne Vorauswahl: Fehlermeldung statt Speichern', async () => {
    mockFix({ error: 'denied' });
    const trip = await seedTrip('F', ['Seeschwalbe', 'Möwe']);
    await db.crewMembers.toCollection().modify({ suggestedBoatId: undefined });
    await addBoat(db, trip.id, { name: 'Dritte' });
    await setBoatSelection(db, trip.id, 'all');
    const user = userEvent.setup();
    renderUi(<TodayScreen trip={trip} reports={[]} />);
    await user.click(await screen.findByRole('button', { name: /Eintrag jetzt/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Neuer Eintrag' });
    await user.click(within(dialog).getByRole('button', { name: 'Eintrag speichern' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Bitte zuerst ein Boot wählen.');
    expect(await db.entries.count()).toBe(0);
  });

  it('zeigt keinen „Eintrag jetzt“-Button, solange die Mitgliedschaft nicht bestätigt ist', async () => {
    const trip = await seedTrip();
    const restore = await asCloudMember(trip.id);
    db.serverRealms = () => ['bob'];
    try {
      renderUi(<TodayScreen trip={trip} reports={[]} />);
      expect(await screen.findByText(/^Heute noch kein Eintrag\.$/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Eintrag jetzt/ })).not.toBeInTheDocument();
    } finally {
      restore();
      db.serverRealms = () => undefined;
    }
  });
});
