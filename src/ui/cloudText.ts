import type { DXCAlert } from 'dexie-cloud-addon';
import type { CloudStatus } from '../db/cloud';
import { MAX_AUTO_ATTEMPTS, type RescuedChange } from '../db/syncRejections';
import { describeRejection } from '../domain';

/** Statuszeile im Abschnitt „Synchronisation“. */
export function statusLabel(status: CloudStatus, lastSyncAt: number | undefined, now: number): string {
  switch (status) {
    case 'local':
      return 'Nur auf diesem Gerät (keine Cloud eingerichtet)';
    case 'signed-out':
      return 'Nicht angemeldet – Daten nur auf diesem Gerät';
    case 'syncing':
      return 'Synchronisiert gerade …';
    case 'offline':
      return 'Offline – Änderungen werden später übertragen';
    case 'error':
      return 'Fehler beim Synchronisieren';
    case 'in-sync': {
      if (lastSyncAt === undefined) return 'Synchronisiert';
      const min = Math.floor((now - lastSyncAt) / 60_000);
      if (min < 1) return 'Synchronisiert – gerade eben';
      if (min < 60) return `Synchronisiert vor ${min} min`;
      return `Synchronisiert vor ${Math.floor(min / 60)} h`;
    }
  }
}

const resolve = (a: DXCAlert): string => a.message.replace(/\{(\w+)\}/g, (_, k: string) => a.messageParams[k] ?? '');

/** Deutsche Texte für Hinweise des Dexie-Cloud-Logins (eigene Dialoge). */
export function alertText(a: DXCAlert): string {
  switch (a.messageCode) {
    case 'OTP_SENT':
      return `Wir haben dir einen Code an ${a.messageParams['email'] ?? 'deine E-Mail-Adresse'} geschickt.`;
    case 'INVALID_OTP':
      return 'Der Code stimmt nicht. Bitte erneut eingeben.';
    case 'INVALID_EMAIL':
      return 'Bitte eine gültige E-Mail-Adresse eingeben.';
    case 'LICENSE_LIMIT_REACHED':
    case 'NO_SEATS_AVAILABLE':
      return 'Die Cloud hat keine freien Plätze mehr. Bitte den Skipper fragen.';
    case 'USER_NOT_REGISTERED':
    case 'USER_NOT_ACCEPTED':
      return 'Diese E-Mail-Adresse ist für die Cloud nicht freigeschaltet.';
    case 'USER_DEACTIVATED':
      return 'Dieses Konto ist deaktiviert.';
    case 'LOGOUT_CONFIRMATION':
      return 'Es gibt noch nicht übertragene Änderungen. Beim Abmelden gehen sie verloren.';
    default:
      return a.type === 'error' ? `Fehler: ${resolve(a)}` : resolve(a);
  }
}

export function roleLabel(roles: readonly string[]): string {
  if (roles.includes('skipper')) return 'Skipper';
  if (roles.includes('crew')) return 'Crew (schreibt mit)';
  if (roles.includes('readonly')) return 'Anderes Boot (nur lesen)';
  return 'Mitglied';
}

const KIND: Record<string, [string, string]> = {
  entries: ['Eintrag', 'Einträge'],
  photos: ['Foto', 'Fotos'],
  dayReports: ['Tagesbericht', 'Tagesberichte'],
  crewMembers: ['Crew-Mitglied', 'Crew-Mitglieder'],
  tracks: ['Track', 'Tracks'],
  trackChunks: ['Track-Abschnitt', 'Track-Abschnitte'],
  trips: ['Törn-Änderung', 'Törn-Änderungen'],
};
const kind = (table: string, n: number): string => {
  const [one, many] = KIND[table] ?? ['Änderung', 'Änderungen'];
  return n === 1 ? one : many;
};

/** Hinweis zu vom Server abgelehnten, lokal gesicherten Änderungen (Banner). */
export function rejectedText(items: readonly Pick<RescuedChange, 'table' | 'state' | 'attempts' | 'reason'>[]): string {
  const pending = items.filter((i) => i.state === 'pending');
  if (pending.length === 0) {
    const n = items.length;
    return `${n} zuvor abgelehnte ${n === 1 ? 'Änderung wird' : 'Änderungen werden'} erneut gesendet …`;
  }
  const counts = new Map<string, number>();
  for (const i of pending) counts.set(i.table, (counts.get(i.table) ?? 0) + 1);
  const reasons = [...new Set(pending.map((i) => describeRejection(i.reason)))].join(', ');
  const n = pending.length;
  const what = counts.size === 1 ? `${n} ${kind(pending[0]!.table, n)}` : `${n} Änderungen`;
  const detail = counts.size === 1 ? reasons : `${[...counts].map(([t, c]) => `${c} ${kind(t, c)}`).join(', ')}; ${reasons}`;
  const manual = pending.some((i) => i.attempts >= MAX_AUTO_ATTEMPTS);
  const keep = n === 1 ? 'Er bleibt auf diesem Gerät gespeichert' : 'Sie bleiben auf diesem Gerät gespeichert';
  const next = manual ? ' – bitte später erneut senden.' : ` und ${n === 1 ? 'wird' : 'werden'} automatisch erneut gesendet.`;
  return `Der Server hat ${what} abgelehnt (${detail}). ${keep}${next}`;
}
