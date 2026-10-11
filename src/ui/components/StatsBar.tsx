import type { DayStats } from '../../domain';
import { formatUnderway, num1 } from '../lib';

/** Tageswerte; bei mehreren Booten (`writers` gesetzt) Summe aller Boote statt Fahrtzeit. */
export function StatsBar({ stats, writers }: { stats: DayStats; writers?: number | undefined }) {
  return (
    <div className="stats">
      <div>
        <b>{num1(stats.distanceNm)}</b>
        <span>{writers === undefined ? 'sm' : 'sm gesamt'}</span>
      </div>
      {writers === undefined ? (
        <div>
          <b>{formatUnderway(stats.underwayMin)}</b>
          <span>Fahrtzeit h</span>
        </div>
      ) : null}
      <div>
        <b>{stats.entryCount}</b>
        <span>Einträge</span>
      </div>
      {writers !== undefined ? (
        <div>
          <b>{writers}</b>
          <span>Schreibende</span>
        </div>
      ) : null}
    </div>
  );
}
