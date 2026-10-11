import {
  ENTRY_TYPE_LABELS,
  SEA_STATE_LABELS,
  SKY_LABELS,
  formatTime,
  formatWind,
  type LogEntry,
} from '../../domain';
import { PhotoGrid } from './PhotoImage';

/** Nur-Lese-Ansicht eines Eintrags (fremdes Logbuch). */
export function EntryReadOnly({ entry }: { entry: LogEntry }) {
  const wind = formatWind(entry.windDirDeg, entry.windBft);
  const facts: [string, string][] = [
    ['Zeit', formatTime(entry.time, entry.tzOffsetMin)],
    ['Typ', ENTRY_TYPE_LABELS[entry.type]],
  ];
  if (wind) facts.push(['Wind', wind]);
  if (entry.sky) facts.push(['Wetter', SKY_LABELS[entry.sky]]);
  if (entry.seaState) facts.push(['Seegang', SEA_STATE_LABELS[entry.seaState]]);
  if (entry.pressureHpa !== undefined) facts.push(['Luftdruck', `${entry.pressureHpa} hPa`]);
  if (entry.tempC !== undefined) facts.push(['Temperatur', `${entry.tempC} °C`]);
  return (
    <>
      <dl className="entry-facts">
        {facts.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {entry.text ? <p className="section-text" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{entry.text}</p> : null}
      <PhotoGrid photoIds={entry.photoIds} />
    </>
  );
}
