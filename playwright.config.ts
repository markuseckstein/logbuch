import { readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/** Dexie-Cloud-URL aus der Umgebung oder `.env.local` (gitignored); leer = keine Cloud-E2E. */
function cloudUrl(): string {
  if (process.env['VITE_DEXIE_CLOUD_URL']) return process.env['VITE_DEXIE_CLOUD_URL'];
  try {
    const m = /^VITE_DEXIE_CLOUD_URL=(.*)$/m.exec(readFileSync('.env.local', 'utf8'));
    return m?.[1]?.trim() ?? '';
  } catch {
    return '';
  }
}

const CLOUD_URL = cloudUrl();
// für e2e/cloud.spec.ts (test.skip ohne URL)
process.env['E2E_CLOUD_URL'] = CLOUD_URL;
const CLOUD = process.env['E2E_CLOUD'] === '1';

const device = { ...devices['Pixel 7'], browserName: 'chromium' as const };

/**
 * `npm run e2e`: lokale App (Cloud-URL ausdrücklich leer, eigener Build/Port), alle Specs außer cloud.spec.
 * `npm run e2e:cloud`: Build mit Cloud-URL auf Port 4173 (in der Dexie-Cloud-Whitelist), nur cloud.spec.
 */
export default defineConfig({
  testDir: './e2e',
  reporter: 'list',
  projects: CLOUD
    ? [{ name: 'cloud', testMatch: /cloud\.spec\.ts/, use: { ...device, baseURL: 'http://localhost:4173' } }]
    : [{ name: 'chromium-pixel7', testIgnore: /cloud\.spec\.ts/, use: { ...device, baseURL: 'http://localhost:4175' } }],
  // Cloud-Läufe teilen sich die Demo-Konten (alice/bob/carol): nie parallel, auch nicht mit --repeat-each
  ...(CLOUD ? { timeout: 300_000, workers: 1 } : {}),
  webServer: CLOUD
    ? {
      command: 'npm run build && npm run preview',
      url: 'http://localhost:4173',
      env: { VITE_DEXIE_CLOUD_URL: CLOUD_URL },
      reuseExistingServer: false,
      timeout: 180_000,
    }
    : {
      command: 'tsc -b && vite build --outDir dist-local && vite preview --outDir dist-local --port 4175 --strictPort',
      url: 'http://localhost:4175',
      env: { VITE_DEXIE_CLOUD_URL: '' },
      reuseExistingServer: !process.env['CI'],
      timeout: 180_000,
    },
});
