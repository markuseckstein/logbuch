import { describe, expect, it } from 'vitest';
import { alertText, rejectedText, roleLabel, statusLabel } from './cloudText';

describe('statusLabel', () => {
  const now = Date.UTC(2026, 7, 10, 12, 0);
  it('describes every state in German', () => {
    expect(statusLabel('local', undefined, now)).toBe('Nur auf diesem Gerät (keine Cloud eingerichtet)');
    expect(statusLabel('signed-out', undefined, now)).toBe('Nicht angemeldet – Daten nur auf diesem Gerät');
    expect(statusLabel('syncing', undefined, now)).toBe('Synchronisiert gerade …');
    expect(statusLabel('offline', undefined, now)).toBe('Offline – Änderungen werden später übertragen');
    expect(statusLabel('error', undefined, now)).toBe('Fehler beim Synchronisieren');
  });
  it('in sync: how long ago', () => {
    expect(statusLabel('in-sync', now - 20_000, now)).toBe('Synchronisiert – gerade eben');
    expect(statusLabel('in-sync', now - 5 * 60_000, now)).toBe('Synchronisiert vor 5 min');
    expect(statusLabel('in-sync', now - 3 * 3_600_000, now)).toBe('Synchronisiert vor 3 h');
    expect(statusLabel('in-sync', undefined, now)).toBe('Synchronisiert');
  });
});

describe('alertText', () => {
  it('translates known codes', () => {
    expect(alertText({ type: 'error', messageCode: 'INVALID_OTP', message: 'Invalid OTP', messageParams: {} }))
      .toBe('Der Code stimmt nicht. Bitte erneut eingeben.');
    expect(alertText({ type: 'info', messageCode: 'OTP_SENT', message: 'sent to {email}', messageParams: { email: 'a@b.de' } }))
      .toBe('Wir haben dir einen Code an a@b.de geschickt.');
  });
  it('falls back to the resolved English message', () => {
    expect(alertText({ type: 'error', messageCode: 'GENERIC_ERROR', message: 'Boom {x}', messageParams: { x: '1' } }))
      .toBe('Fehler: Boom 1');
  });
});

describe('roleLabel', () => {
  it('names the roles of roles.json', () => {
    expect(roleLabel(['skipper'])).toBe('Skipper');
    expect(roleLabel(['crew'])).toBe('Crew (schreibt mit)');
    expect(roleLabel(['readonly'])).toBe('Anderes Boot (nur lesen)');
    expect(roleLabel([])).toBe('Mitglied');
  });
});

describe('rejectedText', () => {
  const item = (table: string, state: 'pending' | 'resent', attempts = 1, reason = 'not authorized to add entries') =>
    ({ table, state, attempts, reason });
  it('says what was rejected, why, and that it is kept and re-sent', () => {
    expect(rejectedText([item('entries', 'pending')])).toBe(
      'Der Server hat 1 Eintrag abgelehnt (Schreibrechte noch nicht wirksam). Er bleibt auf diesem Gerät gespeichert und wird automatisch erneut gesendet.',
    );
  });
  it('counts several changes and names the kinds', () => {
    expect(rejectedText([item('entries', 'pending'), item('photos', 'pending'), item('entries', 'pending')])).toBe(
      'Der Server hat 3 Änderungen abgelehnt (2 Einträge, 1 Foto; Schreibrechte noch nicht wirksam). Sie bleiben auf diesem Gerät gespeichert und werden automatisch erneut gesendet.',
    );
  });
  it('after the automatic attempts: asks for a manual retry', () => {
    expect(rejectedText([item('dayReports', 'pending', 3, 'boom')])).toBe(
      'Der Server hat 1 Tagesbericht abgelehnt (vom Server abgelehnt). Er bleibt auf diesem Gerät gespeichert – bitte später erneut senden.',
    );
  });
  it('while waiting for the server after a re-send', () => {
    expect(rejectedText([item('entries', 'resent')])).toBe('1 zuvor abgelehnte Änderung wird erneut gesendet …');
  });
});
