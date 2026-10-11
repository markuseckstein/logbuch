import { useEffect, useRef } from 'react';
import { useLiveQuery, useObservable } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { adoptOwnTrips } from '../../db/cloud';
import { isSharedRealm } from '../../domain';
import { useCloudUser } from '../cloudHooks';

const NOTHING = {
  subscribe: (next: (v: undefined) => void) => {
    next(undefined);
    return { unsubscribe: () => undefined };
  },
  getValue: () => undefined,
};

/**
 * Nach der Anmeldung (sobald der erste Abgleich durch ist): eigene lokale/private Törns in ihren Realm bringen,
 * die eigene Person mit dem Konto verknüpfen und vorgemerkte Einladungen senden. Läuft erneut, wenn ein
 * ungeteilter Törn auftaucht (z. B. Datei-Import).
 */
export function CloudAdopter() {
  const user = useCloudUser();
  const synced = useObservable(db.cloudEnabled ? db.cloud.persistedSyncState : NOTHING, undefined);
  const unshared = useLiveQuery(
    async () => (await db.trips.toArray()).filter((t) => !isSharedRealm(t.realmId)).map((t) => t.id).join(','),
    [],
  );
  const running = useRef(false);
  const loggedIn = user?.isLoggedIn === true;
  const ready = loggedIn && !!synced;
  useEffect(() => {
    if (!ready || running.current) return;
    running.current = true;
    adoptOwnTrips(db)
      .catch(() => undefined)
      .finally(() => {
        running.current = false;
      });
  }, [ready, unshared, user?.userId]);
  return null;
}
