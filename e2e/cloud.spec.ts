import { expect, test, type Browser, type Page } from '@playwright/test';
import { onboard } from './helpers';

/**
 * Cloud-Sync gegen die echte Dexie-Cloud-Datenbank (nur `npm run e2e:cloud`, braucht VITE_DEXIE_CLOUD_URL
 * und die Demo-Nutzer aus e2e/demoUsers.json). Login mit @demo.local-Adressen ohne E-Mail-Code.
 * Törn-Modell v2: Alice (Admin) legt einen Törn mit zwei Booten an und trägt Bob und Carol mit Boot-Vorschlag ein, Bob und Carol treten über den Join-Link (QR) bei.
 */
test.skip(!process.env['E2E_CLOUD_URL'], 'Keine Dexie-Cloud-URL konfiguriert (VITE_DEXIE_CLOUD_URL)');
test.use({ serviceWorkers: 'block' });

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const SYNC = { timeout: 45_000 };

async function phone(browser: Browser, at = { latitude: 54.3185, longitude: 10.1407 }): Promise<Page> {
  const context = await browser.newContext({ geolocation: { ...at, accuracy: 10 }, permissions: ['geolocation'] });
  const page = await context.newPage();
  // Diagnose: vom Server abgelehnte Änderungen (werden lokal gesichert und erneut gesendet) im Testlog zeigen
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
const account = (page: Page) => page.getByRole('region', { name: 'Konto' });
const boatSwitch = (page: Page) => page.getByRole('radiogroup', { name: 'Boot wählen' });
const people = (page: Page) => page.getByRole('list', { name: 'Personen' });

async function signIn(page: Page, email: string, from: 'account' | 'join'): Promise<void> {
  if (from === 'account') await account(page).getByRole('button', { name: 'Anmelden' }).click();
  else await page.getByRole('main').getByRole('button', { name: 'Anmelden' }).click();
  const dlg = page.getByRole('dialog', { name: 'Mit E-Mail anmelden' });
  await dlg.getByLabel('E-Mail-Adresse').fill(email);
  await dlg.getByRole('button', { name: 'Code anfordern' }).click();
}

/** Admin: QR-Sheet öffnen, QR und Link prüfen, Link zurückgeben. */
async function joinLink(page: Page): Promise<string> {
  await page.getByRole('region', { name: 'Person einladen' }).getByRole('button', { name: 'QR-Code zum Beitreten' }).click();
  const sheet = page.getByRole('dialog', { name: 'Zum Törn einladen' });
  await expect(sheet.getByRole('img', { name: /QR-Code zum Beitreten/ })).toBeVisible();
  const link = (await sheet.getByTestId('join-link').textContent()) ?? '';
  expect(link).toContain('join=');
  await expect(sheet.getByText('Noch niemand eingetragen')).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Schließen' }).click();
  await expect(sheet).toBeHidden();
  return link;
}

/** Eingeladene: Link öffnen, Beitreten-Bildschirm, anmelden – ohne „Annehmen“ landen sie im Törn. */
async function joinViaLink(page: Page, link: string, email: string): Promise<void> {
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Du wurdest zu einem Törn eingeladen' })).toBeVisible();
  expect(page.url()).not.toContain('join=');
  await signIn(page, email, 'join');
}

async function invite(page: Page, email: string, boat: string): Promise<void> {
  const card = page.getByRole('region', { name: 'Person einladen' });
  await card.getByLabel('E-Mail-Adresse').fill(email);
  await card.getByRole('radio', { name: boat }).click();
  await card.getByRole('button', { name: 'Person eintragen' }).click();
  await expect(card.getByLabel('E-Mail-Adresse')).toHaveValue('');
}

/** Ein-Tipp-Eintrag für das gewählte Boot, Text ergänzen. */
async function entryWithText(page: Page, boat: string, text: string): Promise<void> {
  await page.getByRole('button', { name: `Eintrag jetzt · ${boat}` }).click(SYNC);
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await sheet.getByLabel('Text').fill(text);
  await sheet.getByRole('button', { name: 'Speichern' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.locator('.tl-item', { hasText: text })).toBeVisible();
}

test('Cloud: Admin legt 2 Boote an, lädt 2 Personen mit Boot-Vorschlag ein, beide schreiben, fremde Einträge nur ansehen, Foto kommt an', async ({ browser }) => {
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const trip = `Cloud-Törn ${run}`;
  const [b1, b2] = [`Seeschwalbe ${run}`, `Möwe ${run}`];

  // --- Alice (Admin): Törn lokal mit zwei Booten, erster Eintrag mit Foto, dann Anmeldung
  const alice = await phone(browser);
  await onboard(alice, { trip, boats: [b1, b2], founder: 'Alice' });
  await alice.getByRole('button', { name: `Eintrag jetzt · ${b1}` }).click();
  await alice.getByRole('dialog').getByLabel('Galerie').setInputFiles(['e2e/fixtures/photo-1.png']);
  await expect(alice.getByRole('dialog').getByText('1 / 5')).toBeVisible();
  await alice.getByRole('dialog').getByLabel('Text').fill('Ablegen in Kiel');
  await alice.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(alice.locator('.tl-item', { hasText: 'Ablegen in Kiel' })).toBeVisible();

  await tab(alice, 'Törn').click();
  await signIn(alice, 'alice@demo.local', 'account');
  await expect(account(alice)).toContainText('Angemeldet als alice@demo.local', SYNC);
  await expect(account(alice).getByText('Admin')).toBeVisible();
  await invite(alice, 'bob@demo.local', b1);
  await invite(alice, 'carol@demo.local', b2);
  await expect(people(alice)).toContainText('bob@demo.local · Vorschlag: ' + b1);
  await expect(people(alice)).toContainText('carol@demo.local · Vorschlag: ' + b2);
  await expect(people(alice).getByText('eingeladen')).toHaveCount(2, SYNC);
  const link = await joinLink(alice);
  await expect(alice.getByRole('img', { name: 'Alles übertragen' })).toBeVisible(SYNC);

  let failed = true;
  try {
    // --- Bob: leeres Handy, öffnet den Beitritts-Link, meldet sich an – kein Annehmen-Klick
    const bob = await phone(browser);
    await joinViaLink(bob, link, 'bob@demo.local');
    await expect(bob.locator('.brand span')).toContainText(trip, SYNC);
    // Boot-Schalter steht auf dem vorgeschlagenen Boot
    await expect(boatSwitch(bob).getByRole('radio', { name: b1 })).toHaveAttribute('aria-checked', 'true', SYNC);
    await expect(bob.locator('.tl-item', { hasText: 'Ablegen in Kiel' })).toBeVisible(SYNC);
    // Alices Eintrag: nur ansehen, Foto (Blob-Offloading) kommt an
    await bob.locator('.tl-item', { hasText: 'Ablegen in Kiel' }).click();
    const view = bob.getByRole('dialog');
    await expect(view.getByRole('note')).toContainText('Nur ansehen');
    await expect(view.getByRole('note')).toContainText(`Eintrag von Alice · ${b1}`);
    await expect(view.getByRole('button', { name: 'Speichern' })).toHaveCount(0);
    const img = view.locator('img').first();
    await expect(img).toBeVisible(SYNC);
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth), SYNC).toBeGreaterThan(0);
    await view.getByRole('button', { name: 'Fertig' }).click();
    await entryWithText(bob, b1, 'Bob übernimmt das Ruder');
    // Mitglied: kein Einladen, kein Boot anlegen
    await tab(bob, 'Törn').click();
    await expect(bob.getByText('Nur der Admin lädt Personen ein und legt Boote an.')).toBeVisible();
    await expect(bob.getByRole('region', { name: 'Person einladen' })).toHaveCount(0);

    // --- Carol: anderes Boot vorgeschlagen
    const carol = await phone(browser, { latitude: 54.42, longitude: 10.25 });
    await joinViaLink(carol, link, 'carol@demo.local');
    await expect(carol.locator('.brand span')).toContainText(trip, SYNC);
    await expect(boatSwitch(carol).getByRole('radio', { name: b2 })).toHaveAttribute('aria-checked', 'true', SYNC);
    await entryWithText(carol, b2, 'Carol auf der Möwe');

    // Bob sieht Carols Eintrag (bei „Alle“), kann ihn aber nicht ändern
    await tab(bob, 'Heute').click();
    await boatSwitch(bob).getByRole('radio', { name: 'Alle' }).click();
    await expect(bob.locator('.tl-item', { hasText: 'Carol auf der Möwe' })).toBeVisible(SYNC);
    await bob.locator('.tl-item', { hasText: 'Carol auf der Möwe' }).click();
    await expect(bob.getByRole('dialog').getByRole('note')).toContainText(`Nur ansehen`);
    await expect(bob.getByRole('dialog').getByRole('button', { name: 'Löschen' })).toHaveCount(0);
    await bob.getByRole('dialog').getByRole('button', { name: 'Fertig' }).click();

    // Alice (Admin) sieht beide, darf fremde Einträge bearbeiten; Mitgliederliste: alle dabei
    await tab(alice, 'Heute').click();
    await boatSwitch(alice).getByRole('radio', { name: 'Alle' }).click();
    await expect(alice.locator('.tl-item', { hasText: 'Bob übernimmt das Ruder' })).toBeVisible(SYNC);
    await expect(alice.locator('.tl-item', { hasText: 'Carol auf der Möwe' })).toBeVisible(SYNC);
    await alice.locator('.tl-item', { hasText: 'Carol auf der Möwe' }).click();
    await expect(alice.getByRole('dialog').getByRole('note')).toContainText('Admin-Bearbeitung');
    await alice.getByRole('dialog').getByRole('button', { name: 'Schließen' }).click();
    await tab(alice, 'Törn').click();
    await expect(people(alice).getByText('dabei')).toHaveCount(3, SYNC);

    // --- Bob meldet sich später mit leerem Speicher wieder an (Websitedaten gelöscht): Mitgliedschaft besteht, keine offene Einladung
    // (a) über seinen persönlichen QR-Link, E-Mail vorausgefüllt
    await tab(alice, 'Törn').click();
    const bobRow = people(alice).getByRole('listitem').filter({ hasText: 'bob@demo.local' });
    await bobRow.getByRole('button', { name: /^QR-Code für/ }).click();
    const personal = alice.getByRole('dialog', { name: /^QR-Code für/ });
    await expect(personal.getByText('scannt den Code und meldet sich an – die E-Mail ist schon eingetragen')).toBeVisible();
    const personalLink = (await personal.getByTestId('join-link').textContent()) ?? '';
    expect(personalLink).toContain('email=bob%40demo.local');
    await personal.getByRole('button', { name: 'Schließen' }).click();

    const bob2 = await phone(browser);
    await bob2.goto(personalLink);
    await expect(bob2.getByRole('heading', { name: 'Du wurdest zu einem Törn eingeladen' })).toBeVisible();
    expect(bob2.url()).not.toContain('email=');
    await bob2.getByRole('main').getByRole('button', { name: 'Anmelden' }).click();
    const dlg = bob2.getByRole('dialog', { name: 'Mit E-Mail anmelden' });
    await expect(dlg.getByLabel('E-Mail-Adresse')).toHaveValue('bob@demo.local');
    await dlg.getByRole('button', { name: 'Code anfordern' }).click();
    await expect(bob2.locator('.brand span')).toContainText(trip, SYNC);
    await expect(bob2.locator('.tl-item', { hasText: 'Ablegen in Kiel' })).toBeVisible(SYNC);
    await expect(bob2.getByText('Keine Einladung gefunden')).toHaveCount(0);

    // (b) ohne Link: Onboarding „Eingeladen oder schon dabei? [Anmelden]“
    const bob3 = await phone(browser);
    await bob3.goto('/');
    await bob3.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await signIn(bob3, 'bob@demo.local', 'join');
    await expect(bob3.locator('.brand span')).toContainText(trip, SYNC);
    await expect(boatSwitch(bob3).getByRole('radio', { name: b1 })).toHaveAttribute('aria-checked', 'true', SYNC);
    await expect(bob3.locator('.tl-item', { hasText: 'Ablegen in Kiel' })).toBeVisible(SYNC);
    await expect(bob3.getByText('Keine Einladung gefunden')).toHaveCount(0);

    // (c) Dave ist nirgends eingetragen: „Keine Einladung gefunden“
    const dave = await phone(browser);
    await dave.goto('/');
    await dave.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await signIn(dave, 'dave@demo.local', 'join');
    await expect(dave.getByRole('heading', { name: 'Keine Einladung gefunden' })).toBeVisible(SYNC);
    failed = false;
  } finally {
    if (process.env['E2E_KEEP'] && failed) {
      console.warn('KEEP realm of', trip);
      return;
    }
    // Aufräumen (best effort, verdeckt keinen Testfehler): Törn für alle löschen (Realm samt Mitgliedern)
    try {
      await tab(alice, 'Törn').click({ timeout: 5000 });
      await alice.getByRole('button', { name: 'Törn für alle löschen' }).click({ timeout: 5000 });
      await alice.getByRole('dialog').getByRole('button', { name: 'Für alle löschen' }).click({ timeout: 5000 });
      await expect(alice.locator('.toast')).toContainText('für alle gelöscht', { timeout: 5000 });
      await alice.waitForTimeout(3000); // Löschung hochladen
    } catch {
      console.warn(`Aufräumen fehlgeschlagen – Realm von „${trip}“ bleibt stehen`);
    }
  }
});
