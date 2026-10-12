import type { DXCAlert } from 'dexie-cloud-addon';
import type { CloudStatus } from '../db/cloud';
import { MAX_AUTO_ATTEMPTS, type RescuedChange } from '../db/syncRejections';
import { describeRejection } from '../domain';

/** Statuszeile im Abschnitt „Synchronisation“. */
export function statusLabel(status: CloudStatus, lastSyncAt: number | undefined, now: number): string {
  switch (status) {
    case 'local':
      return 'Nur auf diesem Handy gespeichert';
    case 'signed-out':
      return 'Nicht angemeldet – nur auf diesem Handy gespeichert';
    case 'syncing':
      return 'Wird übertragen …';
    case 'offline':
      return 'Offline – Änderungen werden später übertragen';
    case 'error':
      return 'Übertragen fehlgeschlagen';
    case 'in-sync': {
      if (lastSyncAt === undefined) return 'Alles übertragen';
      const min = Math.floor((now - lastSyncAt) / 60_000);
      if (min < 1) return 'Alles übertragen · gerade eben';
      if (min < 60) return `Alles übertragen · vor ${min} min`;
      return `Alles übertragen · vor ${Math.floor(min / 60)} h`;
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
      return 'Es sind keine Plätze mehr frei. Bitte den Skipper fragen.';
    case 'USER_NOT_REGISTERED':
    case 'USER_NOT_ACCEPTED':
      return 'Diese E-Mail-Adresse ist noch nicht freigeschaltet.';
    case 'USER_DEACTIVATED':
      return 'Dieses Konto ist deaktiviert.';
    case 'LOGOUT_CONFIRMATION':
      return 'Es gibt noch nicht übertragene Änderungen. Beim Abmelden gehen sie verloren.';
    default:
      return a.type === 'error' ? `Fehler: ${resolve(a)}` : resolve(a);
  }
}

const KIND: Record<string, [string, string]> = {
  entries: ['Eintrag', 'Einträge'],
  boats: ['Boot', 'Boote'],
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
