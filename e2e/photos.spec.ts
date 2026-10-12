import { expect, test, type Page } from '@playwright/test';
import { onboard } from './helpers';

test.use({
  geolocation: { latitude: 54.3185, longitude: 10.1407, accuracy: 10 },
  permissions: ['geolocation'],
  serviceWorkers: 'block',
});

const fx = (name: string): string => `e2e/fixtures/${name}`;
const toast = (page: Page) => page.locator('.toast');

test('Mehrfachauswahl, Duplikate pro Tag (Eintrag und Tagesbericht)', async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 200, body: '' }));
  await onboard(page, { trip: 'Fototörn' });
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
  const day = page.getByRole('region', { name: 'Fotos zu deinem Abschnitt' });
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

test('Foto im Eintrag groß öffnen, wischen, schließen (X, Wischen, Esc, Zurück)', async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 200, body: '' }));
  await onboard(page, { trip: 'Bildertörn' });
  await page.getByRole('button', { name: /Eintrag jetzt/ }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Galerie').setInputFiles([fx('photo-1.png'), fx('photo-2.png'), fx('photo-3.png')]);
  await expect(sheet.getByText('3 / 5')).toBeVisible();
  await sheet.getByRole('button', { name: 'Speichern' }).click();
  await expect(sheet).toBeHidden();

  // Timeline-Vorschau antippen → Vollbild mit Zähler und Bildunterschrift (Zeit · Autor)
  await page.locator('.tl-thumbs').getByRole('button', { name: 'Foto 1 groß anzeigen' }).click();
  const viewer = page.getByRole('dialog', { name: /^Foto \d \/ 3$/ });
  await expect(viewer).toHaveAccessibleName('Foto 1 / 3');
  await expect(viewer).toContainText('Anna');
  const img = viewer.locator('img');
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  // nach links wischen → nächstes Foto, Pfeil → drittes
  const stage = viewer.getByTestId('photo-viewer-stage');
  const box = (await stage.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx + 120, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 20, cy + 5, { steps: 5 });
  await page.mouse.move(cx - 120, cy + 5, { steps: 5 });
  await page.mouse.up();
  await expect(viewer).toHaveAccessibleName('Foto 2 / 3');
  await viewer.getByRole('button', { name: 'Nächstes Foto' }).click();
  await expect(viewer).toHaveAccessibleName('Foto 3 / 3');

  // nach unten wischen schließt
  await page.mouse.move(cx, cy - 100);
  await page.mouse.down();
  await page.mouse.move(cx, cy, { steps: 5 });
  await page.mouse.move(cx, cy + 120, { steps: 5 });
  await page.mouse.up();
  await expect(viewer).toBeHidden();

  // im Bearbeiten-Sheet: Foto antippen öffnet den Viewer, Entfernen bleibt ein eigener Knopf
  await page.getByRole('button', { name: /Eintrag \d\d:\d\d .* öffnen/ }).click();
  const edit = page.getByRole('dialog', { name: /Eintrag/ });
  await edit.getByRole('button', { name: 'Foto 2 groß anzeigen' }).click();
  await expect(viewer).toHaveAccessibleName('Foto 2 / 3');
  await page.keyboard.press('Escape'); // schließt nur den Viewer
  await expect(viewer).toBeHidden();
  await expect(edit.getByRole('button', { name: 'Foto 2 entfernen' })).toBeVisible();

  // Zurück-Geste (Browser zurück) schließt den Viewer, das Sheet bleibt offen
  await edit.getByRole('button', { name: 'Foto 3 groß anzeigen' }).click();
  await expect(viewer).toBeVisible();
  await page.goBack();
  await expect(viewer).toBeHidden();
  await expect(edit.getByRole('button', { name: 'Foto 3 entfernen' })).toBeVisible();

  // X schließt
  await edit.getByRole('button', { name: 'Foto 1 groß anzeigen' }).click();
  await viewer.getByRole('button', { name: 'Foto schließen' }).click();
  await expect(viewer).toBeHidden();
  await expect(edit).toBeVisible();
});
