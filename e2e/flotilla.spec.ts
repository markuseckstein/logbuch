import { expect, test, type Browser, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

// 1x1 transparent PNG – die Tests dürfen nicht vom Tile-Server abhängen.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** Ein „Handy“: eigener Browser-Kontext mit eigener IndexedDB und GPS. */
async function phone(browser: Browser, position = { latitude: 54.3185, longitude: 10.1407 }): Promise<Page> {
  const context = await browser.newContext({
    geolocation: { ...position, accuracy: 10 },
    permissions: ['geolocation'],
  });
  const page = await context.newPage();
  await page.route('https://tile.openstreetmap.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG }),
  );
  return page;
}

async function onboard(page: Page, trip: string, boat: string, crew: string[]): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Name des Törns').fill(trip);
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByLabel('Bootsname').fill(boat);
  await page.getByRole('button', { name: 'Weiter' }).click();
  for (const name of crew) {
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Crew hinzufügen' }).click();
  }
  await page.getByRole('button', { name: 'Törn anlegen' }).click();
  await expect(page.locator('.brand span')).toContainText(trip);
}

const tab = (page: Page, name: string) => page.getByRole('navigation').getByRole('button', { name, exact: true });

async function entryWithText(page: Page, text: string): Promise<void> {
  await page.getByRole('button', { name: /Eintrag jetzt/ }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await sheet.getByLabel('Text').fill(text);
  await sheet.getByRole('button', { name: 'Speichern' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.locator('.tl-item', { hasText: text })).toBeVisible();
}

async function shareZip(page: Page, choice: 'Mit Fotos' | 'Ohne Fotos (klein)', path: string): Promise<void> {
  await tab(page, 'Törn').click();
  await page.getByRole('button', { name: 'Logbuch teilen' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: choice }).click();
  await (await download).saveAs(path);
}

async function chooseFile(page: Page, path: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Logbuch importieren' }).click();
  await (await chooser).setFiles(path);
}

test('Drei Handys: Teilen, Mitschreiben, Zusammenführen, Flottille und Nur-Lesen', async ({ browser }, testInfo) => {
  const aZip = testInfo.outputPath('a.zip');
  const bZip = testInfo.outputPath('b.zip');

  // --- Handy A: Törn gründen, Flottille, zwei Einträge, teilen ---
  const a = await phone(browser);
  await onboard(a, 'Flottentörn', 'Seeschwalbe', ['Anna', 'Ben']);
  await tab(a, 'Törn').click();
  await expect(a.getByRole('radio', { name: 'Anna' })).toHaveAttribute('aria-checked', 'true'); // Gründer = Autor
  await a.getByLabel('Name der Flottille').fill('Sommerflotte');
  await a.getByRole('button', { name: 'Flottille gründen' }).click();
  await expect(a.getByRole('list', { name: 'Boote der Flottille' })).toContainText('eigenes Boot');
  await tab(a, 'Heute').click();
  await entryWithText(a, 'Leinen los');
  await entryWithText(a, 'Segel hoch');
  await shareZip(a, 'Mit Fotos', aZip);

  // --- Handy B: als „Mein Boot“ importieren, Ich bin Ben, Eintrag, einen von A löschen, teilen ---
  const b = await phone(browser, { latitude: 54.33, longitude: 10.15 });
  await b.goto('/');
  await chooseFile(b, aZip);
  await b.getByRole('button', { name: 'Mein Boot – ich schreibe mit' }).click();
  await b.getByRole('dialog', { name: /Wer schreibt/ }).getByRole('button', { name: /^Ben/ }).click();
  await expect(b.locator('.brand span')).toContainText('Flottentörn');
  await expect(b.locator('.banner')).toHaveCount(0); // eigenes Logbuch
  await expect(b.locator('.tl-item')).toHaveCount(2);
  await entryWithText(b, 'Anker auf');
  await expect(b.locator('.tl-item', { hasText: 'Anker auf' })).toContainText('B'); // Initialen-Badge
  await b.locator('.tl-item', { hasText: 'Leinen los' }).click();
  await b.getByRole('dialog').getByRole('button', { name: 'Löschen' }).click();
  await b.getByRole('button', { name: 'Endgültig löschen' }).click();
  await expect(b.locator('.tl-item', { hasText: 'Leinen los' })).toHaveCount(0);
  await shareZip(b, 'Ohne Fotos (klein)', bZip);

  // --- Handy A importiert B: bekanntes Logbuch, still gemergt ---
  await a.bringToFront();
  await tab(a, 'Törn').click();
  await chooseFile(a, bZip);
  await expect(a.locator('.toast')).toContainText('Logbuch Seeschwalbe: 1 neu');
  await expect(a.locator('.toast')).toContainText('1 gelöscht');
  await tab(a, 'Heute').click();
  await expect(a.locator('.tl-item')).toHaveCount(2);
  await expect(a.locator('.tl-item', { hasText: 'Segel hoch' })).toBeVisible();
  await expect(a.locator('.tl-item', { hasText: 'Anker auf' })).toBeVisible();
  await expect(a.locator('.tl-item', { hasText: 'Leinen los' })).toHaveCount(0);

  // --- Handy C: anderes Boot, importiert A nur lesend und tritt der Flottille bei ---
  const c = await phone(browser, { latitude: 54.5, longitude: 10.3 });
  await onboard(c, 'Eigener Törn', 'Möwe', []);
  await tab(c, 'Törn').click();
  await chooseFile(c, aZip);
  await c.getByRole('button', { name: 'Anderes Boot – nur lesen' }).click();
  const offer = c.getByRole('dialog', { name: /Flottille „Sommerflotte“ beitreten/ });
  await offer.getByRole('button', { name: 'Beitreten' }).click();
  await expect(c.getByRole('list', { name: 'Boote der Flottille' })).toContainText('Seeschwalbe');

  // zu As Logbuch wechseln: Banner, kein Eintrag-Button, Törn-Tab gesperrt
  await c.getByRole('button', { name: /^Zu Logbuch „Seeschwalbe“ wechseln/ }).click();
  await expect(c.getByText('Logbuch der Seeschwalbe · nur lesen')).toBeVisible();
  await tab(c, 'Heute').click();
  await expect(c.getByRole('button', { name: /Eintrag jetzt/ })).toHaveCount(0);
  await expect(c.locator('.tl-item', { hasText: 'Segel hoch' })).toBeVisible(); // Zeit stammt von A (heute)
  await c.locator('.tl-item', { hasText: 'Segel hoch' }).click();
  // Erst auf das offene Sheet warten – sonst ist „kein Löschen-Button“ trivial wahr und Escape kommt zu früh.
  await expect(c.getByRole('dialog').getByRole('button', { name: 'Fertig' })).toBeVisible();
  await expect(c.getByRole('dialog').getByRole('button', { name: 'Löschen' })).toHaveCount(0);
  await c.getByRole('dialog').getByRole('button', { name: 'Fertig' }).click();
  await expect(c.getByRole('dialog')).toBeHidden();
  await tab(c, 'Törn').click();
  await expect(c.getByLabel('Name des Törns')).toBeDisabled();

  // zurück zum eigenen Boot: Karte mit Flottillen-Schalter
  await c.getByRole('button', { name: /^Zu „Eigener Törn“/ }).click();
  await expect(c.locator('.banner')).toHaveCount(0);
  await tab(c, 'Karte').click();
  const toggle = c.getByRole('switch', { name: /Flottille anzeigen/ });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(c.getByRole('list', { name: 'Legende' })).toContainText('Seeschwalbe');
  await expect(c.locator('.leaflet-container path[stroke="#0b6b8a"]')).not.toHaveCount(0); // Route/Punkte des anderen Boots

  // A und B haben keinen Schalter-Mangel: A sieht ihn nicht (keine zweite Flottillen-Trip lokal)
  await tab(a, 'Karte').click();
  await expect(a.getByRole('switch', { name: /Flottille anzeigen/ })).toHaveCount(0);
});
