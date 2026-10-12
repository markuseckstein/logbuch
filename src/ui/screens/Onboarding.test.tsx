import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { db } from '../../db/db';
import { getSettings, listBoats, listCrew } from '../../db/repo';
import { renderUi, useCleanDb } from '../test-utils';
import type { CloudStatus } from '../../db/cloud';
import * as cloudHooks from '../cloudHooks';
import { startJoin } from '../cloud/joinState';
import { Onboarding } from './Onboarding';

vi.mock('../cloud/joinState', async (importActual) => ({
  ...(await importActual<typeof import('../cloud/joinState')>()),
  startJoin: vi.fn(),
}));
vi.mock('../cloudHooks', async (importActual) => ({
  ...(await importActual<typeof import('../cloudHooks')>()),
  useCloudStatus: vi.fn(() => 'local'),
}));
const setCloud = (status: CloudStatus): void => void vi.mocked(cloudHooks.useCloudStatus).mockReturnValue(status);

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

  it('Fehler „Name fehlt“ steht am Feld, markiert es und setzt den Fokus', async () => {
    const user = userEvent.setup();
    renderUi(<Onboarding onDone={vi.fn()} />);
    const field = await screen.findByLabelText('Name des Törns');
    await user.click(screen.getByRole('button', { name: 'Weiter' }));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Bitte gib dem Törn einen Namen.');
    expect(field.closest('label')!.parentElement).toContainElement(alert);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveFocus();
  });

  it('Fehler „Dein Name fehlt“ steht am Feld', async () => {
    const user = userEvent.setup();
    renderUi(<Onboarding onDone={vi.fn()} />);
    await user.type(await screen.findByLabelText('Name des Törns'), 'T');
    await user.click(screen.getByRole('button', { name: 'Weiter' }));
    const field = screen.getByLabelText('Dein Name');
    expect(field.closest('label')!.parentElement).toContainElement(screen.getByRole('alert'));
    expect(field).toHaveFocus();
  });

  describe('Einstieg „Eingeladen oder schon dabei?“', () => {
    it('steht oben in Schritt 1, wenn nicht angemeldet, und führt in den Beitritt', async () => {
      setCloud('signed-out');
      const user = userEvent.setup();
      renderUi(<Onboarding onDone={vi.fn()} />);
      const card = (await screen.findByText('Eingeladen oder schon dabei?')).closest('.card')!;
      const nameField = screen.getByLabelText('Name des Törns');
      expect(card.compareDocumentPosition(nameField) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Anmelden' }));
      expect(startJoin).toHaveBeenCalled();
    });

    it('fehlt im lokalen Modus und beim Anlegen weiterer Törns', async () => {
      setCloud('local');
      renderUi(<Onboarding onDone={vi.fn()} />);
      await screen.findByLabelText('Name des Törns');
      expect(screen.queryByText('Eingeladen oder schon dabei?')).not.toBeInTheDocument();
    });
  });

  describe('Schritt 3: Crew einladen (nicht angemeldet)', () => {
    async function toInviteStep(user: ReturnType<typeof userEvent.setup>, onDone = vi.fn()) {
      setCloud('signed-out');
      renderUi(<Onboarding onDone={onDone} onCancel={vi.fn()} />);
      await user.type(await screen.findByLabelText('Name des Törns'), 'Sommer');
      await user.type(screen.getByLabelText('Dein Name'), 'Jonas');
      await user.click(screen.getByRole('button', { name: 'Weiter' }));
      await user.type(screen.getByLabelText('Bootsname'), 'Möwe');
      await user.click(screen.getByRole('button', { name: 'Weiter' }));
      return onDone;
    }
    const emails = async () => (await db.crewMembers.toArray()).map((c) => c.email).filter(Boolean);

    it('erklärt: keine Mail, sondern QR-Code oder Link', async () => {
      await toInviteStep(userEvent.setup());
      expect(
        screen.getByText(/Trage die E-Mail-Adressen deiner Crew ein\. Danach teilst du einen QR-Code oder Link – es wird keine Mail verschickt\./),
      ).toBeInTheDocument();
    });

    it('„Später einladen“ nur bei leerer Liste; sonst „Törn anlegen · 1 Person vorgemerkt“', async () => {
      const user = userEvent.setup();
      await toInviteStep(user);
      expect(screen.getByRole('button', { name: 'Später einladen' })).toBeInTheDocument();
      await user.type(screen.getByLabelText('E-Mail-Adresse'), 'anna@example.com');
      expect(screen.queryByRole('button', { name: 'Später einladen' })).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Zur Liste hinzufügen' }));
      expect(screen.queryByRole('button', { name: 'Später einladen' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Törn anlegen · 1 Person vorgemerkt' })).toBeInTheDocument();
      await user.type(screen.getByLabelText('E-Mail-Adresse'), 'ben@example.com');
      await user.click(screen.getByRole('button', { name: 'Zur Liste hinzufügen' }));
      expect(screen.getByRole('button', { name: 'Törn anlegen · 2 Personen vorgemerkt' })).toBeInTheDocument();
    });

    it('vorgemerkte Personen gehen beim Anlegen nicht verloren', async () => {
      const user = userEvent.setup();
      const onDone = await toInviteStep(user);
      await user.type(screen.getByLabelText('E-Mail-Adresse'), 'anna@example.com');
      await user.click(screen.getByRole('button', { name: 'Zur Liste hinzufügen' }));
      await user.click(screen.getByRole('button', { name: /^Törn anlegen/ }));
      await waitFor(() => expect(onDone).toHaveBeenCalled());
      expect(await emails()).toEqual(['anna@example.com']);
    });

    it('eine gültige Adresse im Feld wird beim Anlegen automatisch übernommen', async () => {
      const user = userEvent.setup();
      const onDone = await toInviteStep(user);
      await user.type(screen.getByLabelText('E-Mail-Adresse'), 'Ben@Example.com');
      expect(screen.getByRole('button', { name: 'Törn anlegen · 1 Person vorgemerkt' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /^Törn anlegen/ }));
      await waitFor(() => expect(onDone).toHaveBeenCalled());
      expect(await emails()).toEqual(['ben@example.com']);
    });

    it('eine unlesbare Adresse im Feld verhindert das Anlegen und zeigt den Fehler am Feld', async () => {
      const user = userEvent.setup();
      const onDone = await toInviteStep(user);
      await user.type(screen.getByLabelText('E-Mail-Adresse'), 'ben@');
      await user.click(screen.getByRole('button', { name: /^Törn anlegen/ }));
      const field = screen.getByLabelText('E-Mail-Adresse');
      expect(field.closest('label')!.parentElement).toContainElement(screen.getByRole('alert'));
      expect(field).toHaveFocus();
      expect(onDone).not.toHaveBeenCalled();
      expect(await db.trips.count()).toBe(0);
    });

    it('„Später einladen“ legt den Törn ohne Personen an', async () => {
      const user = userEvent.setup();
      const onDone = await toInviteStep(user);
      await user.click(screen.getByRole('button', { name: 'Später einladen' }));
      await waitFor(() => expect(onDone).toHaveBeenCalled());
      expect(await emails()).toEqual([]);
    });
  });
});
