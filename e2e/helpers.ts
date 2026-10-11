import { expect, type Page } from '@playwright/test';

/** Onboarding in drei Schritten: Törn (+ eigener Name) → Boote → Crew (überspringen bzw. anlegen). */
export async function onboard(
  page: Page,
  opts: { trip: string; boats?: readonly string[]; founder?: string; goto?: boolean } = { trip: 'Törn' },
): Promise<void> {
  if (opts.goto !== false) await page.goto('/');
  await expect(page.getByRole('dialog', { name: 'Neuer Törn' })).toBeVisible();
  await page.getByLabel('Name des Törns').fill(opts.trip);
  await page.getByLabel('Dein Name').fill(opts.founder ?? 'Anna');
  await page.getByRole('button', { name: 'Weiter' }).click();
  const boats = opts.boats ?? ['Seeschwalbe'];
  for (const [i, b] of boats.entries()) {
    await page.getByLabel('Bootsname').fill(b);
    if (i < boats.length - 1) await page.getByRole('button', { name: 'Boot hinzufügen' }).click();
  }
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(page.getByRole('heading', { name: 'Crew einladen' })).toBeVisible();
  await page.getByRole('button', { name: 'Törn anlegen' }).click();
  await expect(page.locator('.brand span')).toContainText(opts.trip);
}
