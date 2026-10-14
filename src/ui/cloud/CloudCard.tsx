import { useEffect, useState } from 'react';
import { db } from '../../db/db';
import { login, logout } from '../../db/cloud';
import { formatDateLong, type Trip } from '../../domain';
import { Dialog } from '../components/Dialog';
import { statusLabel } from '../cloudText';
import { useCloudStatus, useCloudUser, useLastSyncAt } from '../cloudHooks';
import { InstallButton } from '../InstallButton';
import { Icon } from '../icons';
import { initials } from '../lib';
import { useToast } from '../toast';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** E-Mail abfragen und Anmeldung starten; den Code fragt danach das Addon über CloudLoginHost ab. */
export function SignInDialog({ onClose, initialEmail = '' }: { onClose: () => void; initialEmail?: string }) {
  const toast = useToast();
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState<string>();
  const submit = (): void => {
    const e = email.trim();
    if (!EMAIL_RE.test(e)) {
      setError('Bitte eine gültige E-Mail-Adresse eingeben.');
      return;
    }
    onClose();
    login(db, e).then(
      () => toast('Angemeldet – Törns werden übertragen'),
      () => toast('Anmeldung abgebrochen'),
    );
  };
  return (
    <Dialog title="Mit E-Mail anmelden" onClose={onClose}>
      <p className="muted">
        Du bekommst einen Code per E-Mail. Kein Passwort nötig. Ohne Anmeldung bleibt alles nur auf diesem Handy.
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

export function LogoutDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const out = async (): Promise<void> => {
    onClose();
    try {
      await logout(db);
      toast('Abgemeldet – die Törns wurden von diesem Handy entfernt');
    } catch {
      toast('Abmelden abgebrochen');
    }
  };
  return (
    <Dialog title="Abmelden?" onClose={onClose}>
      <p className="muted">
        Beim Abmelden werden alle Törns von diesem Handy entfernt. Online bleiben sie erhalten und kommen nach
        erneuter Anmeldung zurück. Noch nicht übertragene Änderungen gehen verloren – exportiere vorher ein ZIP, wenn
        du offline bist.
      </p>
      <div className="share-choice">
        <button className="btn danger block" type="button" onClick={() => void out()}>
          Abmelden und Törns von diesem Handy entfernen
        </button>
        <button className="btn block" type="button" onClick={onClose}>
          Abbrechen
        </button>
      </div>
    </Dialog>
  );
}

/** Törn-Tab, Abschnitt „Konto“: Anmelden/Abmelden, Sync-Status, Admin-Badge. */
export function AccountCard({ trip, admin, myName }: { trip: Trip; admin: boolean; myName: string | undefined }) {
  const status = useCloudStatus();
  const user = useCloudUser();
  const lastSync = useLastSyncAt();
  const now = useNow();
  const [signingIn, setSigningIn] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const loggedIn = user?.isLoggedIn === true;
  const name = myName ?? (loggedIn ? (user.name ?? user.email ?? '') : 'Ich');
  return (
    <section className="card" aria-label="Konto">
      <div className="legend">Konto</div>
      <div className="acct">
        <i className="av" aria-hidden="true">
          {initials(name || '?')}
        </i>
        <div>
          <b>{name}</b> {admin ? <span className="role">Admin</span> : <span className="st ok">Mitglied</span>}
          <div className="muted" role="status">
            {loggedIn ? (
              <>
                Angemeldet als {user.email ?? user.userId}
                <br />
              </>
            ) : null}
            {status === 'local' || status === 'signed-out' ? 'Nur auf diesem Handy gespeichert' : statusLabel(status, lastSync, now)}
          </div>
        </div>
        {loggedIn ? (
          <button className="btn sm" type="button" onClick={() => setLoggingOut(true)}>
            Abmelden
          </button>
        ) : null}
      </div>
      {status === 'signed-out' ? (
        <div className="lockcard">
          <div className="row">
            <Icon name="lock" size={22} />
            <div>
              <b>Mit der Crew teilen</b>
              <div className="muted">
                Personen einladen und gemeinsam schreiben geht nach der Anmeldung per E-Mail-Code. Einträge schreiben und
                Boote anlegen geht auch ohne.
              </div>
            </div>
          </div>
          <button className="btn sm" type="button" onClick={() => setSigningIn(true)}>
            <Icon name="mail" size={18} />
            Anmelden
          </button>
        </div>
      ) : null}
      <div className="muted">
        <b>Törn:</b> {trip.name}
        {trip.startDate ? ` · ${formatDateLong(trip.startDate)}` : ''}
        {trip.area ? ` · ${trip.area}` : ''}
      </div>
      <InstallButton />
      {signingIn ? <SignInDialog onClose={() => setSigningIn(false)} /> : null}
      {loggingOut ? <LogoutDialog onClose={() => setLoggingOut(false)} /> : null}
    </section>
  );
}
