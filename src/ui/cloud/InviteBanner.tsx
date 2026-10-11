import { useEffect, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Invite } from 'dexie-cloud-addon';
import { db } from '../../db/db';
import { getAuthor, listCrew, setActiveTrip } from '../../db/repo';
import { activeCrew, tripIdOfRealm, type ID } from '../../domain';
import { requestAuthorPrompt } from '../authorPrompt';
import { useInvites } from '../cloudHooks';
import { useToast } from '../toast';

// Nach „Annehmen“: Logbuch aktivieren, sobald es per Sync angekommen ist.
let pending: { tripId: ID; crew: boolean } | undefined;
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

/** „Jonas lädt dich in das Logbuch der Seeschwalbe ein“ */
export function inviteText(inv: Pick<Invite, 'invitedBy' | 'realm' | 'roles'>): string {
  const who = inv.invitedBy?.name?.trim() || inv.invitedBy?.email || 'Jemand';
  const boat = inv.realm?.name?.trim() || 'eines Boots';
  const ro = inv.roles?.includes('readonly') ? ' (nur lesen)' : '';
  return `${who} lädt dich in das Logbuch der ${boat} ein${ro}`;
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
        toast('Einladung angenommen – das Logbuch wird geladen …', 4200);
        // Erst die Annahme hochladen und den Realm vom Server bestätigen lassen (Rechte wirken erst dann, siehe
        // domain/access). Falls der Server erste Einträge trotzdem ablehnt, rettet sie db/syncRejections.
        await acceptanceUploaded();
        const tripId = tripIdOfRealm(inv.realmId);
        if (tripId) setPending({ tripId, crew: !inv.roles?.includes('readonly') });
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

/** Aktiviert ein angenommenes Logbuch, sobald es da ist, und fragt als Crew „Ich bin …“ (falls nicht per E-Mail klar). */
export function JoinWatcher() {
  const p = usePending();
  const arrived = useLiveQuery(async () => (p ? ((await db.trips.get(p.tripId)) ?? null) : null), [p?.tripId]);
  useEffect(() => {
    if (!p || !arrived) return;
    setPending(undefined);
    void (async () => {
      await setActiveTrip(db, arrived.id);
      if (!p.crew) return;
      const crew = activeCrew(await listCrew(db, arrived.id));
      if (crew.length > 0 && !(await getAuthor(db, arrived.id))) requestAuthorPrompt(arrived.id);
    })();
  }, [p, arrived]);
  return null;
}
