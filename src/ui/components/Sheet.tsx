import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from '../icons';

interface SheetProps {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
}

const FOCUSABLE =
  'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';

/** Bottom Sheet (modal): Escape schließt, Tab bleibt im Dialog, Fokus kehrt beim Schließen zurück. */
export function Sheet({ title, subtitle, onClose, footer, children }: SheetProps) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const raf = requestAnimationFrame(() => setOpen(true));
    closeBtn.current?.focus();
    const onKey = (ev: globalThis.KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

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
      <div className={open ? 'scrim open' : 'scrim'} onClick={onClose} aria-hidden="true" />
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
            <button ref={closeBtn} className="icon-btn" type="button" aria-label="Schließen" onClick={onClose}>
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
