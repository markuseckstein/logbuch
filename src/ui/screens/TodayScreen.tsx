import { useMemo, useRef, useState } from 'react';
import { captureFix } from '../../device';
import { db } from '../../db/db';
import { useEntries, useTracks } from '../../db/hooks';
import { createEntry, setEntryPosition } from '../../db/repo';
import {
  dayNumber,
  formatDateLong,
  formatTime,
  localDate,
  tripDays,
  type DayReport,
  type ID,
  type Trip,
} from '../../domain';
import { useApp } from '../AppContext';
import { BoatChooser, BoatShape, boatColor, useBoatSelection } from '../boats';
import { useReadOnly, useToday } from '../hooks';
import { Icon } from '../icons';
import { boatLayers, currentTzOffsetMin, groupTrackPoints, selectionDayStats, writeErrorMessage } from '../lib';
import { useEnsureAuthor } from '../useEnsureAuthor';
import { useToast } from '../toast';
import { ChartMap } from '../components/ChartMap';
import { StatsBar } from '../components/StatsBar';
import { Timeline } from '../components/Timeline';

interface TodayScreenProps {
  trip: Trip;
  reports: readonly DayReport[];
}

export function TodayScreen({ trip, reports }: TodayScreenProps) {
  const allEntries = useEntries(trip.id);
  const allTracks = useTracks(trip.id);
  const { openEntry } = useApp();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const busyRef = useRef(false);
  const readOnly = useReadOnly(trip.id);
  const { ensure, dialog } = useEnsureAuthor(trip);
  const { boats, selected, shownIds } = useBoatSelection();
  const multi = shownIds.length > 1;

  const today = useToday();
  const tz = currentTzOffsetMin();
  const shown = useMemo(() => new Set(shownIds), [shownIds]);
  const todays = useMemo(
    () => (allEntries ?? []).filter((e) => shown.has(e.boatId) && localDate(e.time, e.tzOffsetMin) === today),
    [allEntries, shown, today],
  );
  const tracks = useMemo(() => (allTracks ?? []).filter((t) => shown.has(t.boatId)), [allTracks, shown]);
  const { stats, writers } = useMemo(
    () => selectionDayStats(todays, (id) => groupTrackPoints(tracks.filter((t) => t.boatId === id), tz).byDate[today], shownIds),
    [todays, tracks, tz, today, shownIds],
  );
  const layers = useMemo(
    () => boatLayers(trip, boats.filter((b) => shown.has(b.id)), todays, tracks, { dates: [today], labels: multi }),
    [trip, boats, shown, todays, tracks, today, multi],
  );
  const lastKnown = useMemo(() => [...(allEntries ?? [])].reverse().find((e) => e.position)?.position, [allEntries]);
  const days = tripDays(trip, allEntries ?? [], reports);
  const dayNo = dayNumber(trip, today, days);

  const quickEntry = async (boatId: ID): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      if (!(await ensure())) return;
      // Eintrag sofort anlegen – auch ohne Position.
      const time = Date.now();
      const entry = await createEntry(db, trip.id, { boatId, time, tzOffsetMin: currentTzOffsetMin() });
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
      // Kurz halten: die Position steht im Kopf des Sheets; ohne Position weist die Position-Karte darauf hin
      const where = res.position ? '' : ' – ohne Position';
      const boat = boats.length > 1 ? ` · ${boats.find((b) => b.id === boatId)?.name ?? ''}` : '';
      toast(`Eintrag ${t} gespeichert${boat}${where}`, 3800);
      openEntry(entry.id, true);
    } catch (e) {
      toast(writeErrorMessage(e, 'Eintrag konnte nicht gespeichert werden'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const onFix = (): void => {
    if (selected) void quickEntry(selected.id);
    else setChoosing(true);
  };

  const boatLabel = selected && boats.length > 1 ? selected : undefined;
  return (
    <main className="screen" aria-labelledby="screen-title">
      <h2 id="screen-title" className="sr-only">
        Heute
      </h2>
      {readOnly ? null : (
        <button
          className={busy ? 'fix busy' : 'fix'}
          type="button"
          disabled={busy}
          {...(!busy && boatLabel ? { 'aria-label': `Eintrag jetzt · ${boatLabel.name}` } : {})}
          onClick={onFix}
          style={boatLabel ? boatColor(boatLabel) : undefined}
        >
          <Icon name={busy ? 'motor' : 'eintrag'} size={40} />
          <span className="lbl">
            <span>
              {busy ? 'Position wird bestimmt …' : 'Eintrag jetzt'}
            </span>
            {!busy && boatLabel ? (
              <small className="fix-boat">
                {boatLabel.name}
              </small>
            ) : null}
            <small>
              {busy ? 'GPS-Fix, bitte kurz warten' : selected ? '1 Tap · GPS und Uhrzeit' : 'Boot wählst du im nächsten Schritt'}
            </small>
          </span>
          {boatLabel && !busy ? <BoatShape boat={boatLabel} /> : null}
        </button>
      )}
      {choosing ? (
        <BoatChooser
          title="Neuer Eintrag"
          confirmLabel="Eintrag speichern"
          hint="Dieses Boot schlagen wir beim nächsten Eintrag wieder vor."
          onCancel={() => setChoosing(false)}
          onConfirm={(id) => {
            setChoosing(false);
            void quickEntry(id);
          }}
        />
      ) : null}
      {dialog}
      <ChartMap
        compact
        label={`Karte der heutigen Route${selected && boats.length > 1 ? ` von ${selected.name}` : multi ? ' aller Boote' : ''}`}
        layers={layers}
        onOpenEntry={(id) => openEntry(id)}
        fitKey={`${today}:${shownIds.join(',')}:${todays.length}`}
        {...(lastKnown ? { fallback: lastKnown } : {})}
      />
      <StatsBar stats={stats} writers={writers} />
      <div className="legend">
        {dayNo >= 1 ? `Tag ${dayNo} · ` : ''}
        {formatDateLong(today)}
        {boats.length > 1 ? ` · ${selected ? selected.name : 'alle Boote'}` : ''}
      </div>
      {todays.length === 0 ? (
        <p className="muted">
          {readOnly
            ? 'Heute noch kein Eintrag.'
            : `Heute noch kein Eintrag${selected && boats.length > 1 ? ` für ${selected.name}` : ''}. Tippe auf „Eintrag jetzt“, um Position und Uhrzeit festzuhalten.`}
        </p>
      ) : (
        <Timeline entries={[...todays].sort((a, b) => b.time - a.time)} onOpen={(id) => openEntry(id)} showBoat={multi} />
      )}
    </main>
  );
}
