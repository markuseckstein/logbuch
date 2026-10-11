import { useMemo, useState } from 'react';
import { db } from '../../db/db';
import { MAX_PHOTOS_PER_DAY_REPORT, removePhotoFromDayReport, upsertDayReport } from '../../db/repo';
import { formatDateLong, type Trip } from '../../domain';
import { useApp } from '../AppContext';
import { useTripDays } from '../hooks';
import { Icon } from '../icons';
import { num1, type DayInfo } from '../lib';
import { usePhotoImport } from '../photoImport';
import { useToast } from '../toast';
import { PhotoPicker } from '../components/PhotoPicker';
import { ChartMap } from '../components/ChartMap';
import { StatsBar } from '../components/StatsBar';
import { Timeline } from '../components/Timeline';

const summary = (d: DayInfo): string => `${num1(d.stats.distanceNm)} sm · ${d.stats.entryCount} Einträge`;

function DayCard({ day, onOpen }: { day: DayInfo; onOpen: () => void }) {
  const title = day.report?.title?.trim();
  const text = day.report?.text.trim();
  return (
    <button
      className="daycard"
      type="button"
      onClick={onOpen}
      aria-label={`Tag ${day.no}, ${formatDateLong(day.date)} öffnen`}
    >
      <span className="dn">
        Tag<b>{day.no}</b>
      </span>
      <span>
        <span className="dmeta">{formatDateLong(day.date)}</span>
        <br />
        <span className="route">{title || summary(day)}</span>
        {title ? (
          <>
            <br />
            <span className="dmeta">{summary(day)}</span>
          </>
        ) : null}
        <p className="lead">{text || 'Noch kein Tagesbericht.'}</p>
      </span>
    </button>
  );
}

export function ReportEditor({ tripId, day }: { tripId: string; day: DayInfo }) {
  const toast = useToast();
  const [title, setTitle] = useState(day.report?.title ?? '');
  const [text, setText] = useState(day.report?.text ?? '');
  const save = async (): Promise<void> => {
    const t = title.trim();
    await upsertDayReport(db, tripId, day.date, t ? { title: t, text } : { text });
    toast(`Tagesbericht Tag ${day.no} gespeichert`);
  };
  return (
    <section className="card" aria-label="Tagesbericht">
      <div className="legend">Tagesbericht</div>
      <label className="f">
        <span>Titel (optional)</span>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="f">
        <span>Reisebericht</span>
        <textarea className="report-text" value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <button className="btn primary block" type="button" onClick={() => void save()}>
        Tagesbericht speichern
      </button>
    </section>
  );
}

function DayPhotos({ tripId, day }: { tripId: string; day: DayInfo }) {
  const toast = useToast();
  const photoIds = day.report?.photoIds ?? [];
  const { onAdd, progress } = usePhotoImport({ kind: 'report', tripId, date: day.date, photoIds });
  const onRemove = async (photoId: string): Promise<void> => {
    try {
      await removePhotoFromDayReport(db, tripId, day.date, photoId);
      toast('Foto entfernt');
    } catch {
      toast('Foto konnte nicht entfernt werden');
    }
  };
  return (
    <section className="card" aria-label="Fotos des Tages">
      <div className="legend">Fotos des Tages</div>
      <PhotoPicker
        maxCount={MAX_PHOTOS_PER_DAY_REPORT}
        photoIds={photoIds}
        onAdd={onAdd}
        onRemove={onRemove}
        progress={progress}
      />
    </section>
  );
}

function DayView({ trip, day, onBack }: { trip: Trip; day: DayInfo; onBack: () => void }) {
  const { openEntry } = useApp();
  const routes = useMemo(() => [{ id: day.date, points: day.route }], [day]);
  return (
    <main className="screen" aria-labelledby="screen-title">
      <button className="back" type="button" onClick={onBack}>
        <Icon name="chev-l" size={20} />
        Törn-Tage
      </button>
      <div>
        <div className="dmeta">
          Tag {day.no} · {formatDateLong(day.date)}
        </div>
        <h2 id="screen-title">{day.report?.title?.trim() || `Tag ${day.no}`}</h2>
      </div>
      <ChartMap
        compact
        label={`Karte Tag ${day.no}`}
        routes={routes}
        entries={day.entries}
        onOpenEntry={(id) => openEntry(id)}
        fitKey={`${day.date}:${day.entries.length}:${day.route.length}`}
      />
      <StatsBar stats={day.stats} />
      <ReportEditor key={`${trip.id}-${day.date}`} tripId={trip.id} day={day} />
      <DayPhotos tripId={trip.id} day={day} />
      <div className="legend">Einträge</div>
      {day.entries.length === 0 ? (
        <p className="muted">An diesem Tag gibt es noch keine Einträge.</p>
      ) : (
        <Timeline entries={day.entries} onOpen={(id) => openEntry(id)} />
      )}
    </main>
  );
}

export function DaysScreen({ trip }: { trip: Trip }) {
  const data = useTripDays(trip);
  const [selected, setSelected] = useState<string>();
  if (!data) return null;
  const day = data.days.find((d) => d.date === selected);
  if (day) return <DayView trip={trip} day={day} onBack={() => setSelected(undefined)} />;
  return (
    <main className="screen" aria-labelledby="screen-title">
      <h2 id="screen-title">Törn-Tage</h2>
      <div className="muted">Tippe auf einen Tag für Tagesbericht und Einträge.</div>
      {data.days.length === 0 ? (
        <p className="muted">Noch keine Tage. Sobald du einen Eintrag machst, erscheint hier der erste Törntag.</p>
      ) : (
        <div>
          {data.days.map((d) => (
            <DayCard key={d.date} day={d} onOpen={() => setSelected(d.date)} />
          ))}
        </div>
      )}
    </main>
  );
}
