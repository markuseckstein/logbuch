import type { DayStats } from '../../domain';
import { formatUnderway, num1 } from '../lib';

export function StatsBar({ stats }: { stats: DayStats }) {
  return (
    <div className="stats">
      <div>
        <b>{num1(stats.distanceNm)}</b>
        <span>sm</span>
      </div>
      <div>
        <b>{formatUnderway(stats.underwayMin)}</b>
        <span>Fahrtzeit h</span>
      </div>
      <div>
        <b>{stats.entryCount}</b>
        <span>Einträge</span>
      </div>
    </div>
  );
}
