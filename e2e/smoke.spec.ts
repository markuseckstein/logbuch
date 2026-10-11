import { expect, test } from '@playwright/test';
import { onboard } from './helpers';

test('Erststart zeigt Onboarding; danach 4 Tabs und Tab-Wechsel', async ({ page }) => {
  await page.goto('/');
  const onboarding = page.getByRole('dialog', { name: 'Neuer Törn' });
  await expect(onboarding).toBeVisible();

  await onboard(page, { trip: 'Smoke-Törn', goto: false });
  // ein Boot: kein Boot-Schalter
  await expect(page.getByRole('radiogroup', { name: 'Boot wählen' })).toHaveCount(0);

  const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
  for (const name of ['Heute', 'Törn-Tage', 'Karte', 'Törn']) {
    await expect(nav.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: 'Heute' })).toBeAttached();
  await nav.getByRole('button', { name: 'Karte', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Törnkarte' })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Karte', exact: true })).toHaveAttribute('aria-current', 'page');
});
