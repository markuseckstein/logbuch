import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Invite } from 'dexie-cloud-addon';
import { db } from '../../db/db';
import { setActiveTrip } from '../../db/repo';
import { decideJoinState, isSharedRealm, pickJoinTarget, type JoinDecision } from '../../domain';
import { useCloudUser, useInvites, useSyncState } from '../cloudHooks';
import { Icon } from '../icons';
import { useToast } from '../toast';
import { LogoutDialog, SignInDialog } from './CloudCard';
import { clearJoin, setJoinProgress, useJoin, useJoinProgress } from './joinState';

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

/**
 * Nimmt offene Einladungen für das angemeldete Konto automatisch an (kein Klick nötig) und aktiviert danach den
 * Törn – bevorzugt den aus dem Beitritts-Link. Der Boot-Schalter steht dann auf dem vorgeschlagenen Boot.
 */
export function JoinWatcher() {
  const user = useCloudUser();
  const invites = useInvites();
  const join = useJoin();
  const progress = useJoinProgress();
  const toast = useToast();
  const loggedIn = user?.isLoggedIn === true;
  const handled = useRef(new Set<string>());
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!loggedIn) return;
    const open = invites.filter((i) => !handled.current.has(i.id ?? i.realmId));
    if (open.length === 0) return;
    for (const i of open) handled.current.add(i.id ?? i.realmId);
    setJoinProgress({ ...progress, accepting: true });
    void (async () => {
      try {
        await Promise.all(open.map((i: Invite) => i.accept()));
        // Erst die Annahme hochladen und den Realm vom Server bestätigen lassen (Rechte wirken erst dann, siehe
        // domain/access). Falls der Server erste Einträge trotzdem ablehnt, rettet sie db/syncRejections.
        await acceptanceUploaded();
        const target = pickJoinTarget(open, join?.tripId);
        setJoinProgress(target === undefined ? { accepting: false } : { accepting: false, target });
      } catch {
        for (const i of open) handled.current.delete(i.id ?? i.realmId);
        setJoinProgress({ accepting: false });
        toast('Einladung konnte nicht angenommen werden – neuer Versuch …');
        setTimeout(() => setRetry((n) => n + 1), 5000);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn, invites, retry]);

  const decision = useJoinDecision();
  useEffect(() => {
    // Nur während eines Beitritts/Wieder-Anmeldens eingreifen; sonst aktiviert die App den ersten Törn selbst.
    if (decision.kind !== 'activate' || (!join && progress.target === undefined)) return;
    setJoinProgress({ accepting: false });
    clearJoin();
    void setActiveTrip(db, decision.tripId);
    if (decision.notice === 'not-member') toast('Für diesen Törn bist du nicht eingetragen');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decision.kind, decision.kind === 'activate' ? decision.tripId : undefined, !!join, progress.target]);
  return null;
}

const SETTLE_MS = 4000;

/**
 * Entscheidet nach der Anmeldung (siehe `decideJoinState`): Einladungen annehmen, vorhandenen Törn aktivieren
 * (Wieder-Anmelden mit leerem Speicher) oder „keine Einladung“ melden.
 */
function useJoinDecision(): JoinDecision {
  const join = useJoin();
  const progress = useJoinProgress();
  const loggedIn = useCloudUser()?.isLoggedIn === true;
  const invites = useInvites();
  const sync = useSyncState();
  const tripIds = useLiveQuery(async () => (await db.trips.toArray()).filter((t) => isSharedRealm(t.realmId)).map((t) => t.id), []);
  const synced = sync?.phase === 'in-sync';
  const idle = synced && invites.length === 0 && !progress.accepting;
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!idle) return;
    // Einladungen und Törns treffen mit dem ersten Abgleich ein; kurz warten, bevor „keine Einladung“ gemeldet wird
    const t = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => {
      clearTimeout(t);
      setSettled(false);
    };
  }, [idle]);
  return decideJoinState({
    loggedIn,
    synced,
    settled,
    accepting: progress.accepting,
    openInvites: invites.length,
    tripIds: tripIds ?? [],
    wantedTripId: progress.target ?? join?.tripId,
  });
}

/** Welcher Beitritts-Bildschirm ersetzt gerade die App? */
export function useJoinGate(tripCount: number): 'sign-in' | 'joining' | undefined {
  const join = useJoin();
  const progress = useJoinProgress();
  const decision = useJoinDecision();
  if (!db.cloudEnabled) return undefined;
  if (decision.kind === 'signed-out') return join ? 'sign-in' : undefined;
  if (decision.kind === 'activate') return undefined;
  if (join) return 'joining';
  if (progress.accepting && tripCount === 0) return 'joining';
  return undefined;
}

/** Hinweis in der App, solange ein angenommener Törn noch geladen wird. */
export function JoiningBanner() {
  const { accepting, target } = useJoinProgress();
  if (!accepting && target === undefined) return null;
  return (
    <div className="banner" role="status">
      <Icon name="sichtung" size={20} />
      Törn wird geladen …
    </div>
  );
}

/** Beitreten-Bildschirm für Nicht-Angemeldete: Anmelden mit der vom Admin eingetragenen E-Mail. */
export function JoinScreen() {
  const join = useJoin();
  const [signingIn, setSigningIn] = useState(false);
  return (
    <main className="screen join-screen" aria-labelledby="join-title">
      <div className="card">
        <div className="legend">Törn beitreten</div>
        <h1 id="join-title">Du wurdest zu einem Törn eingeladen</h1>
        <p>
          Melde dich mit der E-Mail-Adresse an, die dein Admin eingetragen hat. Das klappt auch später jederzeit wieder mit
          derselben Adresse.
        </p>
        <button className="btn primary block" type="button" onClick={() => setSigningIn(true)}>
          <Icon name="mail" size={20} />
          Anmelden
        </button>
        <p className="muted">Der Code kommt per E-Mail (Absender: Dexie Cloud) – schau ggf. im Spam-Ordner nach.</p>
        <button className="btn block" type="button" onClick={clearJoin}>
          Abbrechen
        </button>
      </div>
      {signingIn ? <SignInDialog onClose={() => setSigningIn(false)} initialEmail={join?.email ?? ''} /> : null}
    </main>
  );
}

/** Angemeldet, Törn noch nicht da: „wird geladen“ bzw. – nach dem Abgleich – keine Einladung für diese Adresse. */
export function JoiningScreen() {
  const user = useCloudUser();
  const decision = useJoinDecision();
  const [loggingOut, setLoggingOut] = useState(false);
  const noInvite = decision.kind === 'no-invite';
  const email = user?.email ?? 'diese Adresse';
  return (
    <main className="screen join-screen" aria-labelledby="join-title">
      <div className="card">
        <div className="legend">Törn beitreten</div>
        {noInvite ? (
          <>
            <h1 id="join-title">Keine Einladung gefunden</h1>
            <p role="alert">Für {email} liegt keine Einladung vor. Bitte den Admin, genau diese Adresse einzutragen.</p>
            <button className="btn primary block" type="button" onClick={() => setLoggingOut(true)}>
              Abmelden / andere E-Mail
            </button>
          </>
        ) : (
          <>
            <h1 id="join-title">Törn wird geladen …</h1>
            <p className="muted" role="status">
              Angemeldet als {email}. Das dauert einen Moment.
            </p>
          </>
        )}
        <button className="btn block" type="button" onClick={clearJoin}>
          Abbrechen
        </button>
      </div>
      {loggingOut ? <LogoutDialog onClose={() => setLoggingOut(false)} /> : null}
    </main>
  );
}


