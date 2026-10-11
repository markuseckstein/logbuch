import { afterEach, describe, expect, it } from 'vitest';
import { INVALID_TOKEN, captureHomeViewFromUrl, clearHomeViewToken } from './state';

const TOKEN = 'abcdefghijklmnopqrstuvwx23';
const stored = (): string | null => localStorage.getItem('logbook.daheim');

describe('captureHomeViewFromUrl', () => {
  afterEach(() => {
    clearHomeViewToken();
    history.replaceState(null, '', '/');
  });

  it('merkt den Token und entfernt ihn aus der Adresse (Pfad, Query und andere Hash-Teile bleiben)', () => {
    history.replaceState(null, '', `/logbook/?x=1#a=2&daheim=${TOKEN}`);
    captureHomeViewFromUrl();
    expect(stored()).toBe(TOKEN);
    expect(location.pathname + location.search + location.hash).toBe('/logbook/?x=1#a=2');
  });

  it('ohne daheim im Hash passiert nichts', () => {
    history.replaceState(null, '', '/#foo');
    captureHomeViewFromUrl();
    expect(stored()).toBeNull();
    expect(location.hash).toBe('#foo');
  });

  it('abgeschnittener Link: als ungültig merken (Ansicht „nicht mehr gültig“)', () => {
    history.replaceState(null, '', '/#daheim=abc');
    captureHomeViewFromUrl();
    expect(stored()).toBe(INVALID_TOKEN);
    expect(location.hash).toBe('');
  });
});
