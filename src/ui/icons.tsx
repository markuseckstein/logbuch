import type { EntryType, LogEntry } from '../domain';

/** Strichgrafik-Symbole aus Prototyp A (24x24, stroke=currentColor). */
const ICONS = {
  eintrag: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  ablegen: '<path d="M4 4v16M8 12h12M15 7l5 5-5 5"/>',
  hafen: '<path d="M8 20v-9a4 4 0 0 1 8 0v9M5 20h14M9 11h6"/>',
  anker: '<circle cx="12" cy="5" r="2"/><path d="M12 7v14M8 11h8M4 14a8 8 0 0 0 16 0M4 14l-1.5 2M20 14l1.5 2"/>',
  boje: '<path d="M12 2v4M9 6h6l2 9H7zM5 19c2 1.500 3.500 1.500 5 0s3-1.500 5 0 2.500 1 4 0"/>',
  segelan: '<path d="M12 3v15M12 4l6 11h-6M12 8l-5 7h5M5 20h14"/>',
  segelab: '<path d="M11 3v15M11 5l-3 11h3M5 20h14M18 6v8M15 11l3 3 3-3"/>',
  motor:
    '<circle cx="12" cy="12" r="4"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.600 5.600l2.100 2.100M16.300 16.300l2.100 2.100M5.600 18.400l2.100-2.100M16.300 7.700l2.100-2.100"/>',
  sichtung: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  sonst: '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3.500"/>',
  sonne:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.900 4.900l1.400 1.400M17.700 17.700l1.400 1.400M4.900 19.100l1.400-1.400M17.700 6.300l1.400-1.400"/>',
  leicht:
    '<circle cx="8" cy="8" r="3"/><path d="M8 2v1M2 8h1M3.800 3.800l.7.700M12.200 3.800l-.7.700"/><path d="M8 20h9a3.500 3.500 0 0 0 .5-6.900A5 5 0 0 0 8 14a3 3 0 0 0 0 6z"/>',
  bewoelkt: '<path d="M7 19h10a4 4 0 0 0 .5-7.900A6 6 0 0 0 6 12.500 3.300 3.300 0 0 0 7 19z"/>',
  regen: '<path d="M7 15h10a4 4 0 0 0 .5-7.900A6 6 0 0 0 6 8.500 3.300 3.300 0 0 0 7 15zM8 21l1-3M12 21l1-3M16 21l1-3"/>',
  gewitter: '<path d="M7 14h10a4 4 0 0 0 .5-7.900A6 6 0 0 0 6 7.500 3.300 3.300 0 0 0 7 14zM12.500 14l-2.500 4h4l-2.500 4"/>',
  nebel: '<path d="M4 8h16M3 12h14M6 16h15M4 20h10"/>',
  'tab-heute': '<circle cx="12" cy="12" r="9"/><path d="M15.500 8.500l-2 5-5 2 2-5z"/>',
  'tab-tage': '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>',
  'tab-karte': '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14"/>',
  'tab-toern': '<path d="M3 15h18l-3 5H6zM12 3v12M12 4l6 9h-6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  'chev-l': '<path d="M15 5l-7 7 7 7"/>',
  'chev-r': '<path d="M9 5l7 7-7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  cam: '<path d="M3 8h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="13" r="3.500"/>',
  moon: '<path d="M20 14.500A8 8 0 1 1 9.500 4a6.500 6.500 0 0 0 10.500 10.500z"/>',
  up: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  down: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  wolke: '<path d="M7 19h10a4.500 4.500 0 0 0 .6-8.960A6 6 0 0 0 6.100 11.200 4 4 0 0 0 7 19z"/>',
  'wolke-ok': '<path d="M7 19h10a4.500 4.500 0 0 0 .6-8.960A6 6 0 0 0 6.100 11.200 4 4 0 0 0 7 19z"/><path d="M9.500 14.500l2 2 3.500-4"/>',
  'wolke-aus': '<path d="M7 19h10a4.500 4.500 0 0 0 .6-8.960A6 6 0 0 0 6.100 11.200 4 4 0 0 0 7 19z"/><path d="M3 3l18 18"/>',
  'wolke-sync': '<path d="M7 19h10a4.500 4.500 0 0 0 .6-8.960A6 6 0 0 0 6.100 11.200 4 4 0 0 0 7 19z"/><path d="M12 11v5M9.500 13.500L12 16l2.500-2.500"/>',
  'wolke-fehler': '<path d="M7 19h10a4.500 4.500 0 0 0 .6-8.960A6 6 0 0 0 6.100 11.200 4 4 0 0 0 7 19z"/><path d="M12 11v3M12 16.500h.01"/>',
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="ico"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}

export const ENTRY_ICON: Record<EntryType, IconName> = {
  note: 'eintrag',
  departure: 'ablegen',
  harbour: 'hafen',
  anchorage: 'anker',
  mooring: 'boje',
  'sails-up': 'segelan',
  'sails-down': 'segelab',
  'engine-on': 'motor',
  'engine-off': 'motor',
  sighting: 'sichtung',
  other: 'sonst',
};

export const SKY_ICON: Record<NonNullable<LogEntry['sky']>, IconName> = {
  sunny: 'sonne',
  'partly-cloudy': 'leicht',
  cloudy: 'bewoelkt',
  rain: 'regen',
  thunderstorm: 'gewitter',
  fog: 'nebel',
};
