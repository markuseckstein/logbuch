import { useMemo, useState } from 'react';
import { db } from '../../db/db';
import {
  MAX_PHOTOS_PER_DAY_REPORT, deleteDayReport, removePhotoFromDayReport, upsertDayReport,
} from '../../db/repo';
import { useTracks, useTripCrew } from '../../db/hooks';
import { canEditRecord, formatDateLong, formatTime, type DayReport, type ID, type Trip } from '../../domain';
import { useApp } from '../AppContext';
import { BoatBadge, useBoatSelection } from '../boats';
import { useMyCrewId, useTripAccess } from '../cloudHooks';
import { useReadOnly, useTripDays } from '../hooks';
import { Icon } from '../icons';
import {
  authorName, boatLayers, currentTzOffsetMin, groupTrackPoints, initials, num1, sectionPhotoIds, selectionDayStats,
  writeErrorMessage, type DayInfo,
} from '../lib';
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

interface SectionProps {
  tripId: ID;
  day: DayInfo;
  /** Abschnitt (fehlt beim noch nicht geschriebenen eigenen Abschnitt). */
  section: DayReport | undefined;
  authorId: ID;
  name: string;
  mine: boolean;
  admin: boolean;
  editable: boolean;
  ensureAuthor: () => Promise<boolean>;
}

/** Ein Abschnitt des Tagesberichts: Name + Uhrzeit, Text, Fotos; eigener (Admin: jeder) bearbeitbar. */
function ReportSection({ tripId, day, section, authorId, name, mine, admin, editable, ensureAuthor }: SectionProps) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [title, setTitle] = useState(section?.title ?? '');
  const [text, setText] = useState(section?.text ?? '');
  const startEdit = (): void => {
    setTitle(section?.title ?? '');
    setText(section?.text ?? '');
    setEditing(true);
  };
  const save = async (): Promise<void> => {
    if (!text.trim() && !title.trim()) {
      toast('Bitte einen kurzen Text eingeben');
      return;
    }
    try {
      if (mine && !(await ensureAuthor())) return;
      const t = title.trim();
      await upsertDayReport(db, tripId, day.date, t ? { title: t, text } : { text }, mine ? undefined : authorId);
      setEditing(false);
      toast(mine ? 'Dein Abschnitt ist gespeichert' : `Abschnitt von ${name} gespeichert (Admin)`);
    } catch (e) {
      toast(writeErrorMessage(e, 'Tagesbericht konnte nicht gespeichert werden'));
    }
  };
  const remove = async (): Promise<void> => {
    try {
      await deleteDayReport(db, tripId, day.date, mine ? undefined : authorId);
      setConfirming(false);
      setEditing(false);
      toast('Abschnitt gelöscht');
    } catch (e) {
      toast(writeErrorMessage(e, 'Abschnitt konnte nicht gelöscht werden'));
    }
  };
  const time = section ? formatTime(section.updatedAt, currentTzOffsetMin()) : undefined;
  const cls = ['rep', mine ? 'mine' : '', section ? '' : 'new'].filter(Boolean).join(' ');
  return (
    <article className={cls} aria-label={`Tagesbericht von ${name}`}>
      <div className="rep-h">
        <i className="av sm" aria-hidden="true">{initials(name)}</i>
        <b>
          {name}
          {mine ? <span className="who me"> (du)</span> : null}
        </b>
        {time ? <span className="num">{time} Uhr</span> : null}
      </div>
      {editing ? (
        <>
          <label className="f">
            <span>Titel (optional)</span>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="f">
            <span>{mine ? 'Dein Abschnitt' : `Abschnitt von ${name}`}</span>
            <textarea
              className="report-text"
              placeholder="Kurze Zusammenfassung des Tages …"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <div className="rep-act">
            <button className="btn primary sm" type="button" onClick={() => void save()}>
              Speichern
            </button>
            <button className="btn sm" type="button" onClick={() => setEditing(false)}>
              Abbrechen
            </button>
            {section ? (
              <button className="btn danger sm" type="button" onClick={() => setConfirming(true)}>
                Löschen
              </button>
            ) : null}
          </div>
          {confirming ? (
            <div className="confirm" role="alertdialog" aria-label="Löschen bestätigen" style={{ marginTop: 10 }}>
              <p>Abschnitt wirklich löschen?</p>
              <button className="btn sm" type="button" autoFocus onClick={() => setConfirming(false)}>
                Abbrechen
              </button>
              <button className="btn danger sm" type="button" onClick={() => void remove()}>
                Endgültig löschen
              </button>
            </div>
          ) : null}
        </>
      ) : section ? (
        <>
          {section.title?.trim() ? <p><b>{section.title.trim()}</b></p> : null}
          {section.text.trim() ? <p>{section.text}</p> : null}
          <PhotoGrid photoIds={section.photoIds} />
          {editable ? (
            <div className="rep-act">
              <button className="btn sm" type="button" onClick={startEdit}>
                <Icon name="edit" size={18} />
                Bearbeiten{!mine && admin ? ' (Admin)' : ''}
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <p className="muted">Noch kein Abschnitt von dir für diesen Tag.</p>
          <div className="rep-act">
            <button className="btn sm" type="button" onClick={startEdit}>
              <Icon name="plus" size={18} />
              Meinen Abschnitt schreiben
            </button>
          </div>
        </>
      )}
    </article>
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
      <div className="legend">Meine Fotos des Tages</div>
      <PhotoPicker
        maxCount={MAX_PHOTOS_PER_DAY_REPORT}
        photoIds={photoIds}
        totalCount={total}
        countText={`${total} / ${MAX_PHOTOS_PER_DAY_REPORT} an diesem Tag`}
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
  const access = useTripAccess(trip.id);
  const me = useMyCrewId(trip.id) ?? '';
  const crew = useTripCrew(trip.id);
  const allTracks = useTracks(trip.id);
  const { boats, shownIds } = useBoatSelection();
  const multi = shownIds.length > 1;
  const shown = boats.filter((b) => shownIds.includes(b.id));
  const { ensure, dialog } = useEnsureAuthor(trip);
  const tracks = useMemo(() => (allTracks ?? []).filter((t) => shownIds.includes(t.boatId)), [allTracks, shownIds]);
  const layers = useMemo(
    () => boatLayers(trip, shown, day.entries, tracks, { dates: [day.date], labels: multi }),
    [trip, shown, day, tracks, multi],
  );
  const tz = currentTzOffsetMin();
  const trackOf = (id: ID) => groupTrackPoints(tracks.filter((t) => t.boatId === id), tz).byDate[day.date];
  const { stats, writers } = selectionDayStats(day.entries, trackOf, shownIds);
  const nameOf = (id: string): string => authorName(crew, id) ?? (id ? 'Ehemaliges Mitglied' : 'Ohne Namen');
  const sections = [...day.sections].sort((a, b) => a.updatedAt - b.updatedAt);
  const own = sections.find((s) => s.authorId === me);
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
        layers={layers}
        onOpenEntry={(id) => openEntry(id)}
        fitKey={`${day.date}:${shownIds.join(',')}:${day.entries.length}`}
      />
      <StatsBar stats={stats} writers={writers} />
      {multi ? (
        <table className="dtbl" aria-label="Boote an diesem Tag">
          <tbody>
            {shown.map((b) => {
              const s = selectionDayStats(day.entries, trackOf, [b.id]).stats;
              return (
                <tr key={b.id}>
                  <td>
                    <BoatBadge boat={b} />
                  </td>
                  <td>
                    {num1(s.distanceNm)} sm · {s.entryCount} Einträge
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
      <div className="legend">Tagesbericht</div>
      <p className="muted">Jede Person schreibt ihren eigenen kurzen Abschnitt. Die Abschnitte stehen untereinander.</p>
      <div>
        {sections.map((s) => (
          <ReportSection
            key={`${s.authorId}-${s.updatedAt}`}
            tripId={trip.id}
            day={day}
            section={s}
            authorId={s.authorId}
            name={nameOf(s.authorId)}
            mine={s.authorId === me}
            admin={access.admin}
            editable={!readOnly && canEditRecord(s, access)}
            ensureAuthor={ensure}
          />
        ))}
        {!own && !readOnly ? (
          <ReportSection
            tripId={trip.id}
            day={day}
            section={undefined}
            authorId={me}
            name={me ? nameOf(me) : 'Du'}
            mine
            admin={access.admin}
            editable
            ensureAuthor={ensure}
          />
        ) : null}
        {readOnly && sections.length === 0 ? <p className="muted">Kein Tagesbericht für diesen Tag.</p> : null}
      </div>
      {readOnly ? null : (
        <DayPhotos tripId={trip.id} day={day} own={own} total={allIds.length} allIds={allIds} ensureAuthor={ensure} />
      )}
      {dialog}
      <div className="legend">Einträge</div>
      {day.entries.length === 0 ? (
        <p className="muted">An diesem Tag gibt es noch keine Einträge.</p>
      ) : (
        <Timeline entries={day.entries} onOpen={(id) => openEntry(id)} showBoat={multi} />
      )}
    </main>
  );
}

export function DaysScreen({ trip }: { trip: Trip }) {
  const { shownIds } = useBoatSelection();
  const data = useTripDays(trip, shownIds);
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
