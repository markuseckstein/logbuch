import { useEffect, useId, useRef, useState } from 'react';
import { resizeImage } from '../../device';
import { db } from '../../db/db';
import { inviteToTrip } from '../../db/cloud';
import { createTrip, listBoats, setActiveTrip, setBoatPhoto, setTripCover, type PhotoInput } from '../../db/repo';
import { nameFromEmail } from '../../domain';
import { Icon } from '../icons';
import { useToast } from '../toast';
import { ImportLogbook } from '../components/ImportLogbook';
import { SignInDialog } from '../cloud/CloudCard';
import { startJoin } from '../cloud/joinState';
import { useCloudStatus, useCloudUser } from '../cloudHooks';
import { BoatShape } from '../boats';
import { TripFields, emptyTripDraft, tripPatchOf, validateTrip } from '../components/TripFields';

const STEPS = ['Neuer Törn', 'Boote', 'Crew einladen'] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface PhotoDraft {
  input: PhotoInput;
  url: string;
}

interface BoatDraft {
  name: string;
  model: string;
  photo?: PhotoDraft;
}

interface InviteDraft {
  email: string;
  /** Index des Boots in der Liste (Vorschlag) oder undefined. */
  boat?: number;
}

interface OnboardingProps {
  onDone: (tripId: string) => void;
  /** Fehlt, solange noch kein Törn existiert (dann nicht abbrechbar). */
  onCancel?: () => void;
}

/** Datei wählen + verkleinern; die Vorschau-URL gibt der Aufrufer frei. */
function PhotoButton({ label, busy, onPick }: { label: string; busy: boolean; onPick: (file: File) => void }) {
  const id = useId();
  return (
    <>
      <input
        className="sr-only"
        id={id}
        type="file"
        accept="image/*"
        aria-label={label}
        disabled={busy}
        onChange={(ev) => {
          const file = ev.target.files?.[0];
          ev.target.value = '';
          if (file) onPick(file);
        }}
      />
      <label className="btn sm" htmlFor={id}>
        <Icon name="cam" size={18} />
        {busy ? 'Foto wird verarbeitet …' : label}
      </label>
    </>
  );
}

const BoatSvg = ({ colorIndex }: { colorIndex: number }) => (
  <svg viewBox="0 0 300 140" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <rect width="300" height="140" fill="var(--water-mid)" />
    <rect y="96" width="300" height="44" fill="var(--water-shallow)" />
    <path d="M60 98h180l-22 20H84z" fill={`var(--b${colorIndex})`} />
    <path d="M148 22v74M148 24l56 66h-56M144 40l-48 50h48" fill="var(--surface)" stroke="var(--ink)" strokeWidth="2" />
  </svg>
);

export function Onboarding({ onDone, onCancel }: OnboardingProps) {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [trip, setTrip] = useState(emptyTripDraft);
  const [founder, setFounder] = useState('');
  const [cover, setCover] = useState<PhotoDraft>();
  const [boats, setBoats] = useState<BoatDraft[]>([]);
  const [nb, setNb] = useState<BoatDraft>({ name: '', model: '' });
  const [invites, setInvites] = useState<InviteDraft[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteBoat, setInviteBoat] = useState<number>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [inviteError, setInviteError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const cloud = useCloudStatus();
  const user = useCloudUser();
  const signedIn = user?.isLoggedIn === true;
  const [signingIn, setSigningIn] = useState(false);
  const urls = useRef(new Set<string>());

  useEffect(() => {
    const all = urls.current;
    return () => all.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  useEffect(() => {
    if (!onCancel) return;
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const loadPhoto = async (key: string, file: File): Promise<PhotoDraft | undefined> => {
    setBusy(key);
    try {
      const input = await resizeImage(file);
      const url = URL.createObjectURL(input.blob);
      urls.current.add(url);
      return { input, url };
    } catch {
      toast('Foto konnte nicht verarbeitet werden');
      return undefined;
    } finally {
      setBusy(undefined);
    }
  };

  const addBoat = (): boolean => {
    const name = nb.name.trim();
    if (!name) {
      setError('Bitte dem Boot einen Namen geben.');
      return false;
    }
    setBoats((list) => [...list, { ...nb, name, model: nb.model.trim() }]);
    setNb({ name: '', model: '' });
    setError(undefined);
    return true;
  };

  const addInvite = (): void => {
    const email = inviteEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      setInviteError('Bitte eine gültige E-Mail-Adresse eingeben.');
      return;
    }
    if (invites.some((i) => i.email === email) || email === user?.email?.toLowerCase()) {
      setInviteError('Diese Adresse steht schon in der Liste.');
      return;
    }
    setInvites((list) => [...list, { email, ...(inviteBoat !== undefined ? { boat: inviteBoat } : {}) }]);
    setInviteEmail('');
    setInviteError(undefined);
  };

  const finish = async (withInvites: boolean): Promise<void> => {
    setSaving(true);
    try {
      const created = await createTrip(db, {
        ...tripPatchOf(trip),
        boats: boats.map((b) => ({ name: b.name, ...(b.model ? { model: b.model } : {}) })),
        founder: { name: founder.trim() },
      });
      const stored = await listBoats(db, created.id);
      for (const [i, b] of boats.entries()) {
        const id = stored[i]?.id;
        if (b.photo && id) await setBoatPhoto(db, id, b.photo.input);
      }
      if (cover) await setTripCover(db, created.id, cover.input);
      const sent = withInvites ? invites : [];
      for (const inv of sent) {
        const boatId = inv.boat !== undefined ? stored[inv.boat]?.id : undefined;
        await inviteToTrip(db, created.id, { email: inv.email, name: nameFromEmail(inv.email), suggestedBoatId: boatId });
      }
      await setActiveTrip(db, created.id);
      const n = boats.length;
      const extra = sent.length ? ` · ${sent.length} Einladung${sent.length > 1 ? 'en' : ''} ${signedIn ? 'gesendet' : 'vorgemerkt'}` : '';
      toast(`Törn „${created.name}“ angelegt · du bist Admin · ${n} Boot${n > 1 ? 'e' : ''}${extra}`, 4600);
      onDone(created.id);
    } catch {
      setError('Der Törn konnte nicht gespeichert werden.');
      setSaving(false);
    }
  };

  const next = (): void => {
    if (step === 0) {
      const msg = validateTrip(trip) ?? (founder.trim() ? undefined : 'Bitte gib deinen Namen an.');
      if (msg) {
        setError(msg);
        return;
      }
    }
    if (step === 1 && boats.length === 0) {
      // ein ausgefülltes Boot zählt, auch ohne „Boot hinzufügen“
      if (!nb.name.trim()) {
        setError('Bitte lege mindestens ein Boot an.');
        return;
      }
      if (!addBoat()) return;
    } else if (step === 1 && nb.name.trim() && !addBoat()) return;
    setError(undefined);
    if (step < STEPS.length - 1) {
      setStep(step + 1);
      window.scrollTo(0, 0);
    } else void finish(true);
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
        <h2 id="onb-title">{STEPS[step]}</h2>

        {step === 0 ? (
          <section className="onb-step">
            <p className="muted">
              Du legst den Törn an und wirst damit <b>Admin</b>. Ein Törn enthält eine Flottille mit einem oder mehreren
              Booten.
            </p>
            <TripFields value={trip} onChange={setTrip} autoFocus />
            <label className="f">
              <span>Dein Name</span>
              <input type="text" autoComplete="given-name" value={founder} onChange={(e) => setFounder(e.target.value)} />
            </label>
            <div className="card">
              <div className="legend">Cover-Bild (optional)</div>
              {cover ? (
                <div className="hero">
                  <img src={cover.url} alt="Vorschau Cover-Bild" />
                </div>
              ) : null}
              <div className="acts">
                <PhotoButton
                  label={cover ? 'Cover ändern' : 'Cover-Bild wählen'}
                  busy={busy === 'cover'}
                  onPick={(f) => void loadPhoto('cover', f).then((p) => p && setCover(p))}
                />
                {cover ? (
                  <button className="btn sm" type="button" onClick={() => setCover(undefined)}>
                    Entfernen
                  </button>
                ) : null}
              </div>
            </div>
            {onCancel ? null : (
              <div className="card">
                <p className="muted">Hast du schon ein Logbuch als Datei? Dann importiere es.</p>
                <ImportLogbook />
              </div>
            )}
            {onCancel || cloud === 'local' ? null : (
              <div className="card">
                {cloud === 'signed-out' ? (
                  <button className="btn block" type="button" onClick={() => startJoin()}>
                    <Icon name="mail" size={20} />
                    Ich wurde eingeladen – anmelden
                  </button>
                ) : (
                  <p className="muted">Angemeldet – Einladungen werden automatisch angenommen, sobald sie da sind.</p>
                )}
              </div>
            )}
          </section>
        ) : null}

        {step === 1 ? (
          <section className="onb-step">
            <p className="muted">
              Lege die Boote der Flottille an (mindestens eins). Weitere kannst du später im Törn-Tab ergänzen.
            </p>
            {boats.length ? (
              <ul className="itemlist" aria-label="Boote">
                {boats.map((b, i) => (
                  <li key={`${b.name}-${i}`}>
                    <span className="thumb-s">{b.photo ? <img src={b.photo.url} alt="" /> : <BoatSvg colorIndex={(i % 4) + 1} />}</span>
                    <div>
                      <b>{b.name}</b>
                      {b.model ? <div className="muted">{b.model}</div> : null}
                    </div>
                    <BoatShape boat={{ colorIndex: (i % 4) + 1 }} size={16} />
                    <button
                      className="icon-btn"
                      type="button"
                      aria-label={`${b.name} entfernen`}
                      onClick={() => setBoats((list) => list.filter((_, j) => j !== i))}
                    >
                      <Icon name="x" size={18} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty">Noch kein Boot angelegt.</div>
            )}
            <div className="card">
              <div className="legend">Boot hinzufügen</div>
              <div className="boatpic">
                {nb.photo ? <img src={nb.photo.url} alt="Vorschau Bootsfoto" /> : <BoatSvg colorIndex={(boats.length % 4) + 1} />}
              </div>
              <div className="acts">
                <PhotoButton
                  label={nb.photo ? 'Foto ändern' : 'Foto wählen (optional)'}
                  busy={busy === 'boat'}
                  onPick={(f) => void loadPhoto('boat', f).then((p) => p && setNb((d) => ({ ...d, photo: p })))}
                />
              </div>
              <div className="row2">
                <label className="f">
                  <span>Bootsname</span>
                  <input type="text" autoComplete="off" value={nb.name} onChange={(e) => setNb({ ...nb, name: e.target.value })} />
                </label>
                <label className="f">
                  <span>Typ / Modell</span>
                  <input
                    type="text"
                    placeholder="z. B. Bavaria 37"
                    value={nb.model}
                    onChange={(e) => setNb({ ...nb, model: e.target.value })}
                  />
                </label>
              </div>
              <button className="btn block" type="button" onClick={() => void addBoat()}>
                <Icon name="plus" size={20} />
                Boot hinzufügen
              </button>
            </div>
          </section>
        ) : null}

        {step === 2 ? (
          <section className="onb-step">
            <p className="muted">
              Lade Personen per E-Mail für den ganzen Törn ein. Das Boot ist nur ein Vorschlag, alle dürfen auf jedes
              Boot schreiben.
            </p>
            {cloud === 'local' ? (
              <div className="lockcard">
                <p className="muted">Ohne Cloud-Verbindung bleibt der Törn auf diesem Gerät. Einladen geht hier nicht.</p>
              </div>
            ) : signedIn ? (
              <div className="note ok" role="note">
                <b>Angemeldet</b>
                {user?.email}
              </div>
            ) : (
              <div className="lockcard">
                <div className="row">
                  <Icon name="lock" size={22} />
                  <div>
                    <b>Anmeldung nötig</b>
                    <div className="muted">
                      Einladungen werden mit deinem Cloud-Konto verschickt. Du kannst sie jetzt vormerken – sie gehen
                      nach der Anmeldung raus – oder später einladen.
                    </div>
                  </div>
                </div>
                <button className="btn sm" type="button" onClick={() => setSigningIn(true)}>
                  <Icon name="mail" size={18} />
                  Mit E-Mail anmelden
                </button>
              </div>
            )}
            {cloud === 'local' ? null : (
              <>
                <label className="f">
                  <span>E-Mail-Adresse</span>
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    placeholder="name@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                </label>
                <fieldset>
                  <legend>Boot-Vorschlag (optional)</legend>
                  <div className="chips" role="radiogroup" aria-label="Boot-Vorschlag">
                    <button className="chip" type="button" role="radio" aria-checked={inviteBoat === undefined} onClick={() => setInviteBoat(undefined)}>
                      Kein Vorschlag
                    </button>
                    {boats.map((b, i) => (
                      <button
                        key={`${b.name}-${i}`}
                        className="chip"
                        type="button"
                        role="radio"
                        aria-checked={inviteBoat === i}
                        onClick={() => setInviteBoat(i)}
                      >
                        <BoatShape boat={{ colorIndex: (i % 4) + 1 }} />
                        {b.name}
                      </button>
                    ))}
                  </div>
                </fieldset>
                {inviteError ? (
                  <div className="err" role="alert">
                    {inviteError}
                  </div>
                ) : null}
                <button className="btn block" type="button" onClick={addInvite}>
                  <Icon name="mail" size={20} />
                  Zur Liste hinzufügen
                </button>
                {invites.length ? (
                  <ul className="itemlist" aria-label="Einladungen">
                    {invites.map((inv, i) => (
                      <li key={inv.email}>
                        <i className="av sm" aria-hidden="true">
                          {nameFromEmail(inv.email).charAt(0)}
                        </i>
                        <div>
                          <b>{inv.email}</b>
                          <div className="muted">
                            {inv.boat !== undefined ? `Vorschlag: ${boats[inv.boat]?.name ?? ''}` : 'Kein Boot-Vorschlag'}
                          </div>
                        </div>
                        <span className="st warn">{signedIn ? 'wird eingeladen' : 'vorgemerkt'}</span>
                        <button
                          className="icon-btn"
                          type="button"
                          aria-label={`${inv.email} entfernen`}
                          onClick={() => setInvites((list) => list.filter((_, j) => j !== i))}
                        >
                          <Icon name="x" size={18} />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </section>
        ) : null}

        {signingIn ? <SignInDialog onClose={() => setSigningIn(false)} /> : null}
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
          {step === 2 && !signedIn && cloud !== 'local' ? (
            <button className="btn" type="button" disabled={saving} onClick={() => void finish(false)}>
              Später einladen
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
