import { createContext, useContext } from 'react';
import { useLiveQuery, useObservable } from 'dexie-react-hooks';
import type { DXCUserInteraction, Invite, SyncState, UserLogin } from 'dexie-cloud-addon';
import { db } from '../db/db';
import { cloudStatus, listPeople, type CloudStatus, type PersonInfo } from '../db/cloud';
import { getAuthor, listWritableTripIds, tripAccess, type TripAccess } from '../db/repo';
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

const NO_SYNC_STATE = constant<{ realms?: string[] } | undefined>(undefined);

/** Vom Server bestätigte Realms als Schlüssel: Rechte neu berechnen, sobald eine Mitgliedschaft wirksam wird. */
function useServerRealmsKey(): string {
  const s = useObservable(db.cloudEnabled ? db.cloud.persistedSyncState : NO_SYNC_STATE, undefined);
  return (s?.realms ?? []).join(' ');
}

/** Von `Root` bereitgestellt (wie die Einstellungen): sofort verfügbar, kein Flackern beim Tab-Wechsel. */
export const WritableTripsContext = createContext<ID[] | undefined>(undefined);

/** Beschreibbare Törns: lokal alle, geteilte nach Server-Rechten (Mitgliedschaft vom Server bestätigt). */
export function useWritableTripIds(): ID[] | undefined {
  const provided = useContext(WritableTripsContext);
  const userId = useCloudUser()?.userId;
  const realms = useServerRealmsKey();
  const own = useLiveQuery(() => (provided ? undefined : listWritableTripIds(db)), [userId, provided, realms]);
  return provided ?? own;
}

const LOADING_ACCESS: TripAccess = { admin: false, canWrite: false };

/** Rechte im Törn; undefined, solange sie geladen werden. */
export function useTripAccessState(tripId: ID): TripAccess | undefined {
  const userId = useCloudUser()?.userId;
  const realms = useServerRealmsKey();
  return useLiveQuery(() => tripAccess(db, tripId), [tripId, userId, realms]);
}

/** Rechte im Törn (Admin, Schreiben, angemeldeter Nutzer); während des Ladens: nichts erlaubt. */
export function useTripAccess(tripId: ID): TripAccess {
  return useTripAccessState(tripId) ?? LOADING_ACCESS;
}

export function useCanManage(tripId: ID): boolean {
  return useTripAccess(tripId).admin;
}

/** Personen des Törns mit Einladungsstand. */
export function usePeople(tripId: ID): PersonInfo[] {
  const userId = useCloudUser()?.userId;
  return useLiveQuery(() => listPeople(db, tripId), [tripId, userId]) ?? [];
}

/** Id der eigenen Person (Autor) im Törn. */
export function useMyCrewId(tripId: ID): ID | undefined {
  const user = useCloudUser();
  return useLiveQuery(() => getAuthor(db, tripId), [tripId, user?.userId, user?.email]);
}

const NO_PERSISTED = constant<{ timestamp?: Date } | undefined>(undefined);

/** Zeitpunkt des letzten erfolgreichen Abgleichs (epoch ms). */
export function useLastSyncAt(): number | undefined {
  const s = useObservable(db.cloudEnabled ? db.cloud.persistedSyncState : NO_PERSISTED, undefined);
  return s?.timestamp ? new Date(s.timestamp).getTime() : undefined;
}
