import { expect, test } from '@playwright/test';

test('App lädt, 4 Tabs sichtbar, Tab-Wechsel funktioniert', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
  for (const name of ['Heute', 'Törn-Tage', 'Karte', 'Törn']) {
    await expect(nav.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: 'Heute' })).toBeVisible();
  await nav.getByRole('button', { name: 'Karte', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Karte' })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Karte', exact: true })).toHaveAttribute('aria-current', 'page');
});
