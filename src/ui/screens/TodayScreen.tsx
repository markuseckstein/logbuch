import { useMemo, useRef, useState } from 'react';
import { captureFix } from '../../device';
import { db } from '../../db/db';
import { useEntries } from '../../db/hooks';
import { createEntry, setEntryPosition } from '../../db/repo';
import {
  dayNumber,
  dayRoute,
  dayStats,
  formatDateLong,
  formatPosition,
  formatTime,
  groupEntriesByDay,
  tripDays,
  type DayReport,
  type Trip,
} from '../../domain';
import { useApp } from '../AppContext';
import { useToday } from '../hooks';
import { Icon } from '../icons';
import { FIX_ERROR_LABEL, currentTzOffsetMin } from '../lib';
import { useToast } from '../toast';
import { MiniRoute } from '../components/MiniRoute';
import { StatsBar } from '../components/StatsBar';
import { Timeline } from '../components/Timeline';

interface TodayScreenProps {
  trip: Trip;
  reports: readonly DayReport[];
}

export function TodayScreen({ trip, reports }: TodayScreenProps) {
  const entries = useEntries(trip.id);
  const { openEntry } = useApp();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const today = useToday();
  const todays = useMemo(
    () => groupEntriesByDay(entries ?? []).find((g) => g.date === today)?.entries ?? [],
    [entries, today],
  );
  const stats = dayStats(todays);
  const route = dayRoute(todays);
  const days = tripDays(trip, entries ?? [], reports);
  const dayNo = dayNumber(trip, today, days);

  const quickEntry = async (): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      // Eintrag sofort anlegen – auch ohne Position.
      const time = Date.now();
      const entry = await createEntry(db, trip.id, { time, tzOffsetMin: currentTzOffsetMin() });
      let improved = false;
      const { first } = captureFix({
        onImproved: (p) => {
          improved = true;
          void setEntryPosition(db, entry.id, p);
        },
      });
      const res = await first;
      if (res.position && !improved) await setEntryPosition(db, entry.id, res.position);
      const t = formatTime(entry.time, entry.tzOffsetMin);
      const where = res.position
        ? formatPosition(res.position)
        : `ohne Position${res.error ? ` (GPS: ${FIX_ERROR_LABEL[res.error]})` : ''}`;
      toast(`Eintrag ${t} gespeichert · ${where}`, 3800);
      openEntry(entry.id, true);
    } catch {
      toast('Eintrag konnte nicht gespeichert werden');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <main className="screen" aria-labelledby="screen-title">
      <h2 id="screen-title" className="sr-only">
        Heute
      </h2>
      <button className={busy ? 'fix busy' : 'fix'} type="button" disabled={busy} onClick={() => void quickEntry()}>
        <Icon name={busy ? 'motor' : 'eintrag'} size={40} />
        <span className="lbl">
          <span>{busy ? 'Position wird bestimmt …' : 'Eintrag jetzt'}</span>
          <small>{busy ? 'GPS-Fix, bitte kurz warten' : '1 Tap · GPS und Uhrzeit'}</small>
        </span>
      </button>
      <MiniRoute points={route} label="Schematische Route der heutigen Einträge" />
      <StatsBar stats={stats} />
      <div className="legend">
        {dayNo >= 1 ? `Tag ${dayNo} · ` : ''}
        {formatDateLong(today)}
      </div>
      {todays.length === 0 ? (
        <p className="muted">Heute noch kein Eintrag. Tippe auf „Eintrag jetzt“, um Position und Uhrzeit festzuhalten.</p>
      ) : (
        <Timeline entries={[...todays].reverse()} onOpen={(id) => openEntry(id)} />
      )}
    </main>
  );
}
