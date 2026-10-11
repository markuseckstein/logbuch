import { createContext, useContext } from 'react';
import { useLiveQuery, useObservable } from 'dexie-react-hooks';
import type { DXCUserInteraction, Invite, SyncState, UserLogin } from 'dexie-cloud-addon';
import { db } from '../db/db';
import { cloudStatus, listMembers, type CloudStatus, type MemberInfo } from '../db/cloud';
import { canManageTrip, listWritableTripIds } from '../db/repo';
import type { ID } from '../domain';

interface Interop<T> {
  subscribe(next: (x: T) => unknown): { unsubscribe(): unknown };
  getValue(): T;
}

/** Konstante Observable für den lokalen Modus (kein Addon, kein db.cloud). */
function constant<T>(value: T): Interop<T> {
  return {
    subscribe(next) {
      next(value);
      return { unsubscribe: () => undefined };
    },
    getValue: () => value,
  };
}

const NO_USER = constant<UserLogin | undefined>(undefined);
const NO_SYNC = constant<SyncState | undefined>(undefined);
const NO_INVITES = constant<Invite[]>([]);
const NO_INTERACTION = constant<DXCUserInteraction | undefined>(undefined);

export const cloudEnabled = (): boolean => db.cloudEnabled;

export function useCloudUser(): UserLogin | undefined {
  return useObservable(db.cloudEnabled ? db.cloud.currentUser : NO_USER, undefined);
}

export function useSyncState(): SyncState | undefined {
  return useObservable(db.cloudEnabled ? db.cloud.syncState : NO_SYNC, undefined);
}

export function useCloudStatus(): CloudStatus {
  return cloudStatus(db.cloudEnabled, useCloudUser(), useSyncState());
}

/** Offene Einladungen (noch nicht angenommen/abgelehnt). */
export function useInvites(): Invite[] {
  const all = useObservable(db.cloudEnabled ? db.cloud.invites : NO_INVITES, []);
  return all.filter((i) => !i.accepted && !i.rejected);
}

/** Vom Addon angeforderte Eingabe (E-Mail, Code, Hinweis, Abmelde-Bestätigung) – eigene Dialoge. */
export function useUserInteraction(): DXCUserInteraction | undefined {
  return useObservable(db.cloudEnabled ? db.cloud.userInteraction : NO_INTERACTION, undefined);
}

/** Von `Root` bereitgestellt (wie die Einstellungen): sofort verfügbar, kein Flackern beim Tab-Wechsel. */
export const WritableTripsContext = createContext<ID[] | undefined>(undefined);

/** Beschreibbare Trips: lokal `writableTripIds`, geteilte Cloud-Logbücher nach Server-Rechten. */
export function useWritableTripIds(): ID[] | undefined {
  const provided = useContext(WritableTripsContext);
  const userId = useCloudUser()?.userId;
  const own = useLiveQuery(() => (provided ? undefined : listWritableTripIds(db)), [userId, provided]);
  return provided ?? own;
}

export function useCanManage(tripId: ID): boolean {
  const userId = useCloudUser()?.userId;
  return useLiveQuery(() => canManageTrip(db, tripId), [tripId, userId]) ?? false;
}

export function useMembers(tripId: ID): MemberInfo[] {
  const userId = useCloudUser()?.userId;
  return useLiveQuery(() => listMembers(db, tripId), [tripId, userId]) ?? [];
}

const NO_PERSISTED = constant<{ timestamp?: Date } | undefined>(undefined);

/** Zeitpunkt des letzten erfolgreichen Abgleichs (epoch ms). */
export function useLastSyncAt(): number | undefined {
  const s = useObservable(db.cloudEnabled ? db.cloud.persistedSyncState : NO_PERSISTED, undefined);
  return s?.timestamp ? new Date(s.timestamp).getTime() : undefined;
}
