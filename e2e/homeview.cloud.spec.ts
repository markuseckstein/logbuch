import { execFileSync } from 'node:child_process';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { onboard } from './helpers';

/**
 * Daheim-Link gegen die echte Dexie-Cloud (nur `npm run e2e:cloud`): Alice (Admin) erstellt den Link, das
 * Demo-Konto wird per `scripts/create-viewer.mjs` freigeschaltet (wie es der Admin einmalig tut), ein frisches
 * Gerät öffnet ihn ohne Anmeldung, sieht den Törn live; nach „Link erneuern“ ist der alte Link ungültig; „Zur
 * Crew-Anmeldung“ führt zurück in die normale App.
 * Aufräumen: Törn für alle löschen, die hier angelegten Zuschauer-Konten wieder löschen (nur diese).
 */
test.skip(!process.env['E2E_CLOUD_URL'], 'Keine Dexie-Cloud-URL konfiguriert (VITE_DEXIE_CLOUD_URL)');
test.use({ serviceWorkers: 'block' });

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const SYNC = { timeout: 45_000 };
const INVALID = 'Dieser Link funktioniert gerade nicht. Vielleicht ist er noch nicht freigeschaltet oder wurde erneuert – frag die Crew.';

async function phone(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ geolocation: { latitude: 54.3185, longitude: 10.1407, accuracy: 10 }, permissions: ['geolocation'] });
  const page = await context.newPage();
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  return page;
}

const tab = (page: Page, name: string) => page.getByRole('navigation').getByRole('button', { name, exact: true });
const card = (page: Page) => page.getByRole('region', { name: 'Daheim-Link' });

function viewerScript(args: string[]): void {
  execFileSync('node', ['scripts/create-viewer.mjs', ...args], { stdio: 'pipe' });
}

/** Link aus der Admin-Karte lesen. */
async function readLink(admin: Page): Promise<string> {
  const link = (await card(admin).getByTestId('home-link').textContent()) ?? '';
  expect(link).toMatch(/#daheim=[a-z2-7]{26}$/);
  return link;
}

/** Konto aus dem Freischalt-Hinweis lesen und freischalten (einmaliger CLI-Schritt des Admins). */
async function unlock(admin: Page, created: string[]): Promise<void> {
  const cmd = (await card(admin).getByTestId('home-unlock').textContent()) ?? '';
  const email = /daheim-[a-z2-7]{26}@demo\.local/.exec(cmd)?.[0];
  expect(email).toBeTruthy();
  viewerScript([email!]);
  created.push(email!);
}

async function readAndUnlock(admin: Page, created: string[]): Promise<string> {
  const link = await readLink(admin);
  await unlock(admin, created);
  return link;
}

async function addEntry(page: Page, text: string): Promise<void> {
  await tab(page, 'Heute').click();
  await page.getByRole('button', { name: /^Eintrag jetzt/ }).click(SYNC);
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Text').fill(text);
  await sheet.getByRole('button', { name: 'Speichern' }).click();
  await expect(sheet).toBeHidden();
}

test('Cloud: Daheim-Link – Zuschauer ohne Anmeldung sieht den Törn live, erneuerter Link macht den alten ungültig', async ({ browser }) => {
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const trip = `Daheim-Törn ${run}`;
  const created: string[] = [];

  const alice = await phone(browser);
  await onboard(alice, { trip, boats: [`Seeschwalbe ${run}`], founder: 'Alice' });
  await alice.getByRole('button', { name: /^Eintrag jetzt/ }).click();
  await alice.getByRole('dialog').getByLabel('Galerie').setInputFiles(['e2e/fixtures/photo-1.png']);
  await expect(alice.getByRole('dialog').getByText('1 / 5')).toBeVisible();
  await alice.getByRole('dialog').getByLabel('Text').fill('Ablegen in Kiel');
  await alice.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();

  await tab(alice, 'Törn').click();
  await alice.getByRole('region', { name: 'Konto' }).getByRole('button', { name: 'Anmelden' }).click();
  const dlg = alice.getByRole('dialog', { name: 'Mit E-Mail anmelden' });
  await dlg.getByLabel('E-Mail-Adresse').fill('alice@demo.local');
  await dlg.getByRole('button', { name: 'Code anfordern' }).click();
  await expect(alice.getByRole('region', { name: 'Konto' })).toContainText('Angemeldet als alice@demo.local', SYNC);

  let failed = true;
  try {
    await card(alice).getByRole('button', { name: 'Daheim-Link erstellen' }).click();
    await expect(card(alice).getByRole('img', { name: /QR-Code Daheim-Link/ })).toBeVisible();
    await expect(card(alice).getByText(/Noch nicht freigeschaltet/)).toBeVisible();
    // kein Personeneintrag für den Zuschauer
    await expect(alice.getByRole('list', { name: 'Personen' })).not.toContainText('Daheim');
    const link = await readLink(alice);
    await expect(alice.getByRole('img', { name: 'Alles übertragen' })).toBeVisible(SYNC);

    // --- Oma: frisches Gerät, Link öffnen – keine Eingabe. Noch nicht freigeschaltet: Hinweis + „Erneut versuchen“
    const oma = await phone(browser);
    await oma.goto(link);
    await expect(oma.getByText(INVALID)).toBeVisible(SYNC);
    await expect(oma.getByRole('dialog')).toHaveCount(0); // kein technischer Addon-Dialog
    await unlock(alice, created);
    await oma.getByRole('button', { name: 'Erneut versuchen' }).click();
    await expect(oma.getByRole('heading', { name: trip, level: 1 })).toBeVisible(SYNC);
    expect(oma.url()).not.toContain('daheim=');
    await expect(oma.getByText('Ablegen in Kiel')).toBeVisible(SYNC);
    await expect(oma.getByText(/^Zuletzt aktualisiert/)).toBeVisible();
    await expect(oma.getByRole('group', { name: 'Karte aller Boote' })).toBeVisible();
    await expect(oma.getByRole('navigation')).toHaveCount(0);
    for (const name of [/Eintrag jetzt/, /Bearbeiten/, /Speichern/, /Export/, /einladen/i, /Anmelden/]) {
      await expect(oma.getByRole('button', { name })).toHaveCount(0);
    }
    // Foto antippen = groß (Originalbild per Blob-Sync)
    await oma.getByRole('button', { name: 'Foto 1 groß anzeigen' }).click(SYNC);
    const viewer = oma.getByRole('dialog', { name: 'Foto 1 / 1' });
    await expect(viewer).toContainText('Alice');
    await expect.poll(() => viewer.locator('img').evaluate((el) => (el as HTMLImageElement).naturalWidth), SYNC).toBeGreaterThan(0);
    await viewer.getByRole('button', { name: 'Foto schließen' }).click();
    await expect(viewer).toBeHidden();

    // Admin sieht: geöffnet
    await expect(card(alice).getByText('geöffnet')).toBeVisible(SYNC);

    // --- live: Alice schreibt, Oma sieht es ohne Neuladen
    await addEntry(alice, `Live aus der Förde ${run}`);
    await expect(oma.getByText(`Live aus der Förde ${run}`)).toBeVisible(SYNC);

    // --- anderes, echtes Konto in diesem Browser: erst fragen, Abbrechen behält die Anmeldung
    await alice.goto(link);
    await expect(alice.getByText('Du bist angemeldet als alice@demo.local. Die Daheim-Ansicht in diesem Browser öffnen meldet dich ab.')).toBeVisible();
    await alice.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(alice.locator('.brand span')).toContainText(trip, SYNC);
    await tab(alice, 'Törn').click();
    await expect(alice.getByRole('region', { name: 'Konto' })).toContainText('alice@demo.local');

    // --- Link erneuern: der alte zeigt „nicht mehr gültig“, der neue funktioniert
    await card(alice).getByRole('button', { name: 'Link erneuern' }).click();
    await card(alice).getByRole('button', { name: 'Neuen Link erstellen' }).click();
    await expect(card(alice).getByTestId('home-link')).not.toHaveText(link, SYNC);
    const link2 = await readAndUnlock(alice, created);
    expect(link2).not.toBe(link);
    await expect(oma.getByText(INVALID)).toBeVisible(SYNC);

    const stale = await phone(browser);
    await stale.goto(link);
    await expect(stale.getByText(INVALID)).toBeVisible(SYNC);

    const oma2 = await phone(browser);
    await oma2.goto(link2);
    await expect(oma2.getByRole('heading', { name: trip, level: 1 })).toBeVisible(SYNC);
    await expect(oma2.getByText(`Live aus der Förde ${run}`)).toBeVisible(SYNC);

    // --- Crew hat den Link aus Versehen geöffnet: Ausgang zur normalen Anmeldung, bleibt auch nach Neuladen draußen
    await oma2.getByRole('button', { name: 'Zur Crew-Anmeldung' }).click();
    await oma2.getByRole('dialog', { name: 'Daheim-Ansicht verlassen?' }).getByRole('button', { name: 'Verlassen' }).click();
    await expect(oma2.getByText('Eingeladen oder schon dabei?')).toBeVisible(SYNC);
    await oma2.reload();
    await expect(oma2.getByText('Eingeladen oder schon dabei?')).toBeVisible(SYNC);
    await expect(oma2.getByRole('heading', { name: trip, level: 1 })).toHaveCount(0);
    failed = false;
  } finally {
    if (process.env['E2E_KEEP'] && failed) {
      console.warn('KEEP realm of', trip, created);
    } else {
      try {
        await tab(alice, 'Törn').click({ timeout: 5000 });
        await alice.getByRole('button', { name: 'Törn für alle löschen' }).click({ timeout: 5000 });
        await alice.getByRole('dialog').getByRole('button', { name: 'Für alle löschen' }).click({ timeout: 5000 });
        await expect(alice.locator('.toast')).toContainText('für alle gelöscht', { timeout: 5000 });
        await alice.waitForTimeout(3000);
      } catch {
        console.warn(`Aufräumen fehlgeschlagen – Realm von „${trip}“ bleibt stehen`);
      }
      // nur die in diesem Lauf angelegten Zuschauer-Konten löschen
      for (const email of created) {
        try {
          viewerScript(['--delete', email]);
        } catch {
          console.warn(`Zuschauer-Konto ${email} konnte nicht gelöscht werden`);
        }
      }
    }
  }
});
