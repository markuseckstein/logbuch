import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { createHomeView, disableHomeView, getHomeView, renewHomeView } from '../../db/cloud';
import { buildHomeViewUrl, type Trip } from '../../domain';
import { Icon } from '../icons';
import { writeErrorMessage } from '../lib';
import { copyText, shareLink } from '../share';
import { useToast } from '../toast';
import { QrCode } from '../components/QrCode';

/** Daheim-Link dieser App-Installation (Basis-Pfad aus Vite). */
export const homeViewUrlFor = (token: string): string => buildHomeViewUrl(location.origin, import.meta.env.BASE_URL, token);

/** Befehl zum einmaligen Freischalten (Demo-Konto anlegen, braucht die Zugangsdaten im Projektordner). */
export const unlockCommand = (email: string): string => `npm run viewer:create -- ${email}`;

type Confirm = 'renew' | 'disable' | undefined;

/**
 * Törn-Tab (Admin, angemeldet): Daheim-Link für Familie/Freunde zu Hause – Törn live ansehen ohne Anmeldung.
 * Kein Mitglied der Personenliste: ein eigenes Realm-Mitglied mit Rolle `viewer`, keine Person (CrewMember).
 */
export function HomeViewCard({ trip }: { trip: Trip }) {
  const toast = useToast();
  const info = useLiveQuery(() => getHomeView(db, trip.id), [trip.id, trip.realmId]);
  const [confirm, setConfirm] = useState<Confirm>();
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, done: string, failed: string): Promise<void> => {
    setBusy(true);
    setConfirm(undefined);
    try {
      await fn();
      toast(done);
    } catch (e) {
      toast(writeErrorMessage(e, failed));
    } finally {
      setBusy(false);
    }
  };
  const url = info ? homeViewUrlFor(info.token) : undefined;

  return (
    <section className="card" aria-label="Daheim-Link">
      <div className="legend">Daheim-Link</div>
      <p className="muted">
        Für Familie und Freunde zu Hause: Sie sehen den Törn live – Karte, Einträge, Tagesberichte und Fotos – ohne
        Anmeldung und ohne etwas ändern zu können. Wer den Link hat, kann zusehen; er lässt sich weiterleiten.
      </p>
      {!info || !url ? (
        <button
          className="btn primary block"
          type="button"
          disabled={busy}
          onClick={() => void run(() => createHomeView(db, trip.id), 'Daheim-Link erstellt', 'Daheim-Link konnte nicht erstellt werden')}
        >
          <Icon name="plus" size={20} />
          Daheim-Link erstellen
        </button>
      ) : (
        <>
          <div className="join-sheet">
            <QrCode text={url} label={`QR-Code Daheim-Link: ${trip.name}`} />
            <p className="join-link mono" data-testid="home-link">
              {url}
            </p>
          </div>
          {info.opened ? (
            <p>
              <span className="st ok">geöffnet</span> Der Link funktioniert und wurde schon benutzt.
            </p>
          ) : (
            <div className="note warn" role="note">
              <b>Noch nicht freigeschaltet</b>
              <p>
                Der Link funktioniert erst nach einer einmaligen Freischaltung. Verschicke ihn deshalb erst danach –
                sonst sehen die Empfänger nur eine Fehlermeldung.
              </p>
              <details className="opt">
                <summary>Für die Person mit Admin-Zugang am Laptop</summary>
                <div className="in">
                  <p>Diesen Befehl einmal im Projektordner der App ausführen:</p>
                  <code className="cmd" data-testid="home-unlock">
                    {unlockCommand(info.email)}
                  </code>
                  <button
                    className="btn sm"
                    type="button"
                    style={{ marginTop: 8 }}
                    onClick={() => void copyText(unlockCommand(info.email), toast, 'Befehl kopiert', 'Befehl konnte nicht kopiert werden')}
                  >
                    Befehl kopieren
                  </button>
                </div>
              </details>
              <p className="muted">Sobald der Link einmal geöffnet wurde, verschwindet dieser Hinweis.</p>
            </div>
          )}
          <button
            className={info.opened ? 'btn primary block' : 'btn block'}
            type="button"
            onClick={() =>
              void shareLink({ title: `Logbuch: ${trip.name}`, text: `Verfolge unseren Törn „${trip.name}“ live:`, url }, toast)
            }
          >
            <Icon name="mail" size={20} />
            {info.opened ? 'Link teilen' : 'Link teilen (funktioniert erst nach Freischaltung)'}
          </button>
          <div className="acts">
            <button className="btn sm" type="button" disabled={busy} onClick={() => setConfirm('renew')}>
              Link erneuern
            </button>
            <button className="btn danger sm" type="button" disabled={busy} onClick={() => setConfirm('disable')}>
              Daheim-Link abschalten
            </button>
          </div>
          {confirm ? (
            <div className="confirm" role="alertdialog" aria-label={confirm === 'renew' ? 'Link erneuern bestätigen' : 'Daheim-Link abschalten bestätigen'}>
              <p>
                {confirm === 'renew'
                  ? 'Neuen Link erstellen? Der bisherige Link funktioniert dann nicht mehr.'
                  : 'Daheim-Link abschalten? Wer ihn hat, sieht den Törn nicht mehr.'}
              </p>
              <button className="btn sm" type="button" autoFocus onClick={() => setConfirm(undefined)}>
                Abbrechen
              </button>
              {confirm === 'renew' ? (
                <button
                  className="btn danger sm"
                  type="button"
                  onClick={() => void run(() => renewHomeView(db, trip.id), 'Neuer Daheim-Link erstellt', 'Link konnte nicht erneuert werden')}
                >
                  Neuen Link erstellen
                </button>
              ) : (
                <button
                  className="btn danger sm"
                  type="button"
                  onClick={() => void run(() => disableHomeView(db, trip.id), 'Daheim-Link abgeschaltet', 'Link konnte nicht abgeschaltet werden')}
                >
                  Abschalten
                </button>
              )}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
