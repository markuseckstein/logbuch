import { useEffect, useState } from 'react';
import { db } from '../../db/db';
import { inviteMember, login, logout, removeMember, shareTripToCloud, type InviteRole } from '../../db/cloud';
import { isSharedRealm, type Trip } from '../../domain';
import { Dialog } from '../components/Dialog';
import { roleLabel, statusLabel } from '../cloudText';
import { useCanManage, useCloudStatus, useCloudUser, useLastSyncAt, useMembers } from '../cloudHooks';
import { useToast } from '../toast';

const STATUS_LABEL = { invited: 'eingeladen', accepted: 'angenommen', rejected: 'abgelehnt' } as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** E-Mail abfragen und Anmeldung starten; den Code fragt danach das Addon über CloudLoginHost ab. */
export function SignInDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string>();
  const submit = (): void => {
    const e = email.trim();
    if (!EMAIL_RE.test(e)) {
      setError('Bitte eine gültige E-Mail-Adresse eingeben.');
      return;
    }
    onClose();
    login(db, e).then(
      () => toast('Angemeldet – Logbücher werden synchronisiert'),
      () => toast('Anmeldung abgebrochen'),
    );
  };
  return (
    <Dialog title="Mit Cloud-Konto anmelden" onClose={onClose}>
      <p className="muted">
        Du bekommst einen Code per E-Mail. Kein Passwort nötig. Ohne Anmeldung bleibt alles nur auf diesem Gerät.
      </p>
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          submit();
        }}
      >
        <label className="f">
          <span>E-Mail-Adresse</span>
          <input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {error ? (
          <div className="err" role="alert">
            {error}
          </div>
        ) : null}
        <div className="share-choice">
          <button className="btn primary block" type="submit">
            Code anfordern
          </button>
          <button className="btn block" type="button" onClick={onClose}>
            Abbrechen
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function MembersPanel({ trip }: { trip: Trip }) {
  const toast = useToast();
  const members = useMembers(trip.id);
  const me = useCloudUser();
  const nameOf = (m: { name?: string; email?: string; self: boolean }): string =>
    m.name || m.email || (m.self ? (me?.email ?? 'du') : 'Skipper');
  const manage = useCanManage(trip.id);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();

  const invite = async (role: InviteRole): Promise<void> => {
    const e = email.trim();
    if (!EMAIL_RE.test(e)) {
      setError('Bitte eine gültige E-Mail-Adresse eingeben.');
      return;
    }
    setError(undefined);
    try {
      await inviteMember(db, trip.id, { email: e, role, name });
      setEmail('');
      setName('');
      toast(`${e} eingeladen`);
    } catch {
      setError('Die Einladung konnte nicht angelegt werden.');
    }
  };

  return (
    <>
      <div className="legend">Mitglieder</div>
      <ul className="members" aria-label="Mitglieder">
        {members.map((m) => (
          <li key={m.id}>
            <span className="who">
              <b>{nameOf(m)}</b>
              {m.name && m.email ? <span className="dmeta"> {m.email}</span> : null}
              {m.self ? <span className="dmeta"> (du)</span> : null}
            </span>
            <span className="role">{roleLabel(m.roles)}</span>
            <span className="dmeta">{STATUS_LABEL[m.status]}</span>
            {manage && !m.self ? (
              <button
                className="btn"
                type="button"
                aria-label={`${nameOf(m)} entfernen`}
                onClick={() =>
                  void removeMember(db, m.id).then(
                    () => toast(`${nameOf(m)} entfernt`),
                    () => toast('Mitglied konnte nicht entfernt werden'),
                  )
                }
              >
                Entfernen
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {manage ? (
        <>
          <label className="f">
            <span>E-Mail einladen</span>
            <input type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="f">
            <span>Name (optional)</span>
            <input type="text" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          {error ? (
            <div className="err" role="alert">
              {error}
            </div>
          ) : null}
          <div className="share-choice">
            <button className="btn primary block" type="button" onClick={() => void invite('crew')}>
              Als Crew einladen (schreibt mit)
            </button>
            <button className="btn block" type="button" onClick={() => void invite('readonly')}>
              Anderes Boot einladen (nur lesen)
            </button>
          </div>
          <p className="muted">
            Die eingeladene Person meldet sich in der App mit genau dieser E-Mail-Adresse an und nimmt die Einladung an.
          </p>
        </>
      ) : null}
    </>
  );
}

function LogoutDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const out = async (): Promise<void> => {
    onClose();
    try {
      await logout(db);
      toast('Abgemeldet – lokale Daten wurden von diesem Gerät entfernt');
    } catch {
      toast('Abmelden abgebrochen');
    }
  };
  return (
    <Dialog title="Abmelden?" onClose={onClose}>
      <p className="muted">
        Beim Abmelden werden alle Logbücher von diesem Gerät entfernt. In der Cloud bleiben sie erhalten und kommen nach
        erneuter Anmeldung zurück. Noch nicht übertragene Änderungen gehen verloren – exportiere vorher ein ZIP, wenn
        du offline bist.
      </p>
      <div className="share-choice">
        <button className="btn danger block" type="button" onClick={() => void out()}>
          Abmelden und lokale Daten entfernen
        </button>
        <button className="btn block" type="button" onClick={onClose}>
          Abbrechen
        </button>
      </div>
    </Dialog>
  );
}

/** Törn-Tab, Abschnitt „Synchronisation“ (nur wenn eine Cloud-URL konfiguriert ist). */
export function CloudCard({ trip, readOnly }: { trip: Trip; readOnly: boolean }) {
  const toast = useToast();
  const status = useCloudStatus();
  const user = useCloudUser();
  const lastSync = useLastSyncAt();
  const now = useNow();
  const [signingIn, setSigningIn] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [busy, setBusy] = useState(false);
  if (status === 'local') return null;
  const loggedIn = user?.isLoggedIn === true;
  const shared = isSharedRealm(trip.realmId);

  const share = async (): Promise<void> => {
    setBusy(true);
    try {
      await shareTripToCloud(db, trip.id);
      toast('Logbuch ist jetzt in der Cloud – lade deine Crew ein');
    } catch {
      toast('Das Logbuch konnte nicht in die Cloud gebracht werden');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-label="Synchronisation">
      <div className="legend">Synchronisation</div>
      <p role="status">
        {loggedIn ? (
          <>
            Angemeldet als <b>{user.email ?? user.name ?? user.userId}</b>
            <br />
          </>
        ) : null}
        <span className="muted">{statusLabel(status, lastSync, now)}</span>
      </p>
      {!loggedIn ? (
        <button className="btn primary block" type="button" onClick={() => setSigningIn(true)}>
          Anmelden
        </button>
      ) : null}
      {loggedIn && !shared && !readOnly ? (
        <>
          <p className="muted">
            Bring das Logbuch in die Cloud, damit die Crew automatisch mitschreibt und andere Boote mitlesen.
          </p>
          <button className="btn primary block" type="button" disabled={busy} onClick={() => void share()}>
            Logbuch in die Cloud bringen
          </button>
        </>
      ) : null}
      {loggedIn && shared ? <MembersPanel trip={trip} /> : null}
      {loggedIn ? (
        <button className="btn block" type="button" onClick={() => setLoggingOut(true)}>
          Abmelden
        </button>
      ) : null}
      {signingIn ? <SignInDialog onClose={() => setSigningIn(false)} /> : null}
      {loggingOut ? <LogoutDialog onClose={() => setLoggingOut(false)} /> : null}
    </section>
  );
}
