import { useEffect, useRef, useState } from 'react';
import { resizeImage } from '../../device';
import { db } from '../../db/db';
import { createTrip, setActiveTrip, setAuthor, setBoatPhoto, type PhotoInput } from '../../db/repo';
import type { CrewDraft } from '../../domain';
import { Icon } from '../icons';
import { useToast } from '../toast';
import { BoatPicture } from '../components/BoatPicture';
import { CrewEditor } from '../components/CrewEditor';
import { ImportLogbook } from '../components/ImportLogbook';
import { SignInDialog } from '../cloud/CloudCard';
import { InviteBanner } from '../cloud/InviteBanner';
import { useCloudStatus } from '../cloudHooks';
import {
  BoatFields,
  TripFields,
  boatOf,
  emptyBoatDraft,
  emptyTripDraft,
  tripPatchOf,
  validateTrip,
} from '../components/TripFields';

const STEPS = ['Törn', 'Boot', 'Crew'] as const;

interface OnboardingProps {
  onDone: (tripId: string) => void;
  /** Fehlt, solange noch kein Törn existiert (dann nicht abbrechbar). */
  onCancel?: () => void;
}

export function Onboarding({ onDone, onCancel }: OnboardingProps) {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [trip, setTrip] = useState(emptyTripDraft);
  const [boat, setBoat] = useState(emptyBoatDraft);
  const [crew, setCrew] = useState<CrewDraft[]>([]);
  const [photo, setPhoto] = useState<{ input: PhotoInput; url: string }>();
  const urlRef = useRef<string>(undefined);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const cloud = useCloudStatus();
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  useEffect(() => {
    if (!onCancel) return;
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const pickPhoto = async (file: File): Promise<void> => {
    setPhotoBusy(true);
    try {
      const input = await resizeImage(file);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(input.blob);
      setPhoto({ input, url: urlRef.current });
    } catch {
      toast('Foto konnte nicht verarbeitet werden');
    } finally {
      setPhotoBusy(false);
    }
  };

  const finish = async (): Promise<void> => {
    setSaving(true);
    try {
      const created = await createTrip(db, { ...tripPatchOf(trip), boat: boatOf(boat), crew });
      // Gründer schreibt: Skipper, sonst erstes Crew-Mitglied.
      const founder = crew.find((c) => c.role === 'skipper') ?? crew[0];
      if (founder) await setAuthor(db, created.id, founder.id);
      if (photo) await setBoatPhoto(db, created.id, photo.input);
      await setActiveTrip(db, created.id);
      toast(`Törn „${created.name}“ angelegt`, 4200);
      onDone(created.id);
    } catch {
      setError('Der Törn konnte nicht gespeichert werden.');
      setSaving(false);
    }
  };

  const next = (): void => {
    if (step === 0) {
      const msg = validateTrip(trip);
      if (msg) {
        setError(msg);
        return;
      }
    }
    setError(undefined);
    if (step < STEPS.length - 1) {
      setStep(step + 1);
      window.scrollTo(0, 0);
    } else void finish();
  };

  return (
    <div className="onb" role="dialog" aria-modal="true" aria-labelledby="onb-title">
      <div className="onb-in">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="legend" style={{ flex: 1 }}>
            Schritt {step + 1} von 3 · {STEPS[step]}
          </div>
          {onCancel ? (
            <button className="icon-btn" type="button" aria-label="Abbrechen" onClick={onCancel}>
              <Icon name="x" />
            </button>
          ) : null}
        </div>
        <div className="steps" aria-hidden="true">
          {STEPS.map((s, i) => (
            <i key={s} className={i <= step ? 'on' : undefined} />
          ))}
        </div>
        <h2 id="onb-title">Neuer Törn</h2>

        {step === 0 ? (
          <section className="onb-step">
            <TripFields value={trip} onChange={setTrip} autoFocus />
            {onCancel ? null : (
              <div className="card">
                <p className="muted">Schreibt ihr zu mehreren auf einem Boot? Dann importiere das geteilte Logbuch.</p>
                <ImportLogbook />
              </div>
            )}
            {onCancel || cloud === 'local' ? null : (
              <div className="card">
                <InviteBanner />
                {cloud === 'signed-out' ? (
                  <>
                    <p className="muted">Du wurdest in ein Logbuch eingeladen? Melde dich mit deiner E-Mail-Adresse an.</p>
                    <button className="btn block" type="button" onClick={() => setSigningIn(true)}>
                      Mit Cloud-Konto anmelden
                    </button>
                  </>
                ) : (
                  <p className="muted">Angemeldet – Einladungen erscheinen hier, sobald sie da sind.</p>
                )}
              </div>
            )}
            {signingIn ? <SignInDialog onClose={() => setSigningIn(false)} /> : null}
          </section>
        ) : null}
        {step === 1 ? (
          <section className="onb-step">
            <BoatPicture previewUrl={photo?.url} busy={photoBusy} onPick={(f) => void pickPhoto(f)} />
            <BoatFields value={boat} onChange={setBoat} full={false} />
          </section>
        ) : null}
        {step === 2 ? (
          <section className="onb-step">
            <CrewEditor
              crew={crew}
              onChange={setCrew}
              defaultRole="crew"
              emptyText="Noch niemand an Bord – füge mindestens den Skipper hinzu."
            />
          </section>
        ) : null}

        {error ? (
          <div className="err" role="alert">
            {error}
          </div>
        ) : null}
        <div className="onb-nav">
          {step > 0 ? (
            <button className="btn" type="button" onClick={() => setStep(step - 1)}>
              Zurück
            </button>
          ) : null}
          <button className="btn primary" type="button" disabled={saving} onClick={next}>
            {step === STEPS.length - 1 ? 'Törn anlegen' : 'Weiter'}
          </button>
        </div>
      </div>
    </div>
  );
}
