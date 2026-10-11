import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { watchSyncRejections } from '../../db/cloud';
import { discardRescued, listRescued, resubmitRescued } from '../../db/syncRejections';
import { rejectedText } from '../cloudText';
import { useToast } from '../toast';

/** Startet die Beobachtung der Sync-Antworten (nur mit Cloud; einmal pro App). */
export function RejectionWatcher() {
  useEffect(() => watchSyncRejections(db), []);
  return null;
}

/** Hinweis auf vom Server abgelehnte Änderungen: bleiben gespeichert, werden erneut gesendet oder verworfen. */
export function RejectedChangesBanner() {
  const items = useLiveQuery(() => (db.cloudEnabled ? listRescued(db) : []), []) ?? [];
  const toast = useToast();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Bestätigung, sobald die erneut gesendeten Änderungen vom Server übernommen wurden (nicht nach „Verwerfen“)
  const prev = useRef({ count: 0, discarded: false });
  useEffect(() => {
    if (prev.current.count > 0 && items.length === 0 && !prev.current.discarded) {
      toast('Zuvor abgelehnte Änderungen sind jetzt in der Cloud');
    }
    prev.current = { count: items.length, discarded: false };
  }, [items.length, toast]);
  const discard = async (): Promise<void> => {
    prev.current.discarded = true;
    await discardRescued(db);
    setConfirmDiscard(false);
  };
  if (items.length === 0) return null;
  const pending = items.some((i) => i.state === 'pending');
  const retry = async (): Promise<void> => {
    const n = await resubmitRescued(db, { force: true });
    toast(n > 0 ? 'Wird erneut gesendet …' : 'Noch keine Schreibrechte in diesem Logbuch – bitte später erneut versuchen');
  };
  return (
    <div className="banner invite-banner rejected-banner" role="region" aria-label="Abgelehnte Änderungen">
      <span>{rejectedText(items)}</span>
      {pending ? (
        <span className="actions">
          {confirmDiscard ? (
            <>
              <button className="btn danger" type="button" onClick={() => void discard()}>
                Endgültig verwerfen
              </button>
              <button className="btn" type="button" onClick={() => setConfirmDiscard(false)}>
                Behalten
              </button>
            </>
          ) : (
            <>
              <button className="btn primary" type="button" onClick={() => void retry()}>
                Erneut senden
              </button>
              <button className="btn" type="button" onClick={() => setConfirmDiscard(true)}>
                Verwerfen
              </button>
            </>
          )}
        </span>
      ) : null}
    </div>
  );
}
