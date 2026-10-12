import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from '../icons';

interface SheetProps {
  title: string;
  subtitle?: ReactNode;
  /** Schließen (X, Hintergrund, Esc, Zurück-Geste). Rückgabe `false` = bleibt offen (z. B. Eingabefehler). */
  onClose: () => void | boolean | Promise<void | boolean>;
  footer: ReactNode;
  children: ReactNode;
}

const FOCUSABLE =
  'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';

const HISTORY_KEY = 'sheet';
const isSheetState = (): boolean =>
  typeof history.state === 'object' && history.state !== null && (history.state as Record<string, unknown>)[HISTORY_KEY] === true;
let mounted = 0;

/** Bottom Sheet (modal): Escape und Zurück-Geste schließen, Tab bleibt im Dialog, Fokus kehrt beim Schließen zurück. */
export function Sheet({ title, subtitle, onClose, footer, children }: SheetProps) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const attemptClose = useCallback(async (): Promise<boolean> => (await onCloseRef.current()) !== false, []);

  // Zurück-Geste (Android): eigener History-Eintrag; popstate = schließen (bleibt das Sheet offen, Eintrag erneuern)
  useEffect(() => {
    mounted += 1;
    if (!isSheetState()) history.pushState({ ...(history.state as object | null), [HISTORY_KEY]: true }, '');
    const onPop = (): void => {
      void attemptClose().then((closed) => {
        if (!closed && !isSheetState()) history.pushState({ [HISTORY_KEY]: true }, '');
      });
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      mounted -= 1;
      // Eigenen Eintrag wieder entfernen (verzögert: React-StrictMode mountet sofort neu)
      setTimeout(() => {
        if (mounted === 0 && isSheetState()) history.back();
      }, 0);
    };
  }, [attemptClose]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const raf = requestAnimationFrame(() => setOpen(true));
    closeBtn.current?.focus();
    const onKey = (ev: globalThis.KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        void attemptClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      if (previous?.isConnected) previous.focus();
    };
  }, [attemptClose]);

  const trapTab = (ev: KeyboardEvent<HTMLElement>): void => {
    if (ev.key !== 'Tab' || !dialog.current) return;
    const items = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[hidden]'));
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <div className={open ? 'scrim open' : 'scrim'} onClick={() => void attemptClose()} aria-hidden="true" />
      <section
        ref={dialog}
        className={open ? 'sheet open' : 'sheet'}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sh-title"
        onKeyDown={trapTab}
      >
        <div className="sh-head">
          <div className="grab" />
          <div className="sh-row">
            <div>
              <h2 id="sh-title">{title}</h2>
              {subtitle ? <div className="mono muted">{subtitle}</div> : null}
            </div>
            <button ref={closeBtn} className="icon-btn" type="button" aria-label="Schließen" onClick={() => void attemptClose()}>
              <Icon name="x" />
            </button>
          </div>
        </div>
        <div className="sh-body">{children}</div>
        <div className="sh-foot">{footer}</div>
      </section>
    </>
  );
}
