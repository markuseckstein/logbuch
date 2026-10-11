// Rendert die SVG-Icons in public/icons/ mit Playwright/Chromium zu PNG.
// Aufruf: node scripts/gen-icons.mjs
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../public/icons/', import.meta.url));
const jobs = [
  ['icon.svg', 'icon-192.png', 192],
  ['icon.svg', 'icon-512.png', 512],
  ['icon-maskable.svg', 'icon-maskable-512.png', 512],
];

const browser = await chromium.launch();
for (const [svg, png, size] of jobs) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const markup = readFileSync(dir + svg, 'utf8');
  await page.setContent(
    `<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${markup}`,
  );
  writeFileSync(dir + png, await page.screenshot({ type: 'png' }));
  await page.close();
}
await browser.close();
console.log('Icons erzeugt');
