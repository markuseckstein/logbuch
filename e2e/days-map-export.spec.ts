import { expect, test, type Page } from '@playwright/test';
import { onboard as onboardWith } from './helpers';

test.use({
  geolocation: { latitude: 54.3185, longitude: 10.1407, accuracy: 10 },
  permissions: ['geolocation'],
  serviceWorkers: 'block',
});

// 1x1 transparent PNG – die Tests dürfen nicht vom Tile-Server abhängen.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function onboard(page: Page): Promise<void> {
  await onboardWith(page, { trip: 'Kieler Förde' });
}

async function quickEntry(page: Page, type: string): Promise<void> {
  await page.getByRole('button', { name: /Eintrag jetzt/ }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'gespeichert' })).toContainText('°');
  await sheet.getByRole('radio', { name: type }).click();
  await sheet.getByRole('button', { name: 'Speichern' }).click();
  await expect(sheet).toBeHidden();
}

test('Tagesbericht, Karte mit Route und Export-Download', async ({ page, context }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG }),
  );
  await onboard(page);

  await quickEntry(page, 'Ablegen');
  // Zweite, deutlich andere Position (neuer Fix statt Cache: Seite neu laden)
  await context.setGeolocation({ latitude: 54.4, longitude: 10.2, accuracy: 10 });
  await page.reload();
  await expect(page.locator('.brand span')).toContainText('Kieler Förde');
  await quickEntry(page, 'Hafen');

  // Heute: Leaflet-Karte statt Skizze
  await expect(page.locator('.chartmap.leaflet-container')).toBeVisible();

  // Tagesbericht
  await page.getByRole('button', { name: 'Törn-Tage', exact: true }).click();
  await page.getByRole('button', { name: /^Tag 1,/ }).click();
  await page.getByRole('button', { name: 'Meinen Abschnitt schreiben' }).click();
  await page.getByLabel('Titel (optional)').fill('Von Schilksee nach Eckernförde');
  await page.getByLabel('Dein Abschnitt').fill('Raumer Wind, Sonne, ein Schweinswal.');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Dein Abschnitt ist gespeichert' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Tagesbericht von Anna' })).toContainText(/\d\d:\d\d Uhr/);
  await page.getByRole('button', { name: 'Törn-Tage', exact: true }).first().click();
  await expect(page.getByText('Von Schilksee nach Eckernförde').first()).toBeVisible();

  // Karte: Container, Polyline und Punkte
  await page.getByRole('navigation').getByRole('button', { name: 'Karte' }).click();
  await expect(page.locator('.leaflet-container')).toBeVisible();
  await expect(page.locator('.leaflet-container path.leaflet-interactive')).toHaveCount(1); // 1 Route
  await expect(page.locator('.leaflet-container .boat-mk')).toHaveCount(2); // 2 Punkte (Symbol des Boots)
  await expect(page.locator('.leaflet-control-attribution')).toContainText('© OpenStreetMap-Mitwirkende');
  await expect(page.getByRole('button', { name: 'Tag 1' })).toBeVisible();
  await page.locator('.leaflet-container .boat-mk').last().dispatchEvent('click');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');

  // Export
  await page.getByRole('navigation').getByRole('button', { name: 'Törn', exact: true }).click();
  await expect(page.getByText(/2 Einträge · 0 Bilder/)).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ZIP mit Bildern exportieren' }).click();
  expect((await download).suggestedFilename()).toMatch(/^logbuch-kieler-foerde-\d{4}-\d{2}-\d{2}\.zip$/);
});
