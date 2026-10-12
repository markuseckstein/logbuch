import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Invite } from 'dexie-cloud-addon';
import { db } from '../../db/db';
import { login, logout } from '../../db/cloud';
import { isHomeViewToken, isSharedRealm, isViewerEmail, viewerEmail, viewerToken, type Trip } from '../../domain';
import { useCloudUser, useInvites, useSyncState, useUserInteraction } from '../cloudHooks';
import { useSettings, useTheme } from '../hooks';
import { CloudLoginHost } from '../cloud/LoginHost';
import { HomeViewScreen } from './HomeViewScreen';
import { clearHomeViewToken, useHomeViewToken } from './state';

/** Nach dem Abgleich so lange warten, bevor „Link funktioniert nicht“ erscheint (Einladung/Törn treffen verzögert ein). */
const SETTLE_MS = 5000;

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="screen join-screen home" aria-labelledby="home-notice-title">
      <div className="card">
        <div className="legend">Logbuch · Daheim</div>
        <h1 id="home-notice-title">{title}</h1>
        {children}
      </div>
    </main>
  );
}

function Loading() {
  return (
    <Notice title="Törn wird geladen …">
      <p className="muted" role="status">
        Einen Moment bitte.
      </p>
    </Notice>
  );
}

function Invalid({ onRetry }: { onRetry?: () => void }) {
  return (
    <Notice title="Link funktioniert gerade nicht">
      <p role="alert">Dieser Link funktioniert gerade nicht. Vielleicht ist er noch nicht freigeschaltet oder wurde erneuert – frag die Crew.</p>
      {onRetry ? (
        <button className="btn primary block home-retry" type="button" onClick={onRetry}>
          Erneut versuchen
        </button>
      ) : null}
    </Notice>
  );
}

/** Angemeldet als echtes Konto: nicht still abmelden, sondern fragen. */
function OtherAccount({ email, onOpen }: { email: string; onOpen: () => void }) {
  return (
    <Notice title="Daheim-Ansicht öffnen?">
      <p role="alert">
        Du bist angemeldet als {email}. Die Daheim-Ansicht in diesem Browser öffnen meldet dich ab.
      </p>
      <p className="muted">
        Deine Törns bleiben in der Cloud und kommen nach erneuter Anmeldung zurück. Noch nicht übertragene Änderungen
        gehen verloren.
      </p>
      <div className="share-choice">
        <button className="btn danger block" type="button" onClick={onOpen}>
          Trotzdem öffnen
        </button>
        <button className="btn block" type="button" onClick={clearHomeViewToken}>
          Abbrechen
        </button>
      </div>
    </Notice>
  );
}

/** Zuschauer angemeldet: Einladung automatisch annehmen, Törn anzeigen bzw. „nicht mehr gültig“. */
function Viewer() {
  const invites = useInvites();
  const sync = useSyncState();
  const handled = useRef(new Set<string>());
  const [accepting, setAccepting] = useState(false);
  const trips = useLiveQuery(
    async () => (await db.trips.toArray()).filter((t) => isSharedRealm(t.realmId)).sort((a, b) => a.createdAt - b.createdAt),
    [],
  );

  useEffect(() => {
    const open = invites.filter((i) => !handled.current.has(i.id ?? i.realmId));
    if (open.length === 0) return;
    for (const i of open) handled.current.add(i.id ?? i.realmId);
    setAccepting(true);
    void Promise.all(open.map((i: Invite) => i.accept()))
      .then(() => db.cloud.sync({ wait: true, purpose: 'push' }))
      .catch(() => {
        for (const i of open) handled.current.delete(i.id ?? i.realmId);
      })
      .finally(() => setAccepting(false));
  }, [invites]);

  const trip: Trip | undefined = trips?.[0];
  const idle = sync?.phase === 'in-sync' && invites.length === 0 && !accepting && trips !== undefined && !trip;
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!idle) return;
    const t = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => {
      clearTimeout(t);
      setSettled(false);
    };
  }, [idle]);

  if (trip) return <HomeViewScreen trip={trip} />;
  return settled ? <Invalid /> : <Loading />;
}

type Phase = 'idle' | 'busy' | 'done' | 'failed';

/**
 * Daheim-Link (`#daheim=<token>`): meldet ohne Eingabe mit dem Demo-Konto des Tokens an und zeigt die vereinfachte
 * Nur-Lese-Ansicht. Ist ein echtes Konto angemeldet, wird erst gefragt; ein anderes Zuschauer-Konto (alter Link)
 * wird ohne Rückfrage gewechselt.
 */
export function HomeViewApp() {
  const token = useHomeViewToken();
  const user = useCloudUser();
  const ui = useUserInteraction();
  const settings = useSettings();
  useTheme(settings?.theme);
  const [phase, setPhase] = useState<Phase>('idle');
  const [confirmed, setConfirmed] = useState(false);

  const loggedIn = user?.isLoggedIn === true;
  const email = loggedIn ? user.email : undefined;
  const valid = token !== undefined && isHomeViewToken(token);
  const realAccount = loggedIn && !isViewerEmail(email);
  const ready = loggedIn && isViewerEmail(email) && (token === undefined || viewerToken(email) === token);
  const mustSwitch = db.cloudEnabled && valid && user !== undefined && !ready && (!realAccount || confirmed);

  const running = useRef(false);
  useEffect(() => {
    if (!mustSwitch || phase !== 'idle' || running.current) return;
    running.current = true;
    void (async () => {
      setPhase('busy');
      try {
        if (loggedIn) await logout(db);
        await login(db, viewerEmail(token!));
        setPhase('done');
      } catch {
        setPhase('failed');
      } finally {
        running.current = false;
      }
    })();
  }, [mustSwitch, phase, loggedIn, token]);

  // Demo-Konto unbekannt (nicht freigeschaltet): das Addon meldet es als Hinweis. Wegklicken lässt login() scheitern
  // → „nicht gültig“ mit „Erneut versuchen“.
  const loginAlert = phase === 'busy' && ui?.type === 'message-alert';
  useEffect(() => {
    if (loginAlert) ui.onCancel();
  }, [loginAlert, ui]);

  let content: ReactNode;
  if (!db.cloudEnabled || (token !== undefined && !valid)) content = <Invalid />;
  else if (phase === 'failed') content = <Invalid onRetry={() => setPhase('idle')} />;
  else if (ready) content = <Viewer />;
  else if (realAccount && !confirmed) content = <OtherAccount email={email ?? user.userId ?? ''} onOpen={() => setConfirmed(true)} />;
  else content = <Loading />;

  return (
    <>
      {content}
      {loginAlert ? null : <CloudLoginHost />}
    </>
  );
}
