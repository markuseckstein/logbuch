import { expect, test } from '@playwright/test';

test('Erststart zeigt Onboarding; danach 4 Tabs und Tab-Wechsel', async ({ page }) => {
  await page.goto('/');
  const onboarding = page.getByRole('dialog', { name: 'Neuer Törn' });
  await expect(onboarding).toBeVisible();

  await page.getByLabel('Name des Törns').fill('Smoke-Törn');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('button', { name: 'Törn anlegen' }).click();

  const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
  for (const name of ['Heute', 'Törn-Tage', 'Karte', 'Törn']) {
    await expect(nav.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: 'Heute' })).toBeAttached();
  await nav.getByRole('button', { name: 'Karte', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Törnkarte' })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Karte', exact: true })).toHaveAttribute('aria-current', 'page');
});
