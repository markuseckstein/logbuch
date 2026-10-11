import { useTripCrew } from '../../db/hooks';
import {
  ENTRY_TYPE_LABELS,
  SKY_LABELS,
  compass16ToDeg,
  formatPosition,
  formatTime,
  degToCompass16,
  type ID,
  type LogEntry,
} from '../../domain';
import { ENTRY_ICON, Icon, SKY_ICON } from '../icons';
import { authorName, initials } from '../lib';
import { PhotoImage } from './PhotoImage';
import { sectorIndex } from './WindRose';

function Thumb({ photoId }: { photoId: ID }) {
  return (
    <span className="thumb">
      <PhotoImage photoId={photoId} alt="Foto" />
    </span>
  );
}

function WindChip({ entry }: { entry: LogEntry }) {
  const { windDirDeg, windBft } = entry;
  if (windDirDeg === undefined && windBft === undefined) return null;
  return (
    <span className="wind num">
      {windDirDeg !== undefined ? (
        <>
          <svg
            viewBox="0 0 24 24"
            style={{ transform: `rotate(${compass16ToDeg(sectorIndex(windDirDeg)) + 180}deg)` }}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M12 20V4M6 10l6-6 6 6" />
          </svg>
          {degToCompass16(windDirDeg)}
        </>
      ) : null}
      {windBft !== undefined ? ` ${windBft} Bft` : ''}
    </span>
  );
}

interface TimelineProps {
  entries: readonly LogEntry[];
  onOpen: (entryId: ID) => void;
}

export function Timeline({ entries, onOpen }: TimelineProps) {
  const crew = useTripCrew(entries[0]?.tripId);
  const showAuthor = crew.length > 1;
  return (
    <ol className="tl">
      {entries.map((e) => {
        const time = formatTime(e.time, e.tzOffsetMin);
        const label = ENTRY_TYPE_LABELS[e.type];
        const author = showAuthor ? authorName(crew, e.authorId) : undefined;
        return (
          <li key={e.id}>
            <button className="tl-item" type="button" aria-label={`Eintrag ${time} ${label} öffnen`} onClick={() => onOpen(e.id)}>
              <span className="tl-time">{time}</span>
              <span className="tl-dot">
                <Icon name={ENTRY_ICON[e.type]} size={15} />
              </span>
              <span className="tl-body">
                <span className="tl-head">
                  <b>{label}</b>
                  {author ? (
                    <span className="author" title={`von ${author}`}>
                      {initials(author)}
                      <span className="sr-only"> von {author}</span>
                    </span>
                  ) : null}
                  <WindChip entry={e} />
                  {e.sky ? (
                    <span className="wind" style={{ background: 'none', border: 0, padding: 0 }} title={SKY_LABELS[e.sky]}>
                      <Icon name={SKY_ICON[e.sky]} size={18} />
                      <span className="sr-only">{SKY_LABELS[e.sky]}</span>
                    </span>
                  ) : null}
                </span>
                <span className="pos">{e.position ? formatPosition(e.position) : 'ohne Position'}</span>
                {e.text ? <span className="tl-text">{e.text}</span> : null}
                {e.photoIds.length ? (
                  <span className="thumbs">
                    {e.photoIds.map((id) => (
                      <Thumb key={id} photoId={id} />
                    ))}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
