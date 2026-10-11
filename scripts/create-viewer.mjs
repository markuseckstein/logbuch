// Daheim-Link einmalig freischalten: legt das Dexie-Cloud-Demo-Konto des Zuschauers an (Login ohne Code).
// Dexie Cloud erlaubt den Demo-Login nur für vorher importierte Adressen (Spike, docs/research/dexie-cloud-integration.md 9.10).
//
// Aufruf im Repo-Root (dort liegen dexie-cloud.json und dexie-cloud.key; die CLI liest den Schlüssel selbst):
//   npm run viewer:create -- daheim-<token>@demo.local      (auch der ganze Link oder nur der Token)
//   npm run viewer:create -- --delete daheim-<token>@demo.local
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Gleiches Format wie src/domain/homeView.ts (26 Zeichen Base32 = 128 Bit)
const TOKEN = '[a-z2-7]{26}';

/** E-Mail des Zuschauers aus E-Mail, Link (`#daheim=<token>`) oder Token; sonst undefined. */
export function viewerEmailFromArg(arg) {
  const s = String(arg ?? '').trim().toLowerCase();
  const m =
    new RegExp(`^daheim-(${TOKEN})@demo\\.local$`).exec(s) ??
    new RegExp(`[#&]daheim=(${TOKEN})(?:&|$)`).exec(s) ??
    new RegExp(`^(${TOKEN})$`).exec(s);
  return m ? `daheim-${m[1]}@demo.local` : undefined;
}

function main(argv) {
  const remove = argv.includes('--delete');
  const arg = argv.find((a) => a !== '--delete');
  const email = viewerEmailFromArg(arg);
  if (!email) {
    console.error('Aufruf: npm run viewer:create -- [--delete] daheim-<token>@demo.local (oder Daheim-Link)');
    process.exit(2);
  }
  const dir = mkdtempSync(join(tmpdir(), 'logbuch-viewer-'));
  const file = join(dir, 'viewer.json');
  try {
    // null löscht den Demo-Nutzer (Dexie-Cloud-Import), {} legt ihn an
    writeFileSync(file, JSON.stringify({ demoUsers: { [email]: remove ? null : {} } }));
    execFileSync('npx', ['dexie-cloud', 'import', file], { stdio: 'inherit', cwd: ROOT });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(remove ? `Daheim-Konto ${email} gelöscht.` : `Daheim-Link freigeschaltet: ${email}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
