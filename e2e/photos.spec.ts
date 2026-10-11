import { expect, test, type Page } from '@playwright/test';

test.use({
  geolocation: { latitude: 54.3185, longitude: 10.1407, accuracy: 10 },
  permissions: ['geolocation'],
  serviceWorkers: 'block',
});

const fx = (name: string): string => `e2e/fixtures/${name}`;
const toast = (page: Page) => page.locator('.toast');

test('Mehrfachauswahl, Duplikate pro Tag (Eintrag und Tagesbericht)', async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 200, body: '' }));
  await page.goto('/');
  await page.getByLabel('Name des Törns').fill('Fototörn');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByLabel('Bootsname').fill('Seeschwalbe');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('button', { name: 'Törn anlegen' }).click();
  await page.getByRole('button', { name: /Eintrag jetzt/ }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();

  // 3 verschiedene + 1 Duplikat (gleiche Bytes, anderer Dateiname)
  await sheet.getByLabel('Galerie').setInputFiles([fx('photo-1.png'), fx('photo-2.png'), fx('photo-3.png'), fx('photo-1-copy.png')]);
  await expect(toast(page)).toContainText('3 Fotos hinzugefügt · 1 übersprungen (schon an diesem Tag vorhanden)');
  await expect(sheet.getByText('3 / 5')).toBeVisible();
  await expect(sheet.getByRole('button', { name: /Foto \d entfernen/ })).toHaveCount(3);

  // Kamera-Eingabe nimmt ein einzelnes Foto
  await sheet.getByLabel('Kamera').setInputFiles(fx('photo-4.png'));
  await expect(sheet.getByText('4 / 5')).toBeVisible();

  // Limit: nur noch ein Platz
  await sheet.getByLabel('Galerie').setInputFiles([fx('photo-5.png')]);
  await expect(sheet.getByText('5 / 5')).toBeVisible();
  await expect(sheet.getByLabel('Galerie')).toBeDisabled();
  await sheet.getByRole('button', { name: 'Speichern' }).click();
  await expect(sheet).toBeHidden();

  // Tagesbericht: Duplikat (photo-2 hängt am Eintrag) wird übersprungen
  await page.getByRole('button', { name: 'Törn-Tage', exact: true }).click();
  await page.getByRole('button', { name: /^Tag 1,/ }).click();
  const day = page.getByRole('region', { name: 'Fotos des Tages' });
  await expect(day.getByText('0 / 15')).toBeVisible();
  await day.getByLabel('Galerie').setInputFiles([fx('photo-2.png'), fx('photo-1-copy.png')]);
  await expect(toast(page)).toContainText('Kein Foto hinzugefügt · 2 übersprungen (schon an diesem Tag vorhanden)');
  await expect(day.getByText('0 / 15')).toBeVisible();

  // Entfernen am Eintrag gibt den Hash frei: Foto 1 lässt sich dann im Bericht speichern
  await page.getByRole('button', { name: /Eintrag \d\d:\d\d .* öffnen/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Foto 1 entfernen' }).click();
  await expect(page.getByRole('dialog').getByText('4 / 5')).toBeVisible();
  await page.keyboard.press('Escape');
  await day.getByLabel('Galerie').setInputFiles([fx('photo-1.png'), fx('photo-2.png')]);
  await expect(toast(page)).toContainText('1 Foto hinzugefügt · 1 übersprungen (schon an diesem Tag vorhanden)');
  await expect(day.getByText('1 / 15')).toBeVisible();
  await day.getByRole('button', { name: 'Foto 1 entfernen' }).click();
  await expect(toast(page)).toContainText('Foto entfernt');
  await expect(day.getByText('0 / 15')).toBeVisible();
});
