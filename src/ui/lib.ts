import type { FixError } from '../device';
import { ENTRY_TYPE_LABELS, type EntryType } from '../domain';

export const ENTRY_TYPES = Object.keys(ENTRY_TYPE_LABELS) as EntryType[];

export const FIX_ERROR_LABEL: Record<FixError, string> = {
  denied: 'Zugriff verweigert',
  unavailable: 'nicht verfügbar',
  timeout: 'Zeitüberschreitung',
  unsupported: 'nicht unterstützt',
};

const pad = (n: number): string => String(n).padStart(2, '0');

/** Aktueller lokaler UTC-Offset in Minuten (positiv östlich von UTC). */
export const currentTzOffsetMin = (): number => -new Date().getTimezoneOffset();

/** Fahrtzeit als h:mm, 0 -> Gedankenstrich. */
export function formatUnderway(min: number): string {
  const total = Math.round(min);
  return total > 0 ? `${Math.floor(total / 60)}:${pad(total % 60)}` : '–';
}

/** Zahl mit Dezimalkomma, eine Nachkommastelle. */
export const num1 = (n: number): string => n.toFixed(1).replace('.', ',');

/** epoch ms + Offset -> Wert für <input type="datetime-local"> (lokale Zeit des Eintrags). */
export function toLocalInput(time: number, tzOffsetMin: number): string {
  return new Date(time + tzOffsetMin * 60000).toISOString().slice(0, 16);
}

/** Gegenstück zu toLocalInput; undefined bei ungültiger Eingabe. */
export function fromLocalInput(value: string, tzOffsetMin: number): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return undefined;
  const ms = Date.parse(`${value}:00Z`);
  return Number.isNaN(ms) ? undefined : ms - tzOffsetMin * 60000;
}

/** Dezimalzahl mit Punkt oder Komma; undefined, wenn leer/ungültig. */
export function parseDecimal(value: string): number | undefined {
  const s = value.trim().replace(',', '.');
  if (s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}
