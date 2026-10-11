import { useState } from 'react';
import type { DXCUserInteraction } from 'dexie-cloud-addon';
import { Dialog } from '../components/Dialog';
import { alertText } from '../cloudText';
import { useUserInteraction } from '../cloudHooks';

const TITLES: Record<DXCUserInteraction['type'], string> = {
  email: 'Anmelden',
  otp: 'Code eingeben',
  'message-alert': 'Hinweis',
  'logout-confirmation': 'Abmelden?',
  generic: 'Cloud',
};

function InteractionDialog({ ui }: { ui: DXCUserInteraction }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const fields = Object.entries(ui.fields ?? {}) as [string, { type: string; label?: string; placeholder?: string }][];
  const submit = (): void => ui.onSubmit(values);
  const label = (name: string, f: { label?: string }): string =>
    name === 'otp' ? 'Code aus der E-Mail' : name === 'email' ? 'E-Mail-Adresse' : (f.label ?? name);
  return (
    <Dialog title={TITLES[ui.type] ?? ui.title} onClose={ui.onCancel}>
      {ui.alerts.map((a, i) => (
        <p key={i} className={a.type === 'error' ? 'err' : 'muted'} role={a.type === 'error' ? 'alert' : undefined}>
          {alertText(a)}
        </p>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {fields.map(([name, f]) => (
          <label key={name} className="f">
            <span>{label(name, f)}</span>
            <input
              type={f.type === 'password' ? 'password' : 'text'}
              // Der Code enthält Buchstaben und Ziffern – keine Zifferntastatur, keine Autokorrektur.
              inputMode={name === 'email' ? 'email' : 'text'}
              autoComplete={name === 'otp' ? 'one-time-code' : name === 'email' ? 'email' : 'off'}
              autoCapitalize={name === 'otp' ? 'characters' : 'off'}
              autoCorrect="off"
              spellCheck={false}
              value={values[name] ?? ''}
              onChange={(e) => setValues({ ...values, [name]: e.target.value })}
            />
          </label>
        ))}
        <div className="share-choice">
          <button className={`btn block ${ui.type === 'logout-confirmation' ? 'danger' : 'primary'}`} type="submit">
            {ui.type === 'otp' ? 'Anmelden' : ui.type === 'logout-confirmation' ? 'Trotzdem abmelden' : 'Weiter'}
          </button>
          {ui.cancelLabel ? (
            <button className="btn block" type="button" onClick={ui.onCancel}>
              Abbrechen
            </button>
          ) : null}
        </div>
      </form>
    </Dialog>
  );
}

/** Rendert die vom Dexie-Cloud-Addon angeforderten Eingaben (customLoginGui) als eigene deutsche Dialoge. */
export function CloudLoginHost() {
  const ui = useUserInteraction();
  if (!ui) return null;
  // key: neuer Dialog je Schritt (E-Mail → Code), damit Eingaben nicht hängen bleiben
  return <InteractionDialog key={`${ui.type}-${ui.alerts.map((a) => a.messageCode).join()}`} ui={ui} />;
}
