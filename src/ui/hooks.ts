import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { getSettings, listTrips } from '../db/repo';
import { localDate, type Settings, type Trip } from '../domain';
import { currentTzOffsetMin } from './lib';

export function useSettings(): Settings | undefined {
  return useLiveQuery(() => getSettings(db), []);
}

export function useTrips(): Trip[] | undefined {
  return useLiveQuery(() => listTrips(db), []);
}

const computeToday = (): string => localDate(Date.now(), currentTzOffsetMin());

/** Heutiges lokales Datum (YYYY-MM-DD); aktualisiert sich über Mitternacht. */
export function useToday(): string {
  const [today, setToday] = useState(computeToday);
  useEffect(() => {
    const id = setInterval(() => setToday(computeToday()), 60_000);
    return () => clearInterval(id);
  }, []);
  return today;
}
