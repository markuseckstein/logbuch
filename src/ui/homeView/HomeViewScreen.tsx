import { useEffect, useMemo, useState } from 'react';
import { useAllBoats, useBoats, usePhotoUrl, useTripCrew } from '../../db/hooks';
import {
  ENTRY_TYPE_LABELS, coverPosition, formatAgo, formatDateLong, formatTime, lastUpdatedAt, latestPosition, type Boat, type DayReport,
  type ID, type LogEntry, type Trip,
} from '../../domain';
import { BoatBadge, BoatShape } from '../boats';
import { useTripDays } from '../hooks';
import { ENTRY_ICON, Icon } from '../icons';
import { authorName, boatLayers, currentTzOffsetMin, num1, photoCaption, tripPeriod, type DayInfo } from '../lib';
import { ChartMap } from '../components/ChartMap';
import { PhotoGrid } from '../components/PhotoImage';

function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Touch-Gerät ohne Maus: dort lässt die ruhige Karte das Ein-Finger-Verschieben weg. */
const touchOnly = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;

function Hero({ trip }: { trip: Trip }) {
  const url = usePhotoUrl(trip.coverPhotoId);
  const meta = [tripPeriod(trip), trip.area].filter(Boolean).join(' · ');
  const title = (
    <div className="hero-t">
      <h1 id="home-title">{trip.name}</h1>
      {meta ? <div>{meta}</div> : null}
    </div>
  );
  return trip.coverPhotoId && url ? (
    <div className="hero">
      <img src={url} alt="" style={{ objectPosition: coverPosition(trip.coverFocus) }} />
      {title}
    </div>
  ) : (
    <div className="hero empty-cover">{title}</div>
  );
}

function Section({ section, name, dayNo }: { section: DayReport; name: string; dayNo: number }) {
  const time = formatTime(section.updatedAt, currentTzOffsetMin());
  return (
    <article className="rep" aria-label={`Tagesbericht von ${name}`}>
      <div className="rep-h">
        <b>{name}</b>
        <span className="num">{time} Uhr</span>
      </div>
      {section.title?.trim() ? <p><b>{section.title.trim()}</b></p> : null}
      {section.text.trim() ? <p>{section.text}</p> : null}
      <PhotoGrid photoIds={section.photoIds} className="home-photos" caption={photoCaption([`Tag ${dayNo}`, name, `${time} Uhr`])} />
    </article>
  );
}

function Entry({ entry, boat, showBoat, author }: {
  entry: LogEntry; boat: Boat | undefined; showBoat: boolean; author: string | undefined;
}) {
  const label = ENTRY_TYPE_LABELS[entry.type];
  const time = formatTime(entry.time, entry.tzOffsetMin);
  return (
    <li className="home-entry">
      <span className="home-entry-h">
        <span className="num">{time}</span>
        <Icon name={ENTRY_ICON[entry.type]} size={20} />
        <b>{label}</b>
        {showBoat && boat ? <BoatBadge boat={boat} /> : null}
        {author ? <span className="who">{author}</span> : null}
      </span>
      {entry.text ? <p>{entry.text}</p> : null}
      <PhotoGrid photoIds={entry.photoIds} className="home-photos" caption={photoCaption([time, boat?.name, author])} />
    </li>
  );
}

function Day({ day, boats, crewName }: {
  day: DayInfo; boats: readonly Boat[]; crewName: (id: ID | undefined) => string | undefined;
}) {
  const sections = [...day.sections].filter((s) => s.text.trim() || s.title?.trim() || s.photoIds.length).sort((a, b) => a.updatedAt - b.updatedAt);
  const entries = [...day.entries].sort((a, b) => b.time - a.time);
  return (
    <section className="card home-day" aria-label={`Tag ${day.no}`}>
      <h2>
        Tag {day.no} · {formatDateLong(day.date)}
      </h2>
      <div className="dmeta">
        {num1(day.stats.distanceNm)} sm · {day.stats.entryCount} {day.stats.entryCount === 1 ? 'Eintrag' : 'Einträge'}
      </div>
      {sections.map((s) => (
        <Section key={s.id} section={s} name={crewName(s.authorId) ?? 'Crew'} dayNo={day.no} />
      ))}
      {entries.length ? (
        <ol className="home-entries" aria-label={`Einträge Tag ${day.no}`}>
          {entries.map((e) => (
            <Entry
              key={e.id}
              entry={e}
              boat={boats.find((b) => b.id === e.boatId)}
              showBoat={boats.length > 1}
              author={crewName(e.authorId)}
            />
          ))}
        </ol>
      ) : null}
    </section>
  );
}

/**
 * Daheim-Ansicht: vereinfacht, nur lesen, große Schrift. Cover, „Zuletzt aktualisiert“, Karte aller Boote mit
 * letzter Position, darunter die Tage (neueste zuerst) mit Tagesberichten, Einträgen und Fotos. Aktualisiert sich
 * live (liveQuery über den normalen Dexie-Sync).
 */
export function HomeViewScreen({ trip }: { trip: Trip }) {
  const data = useTripDays(trip);
  const loadedBoats = useBoats(trip.id);
  const boats = useMemo(() => loadedBoats ?? [], [loadedBoats]);
  const allBoats = useAllBoats(trip.id);
  const crew = useTripCrew(trip.id);
  const now = useNow();
  const layers = useMemo(() => {
    if (!data) return [];
    return boatLayers(trip, boats, data.entries, data.tracks, { labels: boats.length > 1 }).map((l) => ({
      ...l,
      last: latestPosition(
        data.entries.filter((e) => e.boatId === l.id),
        data.tracks.filter((t) => t.boatId === l.id),
      ),
    }));
  }, [trip, boats, data]);
  if (!data) return <p className="muted home-pad">Törn wird geladen …</p>;
  const reports = data.days.flatMap((d) => d.sections);
  const last = lastUpdatedAt({ entries: data.entries, dayReports: reports, tracks: data.tracks });
  const crewName = (id: ID | undefined): string | undefined => authorName(crew, id);
  const days = [...data.days].reverse();
  return (
    <div id="app" className="home">
      <header className="topbar">
        <div className="brand">
          <b>Logbuch · Daheim</b>
          <span>Live vom Törn</span>
        </div>
      </header>
      <main className="screen" aria-labelledby="home-title">
        <Hero trip={trip} />
        <p className="home-updated" role="status">
          <Icon name="wolke-ok" size={22} />
          {last === undefined ? 'Noch keine Einträge' : `Zuletzt aktualisiert ${formatAgo(last, now)}`}
        </p>
        <ChartMap calm label="Karte aller Boote" layers={layers} fitKey={`${data.entries.length}:${data.tracks.length}`} />
        {touchOnly ? <p className="muted home-maphint">Zum Verschieben der Karte zwei Finger benutzen.</p> : null}
        <ul className="home-boats" aria-label="Boote">
          {boats.map((b) => (
            <li key={b.id}>
              <BoatShape boat={b} size={18} />
              <b>{b.name}</b>
              {b.model ? <span className="muted">{b.model}</span> : null}
            </li>
          ))}
        </ul>
        {days.length === 0 ? (
          <p className="muted">Sobald die Crew etwas einträgt, erscheint es hier.</p>
        ) : (
          days.map((d) => <Day key={d.date} day={d} boats={allBoats} crewName={crewName} />)
        )}
      </main>
    </div>
  );
}
