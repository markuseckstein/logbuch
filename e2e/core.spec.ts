import { expect, test } from '@playwright/test';

test.use({
  geolocation: { latitude: 54.3185, longitude: 10.1407, accuracy: 10 },
  permissions: ['geolocation'],
});

test('Onboarding, Eintrag jetzt mit Position, Wind setzen, speichern, in Timeline sichtbar', async ({ page }) => {
  await page.goto('/');

  // Onboarding: Törn -> Boot -> Crew
  await expect(page.getByRole('dialog', { name: 'Neuer Törn' })).toBeVisible();
  await page.getByLabel('Name des Törns').fill('Dänische Südsee');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByLabel('Bootsname').fill('Seeschwalbe');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Jonas');
  await page.getByRole('button', { name: 'Crew hinzufügen' }).click();
  await expect(page.getByText('Jonas')).toBeVisible();
  await page.getByRole('button', { name: 'Törn anlegen' }).click();
  await expect(page.locator('.brand span')).toContainText('Dänische Südsee');

  // Eintrag jetzt
  await page.getByRole('button', { name: /Eintrag jetzt/ }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'gespeichert' })).toContainText('54°19,1′N 010°08,4′E');
  await expect(sheet).toContainText('54°19,110′N');

  // Wind NW / 5 Bft, Typ, Text
  await sheet.getByRole('radio', { name: 'Ablegen' }).click();
  await sheet.getByRole('radio', { name: 'Wind aus NW' }).click();
  await sheet.getByRole('button', { name: '5 Beaufort, frische Brise' }).click();
  await sheet.getByLabel('Text').fill('Leinen los in Schilksee');
  await sheet.getByRole('button', { name: 'Speichern' }).click();
  await expect(sheet).toBeHidden();

  // Timeline
  const item = page.getByRole('button', { name: /Eintrag \d\d:\d\d Ablegen öffnen/ });
  await expect(item).toBeVisible();
  await expect(item).toContainText('NW 5 Bft');
  await expect(item).toContainText('Leinen los in Schilksee');
  await expect(item).toContainText('54°19,1′N 010°08,4′E');

  // Fokus kehrt nach dem Schließen zurück (Escape)
  await item.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(item).toBeFocused();
});
