import { expect, test, type Page } from '@playwright/test';
import { onboard } from './helpers';

test.use({
  geolocation: { latitude: 54.3185, longitude: 10.1407, accuracy: 10 },
  permissions: ['geolocation'],
  serviceWorkers: 'block',
});

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const tab = (page: Page, name: string) => page.getByRole('navigation').getByRole('button', { name, exact: true });
const boatSwitch = (page: Page) => page.getByRole('radiogroup', { name: 'Boot wählen' });

/** Ein-Tipp-Eintrag; schließt das Ergänzen-Sheet wieder. */
async function oneTap(page: Page, boat: string): Promise<void> {
  await page.getByRole('button', { name: `Eintrag jetzt · ${boat}` }).click();
  await expect(page.locator('.toast')).toContainText(`gespeichert · ${boat}`);
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('radiogroup', { name: 'Boot' }).getByRole('radio', { name: boat })).toHaveAttribute('aria-checked', 'true');
  await sheet.getByRole('button', { name: 'Speichern' }).click();
  await expect(sheet).toBeHidden();
}

test('Mehrere Boote lokal: Boot-Schalter, Pflicht-Bootwahl, Karte mit Legende, Tage je Boot, Boote verwalten', async ({ page, context }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await onboard(page, { trip: 'Flottillentörn', boats: ['Seeschwalbe', 'Möwe'], founder: 'Anna' });

  // Schalter im Header, Erstwahl = vorgeschlagenes Boot der eigenen Person (Gründer → erstes Boot)
  await expect(boatSwitch(page).getByRole('radio')).toHaveCount(3);
  await expect(boatSwitch(page).getByRole('radio', { name: 'Seeschwalbe' })).toHaveAttribute('aria-checked', 'true');
  await oneTap(page, 'Seeschwalbe');

  await boatSwitch(page).getByRole('radio', { name: 'Möwe' }).click();
  await context.setGeolocation({ latitude: 54.42, longitude: 10.25, accuracy: 10 });
  await oneTap(page, 'Möwe');

  // „Alle“: Pflichtauswahl, vorausgewählt das zuletzt gewählte Boot (Möwe)
  await boatSwitch(page).getByRole('radio', { name: 'Alle' }).click();
  await page.getByRole('button', { name: /Eintrag jetzt/ }).click();
  const chooser = page.getByRole('dialog', { name: 'Neuer Eintrag' });
  await expect(chooser.getByRole('radio', { name: 'Möwe' })).toHaveAttribute('aria-checked', 'true');
  await chooser.getByRole('radio', { name: 'Seeschwalbe' }).click();
  await chooser.getByRole('button', { name: 'Eintrag speichern' }).click();
  await expect(page.locator('.toast')).toContainText('gespeichert · Seeschwalbe');
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();

  // Heute bei „Alle“: alle Einträge mit Boot-Badge, Summe über Boote
  const items = page.locator('.tl-item');
  await expect(items).toHaveCount(3);
  await expect(items.filter({ hasText: 'Möwe' })).toHaveCount(1);
  await expect(page.locator('.stats')).toContainText('sm gesamt');
  await expect(page.locator('.stats')).toContainText('Schreibende');
  await boatSwitch(page).getByRole('radio', { name: 'Möwe' }).click();
  await expect(items).toHaveCount(1);

  // Auswahl bleibt nach Neuladen erhalten
  await page.reload();
  await expect(boatSwitch(page).getByRole('radio', { name: 'Möwe' })).toHaveAttribute('aria-checked', 'true');

  // Karte: immer alle Boote, Legende mit Ein-/Ausblenden
  await tab(page, 'Karte').click();
  const legend = page.getByRole('region', { name: 'Legende' });
  await expect(legend.getByRole('button', { name: 'Seeschwalbe ausblenden' })).toBeVisible();
  await expect(page.locator('.leaflet-container .boat-mk')).toHaveCount(3);
  await expect(page.getByText(/3 Einträge · 2 von 2 Booten sichtbar/)).toBeVisible();
  await legend.getByRole('button', { name: 'Möwe ausblenden' }).click();
  await expect(page.locator('.leaflet-container .boat-mk')).toHaveCount(2);
  await expect(page.getByText(/2 Einträge · 1 von 2 Booten sichtbar/)).toBeVisible();

  // Tag-Ansicht bei „Alle“: Tabelle je Boot
  await boatSwitch(page).getByRole('radio', { name: 'Alle' }).click();
  await tab(page, 'Törn-Tage').click();
  await page.getByRole('button', { name: /^Tag 1,/ }).click();
  const table = page.getByRole('table', { name: 'Boote an diesem Tag' });
  await expect(table).toContainText('Seeschwalbe');
  await expect(table).toContainText('2 Einträge');
  await expect(table).toContainText('1 Einträge');

  // Törn-Tab: Boote als Karten, Boot anlegen und (ohne Einträge) wieder entfernen
  await tab(page, 'Törn').click();
  await expect(page.getByRole('article', { name: 'Boot Seeschwalbe' })).toContainText('2 Einträge');
  await expect(page.getByRole('article', { name: 'Boot Seeschwalbe' }).getByRole('button', { name: 'Entfernen' })).toHaveCount(0);
  await page.getByText('Boot anlegen').click();
  await page.getByLabel('Bootsname').last().fill('Kormoran');
  await page.getByRole('button', { name: 'Boot hinzufügen' }).click();
  await expect(boatSwitch(page).getByRole('radio')).toHaveCount(4);
  const kormoran = page.getByRole('article', { name: 'Boot Kormoran' });
  await kormoran.getByRole('button', { name: 'Entfernen' }).click();
  await kormoran.getByRole('button', { name: 'Endgültig entfernen' }).click();
  await expect(page.locator('.toast')).toContainText('Boot „Kormoran“ entfernt');
  await expect(boatSwitch(page).getByRole('radio')).toHaveCount(3);

  // Export enthält beide Boote (Format v4)
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ZIP mit Bildern exportieren' }).click();
  expect((await download).suggestedFilename()).toMatch(/^logbuch-flottillentoern-.*\.zip$/);
});
