import type { CloudStatus } from '../../db/cloud';
import { Icon, type IconName } from '../icons';
import { useCloudStatus } from '../cloudHooks';

const ICON: Record<Exclude<CloudStatus, 'local' | 'signed-out'>, IconName> = {
  'in-sync': 'wolke-ok',
  syncing: 'wolke-sync',
  offline: 'wolke-aus',
  error: 'wolke-fehler',
};

const LABEL: Record<Exclude<CloudStatus, 'local' | 'signed-out'>, string> = {
  'in-sync': 'Alles übertragen',
  syncing: 'Wird übertragen',
  offline: 'Offline – wird später übertragen',
  error: 'Übertragen fehlgeschlagen',
};

/** Kleines Wolken-Symbol in der Topbar; nur sichtbar, wenn angemeldet. */
export function SyncIndicator() {
  const status = useCloudStatus();
  if (status === 'local' || status === 'signed-out') return null;
  return (
    <span className="sync-ind" data-status={status} role="img" aria-label={LABEL[status]} title={LABEL[status]}>
      <Icon name={ICON[status]} size={20} />
    </span>
  );
}
