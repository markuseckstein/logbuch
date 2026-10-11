import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Cloud-Sync gegen die echte Dexie-Cloud-Datenbank (nur `npm run e2e:cloud`, braucht VITE_DEXIE_CLOUD_URL
 * und die Demo-Nutzer aus e2e/demoUsers.json). Login mit @demo.local-Adressen ohne E-Mail-Code.
 */
test.skip(!process.env['E2E_CLOUD_URL'], 'Keine Dexie-Cloud-URL konfiguriert (VITE_DEXIE_CLOUD_URL)');
test.use({ serviceWorkers: 'block' });

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const SYNC = { timeout: 45_000 };

async function phone(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    geolocation: { latitude: 54.3185, longitude: 10.1407, accuracy: 10 },
    permissions: ['geolocation'],
  });
  const page = await context.newPage();
  // Diagnose: vom Server abgelehnte Änderungen (werden lokal zurückgerollt) im Testlog zeigen
  page.on('response', async (r) => {
    if (!r.url().endsWith('/sync')) return;
    try {
      const m = /"rejections":\[(.+?)\],"dbId"/s.exec(await r.text());
      if (m?.[1]) console.warn('Sync-Ablehnung:', m[1].slice(0, 400));
    } catch {
      // Antwort nicht lesbar
    }
  });
  await page.route('https://tile.openstreetmap.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG }),
  );
  return page;
}

const tab = (page: Page, name: string) => page.getByRole('navigation').getByRole('button', { name, exact: true });
const syncCard = (page: Page) => page.getByRole('region', { name: 'Synchronisation' });

async function signIn(page: Page, email: string, from: 'card' | 'onboarding'): Promise<void> {
  if (from === 'card') await syncCard(page).getByRole('button', { name: 'Anmelden' }).click();
  else await page.getByRole('button', { name: 'Mit Cloud-Konto anmelden' }).click();
  const dlg = page.getByRole('dialog', { name: 'Mit Cloud-Konto anmelden' });
  await dlg.getByLabel('E-Mail-Adresse').fill(email);
  await dlg.getByRole('button', { name: 'Code anfordern' }).click();
}

async function acceptInvite(page: Page, boat: string): Promise<void> {
  const banner = page.getByRole('region', { name: 'Einladung' }).filter({ hasText: boat });
  await expect(banner).toBeVisible(SYNC);
  await expect(banner).toContainText(`lädt dich in das Logbuch der ${boat} ein`);
  await banner.getByRole('button', { name: 'Annehmen' }).click();
}

async function entryWithText(page: Page, text: string, photo = false): Promise<void> {
  await page.getByRole('button', { name: /Eintrag jetzt/ }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  if (photo) {
    await sheet.getByLabel('Galerie').setInputFiles(['e2e/fixtures/photo-1.png']);
    await expect(sheet.getByText('1 / 5')).toBeVisible();
  }
  await sheet.getByLabel('Text').fill(text);
  await sheet.getByRole('button', { name: 'Speichern' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.locator('.tl-item', { hasText: text })).toBeVisible();
}

test('Cloud: Skipper teilt, Crew schreibt mit, anderes Boot liest nur, Foto kommt an', async ({ browser }) => {
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const boat = `Seeschwalbe ${run}`;
  const trip = `Cloud-Törn ${run}`;

  // --- Alice (Skipper, Boot 1)
  const alice = await phone(browser);
  await alice.goto('/');
  await alice.getByLabel('Name des Törns').fill(trip);
  await alice.getByRole('button', { name: 'Weiter' }).click();
  await alice.getByLabel('Bootsname').fill(boat);
  await alice.getByRole('button', { name: 'Weiter' }).click();
  for (const name of ['Alice', 'Bob']) {
    await alice.getByLabel('Name', { exact: true }).fill(name);
    await alice.getByRole('button', { name: 'Crew hinzufügen' }).click();
  }
  await alice.getByRole('button', { name: 'Törn anlegen' }).click();
  await expect(alice.locator('.brand span')).toContainText(trip);
  await alice.getByRole('button', { name: /Eintrag jetzt/ }).click();
  await alice.getByRole('dialog').getByLabel('Galerie').setInputFiles(['e2e/fixtures/photo-1.png']);
  await alice.getByRole('dialog').getByLabel('Text').fill('Ablegen in Kiel');
  await alice.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(alice.locator('.tl-item', { hasText: 'Ablegen in Kiel' })).toBeVisible();

  await tab(alice, 'Törn').click();
  await signIn(alice, 'alice@demo.local', 'card');
  await expect(syncCard(alice)).toContainText('Angemeldet als alice@demo.local', SYNC);
  await syncCard(alice).getByRole('button', { name: 'Logbuch in die Cloud bringen' }).click();
  const members = syncCard(alice).getByRole('list', { name: 'Mitglieder' });
  await syncCard(alice).getByLabel('E-Mail einladen').fill('bob@demo.local');
  await syncCard(alice).getByLabel('Name (optional)').fill('Bob');
  await syncCard(alice).getByRole('button', { name: 'Als Crew einladen (schreibt mit)' }).click();
  await expect(members).toContainText('bob@demo.local');
  await expect(syncCard(alice).getByLabel('E-Mail einladen')).toHaveValue('');
  await syncCard(alice).getByLabel('E-Mail einladen').fill('carol@demo.local');
  await syncCard(alice).getByRole('button', { name: 'Anderes Boot einladen (nur lesen)' }).click();
  await expect(members).toContainText('Crew (schreibt mit)');
  await expect(members).toContainText('Anderes Boot (nur lesen)');
  await expect(members.getByText('eingeladen')).toHaveCount(2);
  await expect(alice.getByRole('img', { name: 'Cloud: synchronisiert' })).toBeVisible(SYNC);

  let failed = true;
  try {
    // --- Bob (Crew, gleiches Boot): leeres Handy, Anmeldung aus dem Onboarding
    const bob = await phone(browser);
    await bob.goto('/');
    await signIn(bob, 'bob@demo.local', 'onboarding');
    await acceptInvite(bob, boat);
    const who = bob.getByRole('dialog', { name: 'Wer schreibt auf diesem Gerät?' });
    await expect(who).toBeVisible(SYNC);
    await who.getByRole('button', { name: /Bob/ }).click();
    await expect(bob.locator('.brand span')).toContainText(trip);
    await expect(bob.locator('.tl-item', { hasText: 'Ablegen in Kiel' })).toBeVisible(SYNC);
    // Foto (Blob-Offloading) kommt an
    await bob.locator('.tl-item', { hasText: 'Ablegen in Kiel' }).click();
    const img = bob.getByRole('dialog').locator('img').first();
    await expect(img).toBeVisible(SYNC);
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth), SYNC).toBeGreaterThan(0);
    await bob.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
    await entryWithText(bob, 'Bob übernimmt das Ruder');

    // Alice sieht Bobs Eintrag nach dem Sync
    await tab(alice, 'Heute').click();
    await expect(alice.locator('.tl-item', { hasText: 'Bob übernimmt das Ruder' })).toBeVisible(SYNC);

    // --- Carol (anderes Boot, nur lesen)
    const carol = await phone(browser);
    await carol.goto('/');
    await signIn(carol, 'carol@demo.local', 'onboarding');
    await acceptInvite(carol, boat);
    await expect(carol.getByText(`Logbuch der ${boat} · nur lesen`)).toBeVisible(SYNC);
    await expect(carol.locator('.tl-item', { hasText: 'Bob übernimmt das Ruder' })).toBeVisible(SYNC);
    await expect(carol.getByRole('button', { name: /Eintrag jetzt/ })).toHaveCount(0);
    await carol.locator('.tl-item', { hasText: 'Ablegen in Kiel' }).click();
    await expect(carol.getByRole('dialog').getByRole('button', { name: 'Speichern' })).toHaveCount(0);
    await carol.getByRole('dialog').getByRole('button', { name: 'Fertig' }).click();
    await tab(carol, 'Törn').click();
    await expect(carol.getByLabel('Name des Törns')).toBeDisabled();

    // Mitgliederliste beim Skipper: beide angenommen
    await tab(alice, 'Törn').click();
    await expect(members.getByText('angenommen')).toHaveCount(3, SYNC);
    failed = false;
  } finally {
    if (process.env['E2E_KEEP'] && failed) {
      console.warn('KEEP realm of', boat);
      return;
    }
    // Aufräumen (best effort, verdeckt keinen Testfehler): Logbuch für alle löschen (Realm samt Mitgliedern)
    try {
      await tab(alice, 'Törn').click({ timeout: 5000 });
      await alice.getByRole('button', { name: 'Logbuch für alle löschen' }).click({ timeout: 5000 });
      await alice.getByRole('dialog').getByRole('button', { name: 'Für alle löschen' }).click({ timeout: 5000 });
      await expect(alice.locator('.toast')).toContainText('für alle gelöscht', { timeout: 5000 });
      await alice.waitForTimeout(3000); // Löschung hochladen
    } catch {
      console.warn(`Aufräumen fehlgeschlagen – Realm von „${boat}“ ggf. per CLI löschen (dexie-cloud clear-realm)`);
    }
  }
});
