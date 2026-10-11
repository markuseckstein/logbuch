import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

interface DialogProps {
  title: string;
  /** Escape / Abbrechen. Fehlt, ist der Dialog nur über seine Aktionen zu verlassen. */
  onClose?: () => void;
  children: ReactNode;
}

const FOCUSABLE = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])';

/** Modaler In-Page-Dialog (statt confirm/prompt): Fokus wandert hinein, Tab bleibt drin, Escape schließt. */
export function Dialog({ title, onClose, children }: DialogProps) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    box.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (ev: globalThis.KeyboardEvent): void => {
      if (ev.key === 'Escape' && closeRef.current) {
        ev.preventDefault();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const trapTab = (ev: KeyboardEvent<HTMLElement>): void => {
    if (ev.key !== 'Tab' || !box.current) return;
    const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
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
      <div className="scrim open dlg" aria-hidden="true" onClick={onClose} />
      <div ref={box} className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={trapTab}>
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </>
  );
}
