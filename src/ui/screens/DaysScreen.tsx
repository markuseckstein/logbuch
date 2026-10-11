import { useMemo, useState } from 'react';
import { db } from '../../db/db';
import { MAX_PHOTOS_PER_DAY_REPORT, removePhotoFromDayReport, upsertDayReport } from '../../db/repo';
import { useTripCrew } from '../../db/hooks';
import { formatDateLong, type DayReport, type Trip } from '../../domain';
import { useApp } from '../AppContext';
import { useAuthorId, useReadOnly, useTripDays } from '../hooks';
import { Icon } from '../icons';
import { authorName, num1, sectionPhotoIds, writeErrorMessage, type DayInfo } from '../lib';
import { useEnsureAuthor } from '../useEnsureAuthor';
import { usePhotoImport } from '../photoImport';
import { useToast } from '../toast';
import { PhotoGrid } from '../components/PhotoImage';
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

export function ReportEditor({
  tripId, day, section, ensureAuthor, label,
}: { tripId: string; day: DayInfo; section: DayReport | undefined; ensureAuthor: () => Promise<boolean>; label: string }) {
  const toast = useToast();
  const [title, setTitle] = useState(section?.title ?? '');
  const [text, setText] = useState(section?.text ?? '');
  const save = async (): Promise<void> => {
    const t = title.trim();
    try {
      if (!(await ensureAuthor())) return;
      await upsertDayReport(db, tripId, day.date, t ? { title: t, text } : { text });
      toast(`Tagesbericht Tag ${day.no} gespeichert`);
    } catch (e) {
      toast(writeErrorMessage(e, 'Tagesbericht konnte nicht gespeichert werden'));
    }
  };
  return (
    <section className="card" aria-label="Tagesbericht">
      <div className="legend">{label}</div>
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

/** Abschnitt eines anderen Autors (oder jeder Abschnitt in einem fremden Logbuch), nur lesbar. */
function SectionCard({ section, name }: { section: DayReport; name: string }) {
  return (
    <section className="card section-card" aria-label={`Tagesbericht von ${name}`}>
      <h3>{name}</h3>
      {section.title?.trim() ? <b>{section.title.trim()}</b> : null}
      {section.text.trim() ? <p className="section-text">{section.text}</p> : null}
      <PhotoGrid photoIds={section.photoIds} />
    </section>
  );
}

function DayPhotos({
  tripId, day, own, total, allIds, ensureAuthor,
}: { tripId: string; day: DayInfo; own: DayReport | undefined; total: number; allIds: readonly string[]; ensureAuthor: () => Promise<boolean> }) {
  const toast = useToast();
  const photoIds = own?.photoIds ?? [];
  const { onAdd: add, progress } = usePhotoImport({ kind: 'report', tripId, date: day.date, photoIds: allIds });
  const onAdd = async (files: File[]): Promise<void> => {
    if (await ensureAuthor()) await add(files);
  };
  const onRemove = async (photoId: string): Promise<void> => {
    try {
      await removePhotoFromDayReport(db, tripId, day.date, photoId);
      toast('Foto entfernt');
    } catch (e) {
      toast(writeErrorMessage(e, 'Foto konnte nicht entfernt werden'));
    }
  };
  return (
    <section className="card" aria-label="Fotos des Tages">
      <div className="legend">Fotos des Tages</div>
      <PhotoPicker
        maxCount={MAX_PHOTOS_PER_DAY_REPORT}
        photoIds={photoIds}
        totalCount={total}
        countText={`${total} / ${MAX_PHOTOS_PER_DAY_REPORT} heute`}
        onAdd={onAdd}
        onRemove={onRemove}
        progress={progress}
      />
    </section>
  );
}

function DayView({ trip, day, onBack }: { trip: Trip; day: DayInfo; onBack: () => void }) {
  const { openEntry } = useApp();
  const readOnly = useReadOnly(trip.id);
  const authorId = useAuthorId(trip.id) ?? '';
  const crew = useTripCrew(trip.id);
  const { ensure, dialog } = useEnsureAuthor(trip);
  const routes = useMemo(() => [{ id: day.date, points: day.route }], [day]);
  const nameOf = (id: string): string => authorName(crew, id) ?? (id ? 'Unbekannt' : 'Ohne Autor');
  const own = readOnly ? undefined : day.sections.find((s) => s.authorId === authorId);
  const others = day.sections.filter((s) => (readOnly || s !== own) && (s.text.trim() || s.title?.trim() || s.photoIds.length));
  const allIds = sectionPhotoIds(day.sections);
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
      {readOnly ? null : (
        <ReportEditor
          key={`${trip.id}-${day.date}-${authorId}`}
          tripId={trip.id}
          day={day}
          section={own}
          ensureAuthor={ensure}
          label={crew.length > 1 && authorId ? `Tagesbericht · ${nameOf(authorId)}` : 'Tagesbericht'}
        />
      )}
      {others.map((s) => (
        <SectionCard key={s.authorId} section={s} name={nameOf(s.authorId)} />
      ))}
      {readOnly && others.length === 0 ? <p className="muted">Kein Tagesbericht für diesen Tag.</p> : null}
      {readOnly ? null : (
        <DayPhotos tripId={trip.id} day={day} own={own} total={allIds.length} allIds={allIds} ensureAuthor={ensure} />
      )}
      {dialog}
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
