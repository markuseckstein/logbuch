import { useEffect, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Invite } from 'dexie-cloud-addon';
import { db } from '../../db/db';
import { setActiveTrip } from '../../db/repo';
import { tripIdOfRealm, type ID } from '../../domain';
import { useInvites } from '../cloudHooks';
import { useToast } from '../toast';

// Nach „Annehmen“: Logbuch aktivieren, sobald es per Sync angekommen ist.
let pending: { tripId: ID } | undefined;
const listeners = new Set<() => void>();
const setPending = (p: typeof pending): void => {
  pending = p;
  listeners.forEach((l) => l());
};
const usePending = () =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => pending,
  );

/** Wartet, bis die Annahme beim Server ist (offline: bis die Verbindung wieder da ist). */
async function acceptanceUploaded(): Promise<void> {
  for (;;) {
    try {
      await db.cloud.sync({ wait: true, purpose: 'push' });
      await db.cloud.sync({ wait: true, purpose: 'pull' });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

/** „Jonas lädt dich in den Törn „Ostsee 2027“ ein“ */
export function inviteText(inv: Pick<Invite, 'invitedBy' | 'realm'>): string {
  const who = inv.invitedBy?.name?.trim() || inv.invitedBy?.email || 'Jemand';
  const trip = inv.realm?.name?.trim();
  return trip ? `${who} lädt dich in den Törn „${trip}“ ein` : `${who} lädt dich in einen Törn ein`;
}

/** Banner mit offenen Einladungen (Annehmen / Ablehnen). */
export function InviteBanner() {
  const invites = useInvites();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (invites.length === 0) return null;
  const act = async (inv: Invite, accept: boolean): Promise<void> => {
    setBusy(true);
    try {
      if (accept) {
        await inv.accept();
        toast('Einladung angenommen – der Törn wird geladen …', 4200);
        // Erst die Annahme hochladen und den Realm vom Server bestätigen lassen (Rechte wirken erst dann, siehe
        // domain/access). Falls der Server erste Einträge trotzdem ablehnt, rettet sie db/syncRejections.
        await acceptanceUploaded();
        const tripId = tripIdOfRealm(inv.realmId);
        if (tripId) setPending({ tripId });
      } else {
        await inv.reject();
        toast('Einladung abgelehnt');
      }
    } catch {
      toast('Das hat nicht geklappt – bitte später erneut versuchen');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {invites.map((inv) => (
        <div key={inv.id} className="banner invite-banner" role="region" aria-label="Einladung">
          <span>{inviteText(inv)}</span>
          <span className="actions">
            <button className="btn primary" type="button" disabled={busy} onClick={() => void act(inv, true)}>
              Annehmen
            </button>
            <button className="btn" type="button" disabled={busy} onClick={() => void act(inv, false)}>
              Ablehnen
            </button>
          </span>
        </div>
      ))}
    </>
  );
}

/** Aktiviert einen angenommenen Törn, sobald er da ist (der Boot-Schalter steht dann auf dem vorgeschlagenen Boot). */
export function JoinWatcher() {
  const p = usePending();
  const arrived = useLiveQuery(async () => (p ? ((await db.trips.get(p.tripId)) ?? null) : null), [p?.tripId]);
  useEffect(() => {
    if (!p || !arrived) return;
    setPending(undefined);
    void setActiveTrip(db, arrived.id);
  }, [p, arrived]);
  return null;
}
