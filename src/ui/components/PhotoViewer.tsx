import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { db } from '../../db/db';
import { usePhotoImage } from '../../db/hooks';
import type { ID } from '../../domain';
import { Icon } from '../icons';
import { useToast } from '../toast';

export interface ViewerPhoto {
  id: ID;
  /** Bildunterschrift, z. B. „14:05 · Seeschwalbe · Alice“. */
  caption?: string | undefined;
}

export type SwipeAction = 'next' | 'prev' | 'close' | 'none';

const SWIPE_X = 60;
const SWIPE_DOWN = 90;
const TAP_SLOP = 10;
const DOUBLE_TAP_MS = 300;
const ZOOM = 2.5;
const MAX_ZOOM = 5;

/** Wischgeste (nicht gezoomt): links → nächstes Foto, rechts → voriges, nach unten → schließen. */
export function classifySwipe(dx: number, dy: number): SwipeAction {
  if (Math.abs(dx) >= SWIPE_X && Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'next' : 'prev';
  if (dy >= SWIPE_DOWN && dy > Math.abs(dx)) return 'close';
  return 'none';
}

const HISTORY_KEY = 'photoViewer';
const isOurState = (): boolean =>
  typeof history.state === 'object' && history.state !== null && (history.state as Record<string, unknown>)[HISTORY_KEY] === true;

interface View {
  scale: number;
  x: number;
  y: number;
}
const NO_ZOOM: View = { scale: 1, x: 0, y: 0 };
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

function extension(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  return 'jpg';
}

/** Teilen (Web Share mit Datei), sonst als Datei herunterladen. */
async function shareOrSave(photoId: ID, name: string): Promise<'shared' | 'saved' | 'cancelled'> {
  const row = await db.photos.get(photoId);
  if (!row?.blob) throw new Error('photo missing');
  const file = new File([row.blob], `${name}.${extension(row.mime)}`, { type: row.mime });
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'saved';
}

/**
 * Vollbild-Fotoansicht (Crew-App und Daheim-Ansicht): Originalbild auf dunklem Grund, Wischen/Pfeile zwischen den
 * Fotos desselben Eintrags/Abschnitts, Zähler und Bildunterschrift, Pinch- und Doppeltipp-Zoom. Schließen per X,
 * Wischen nach unten, Esc und Zurück-Geste (eigener History-Eintrag).
 */
export function PhotoViewer({ photos, start, onClose }: { photos: readonly ViewerPhoto[]; start: number; onClose: () => void }) {
  const toast = useToast();
  const [index, setIndex] = useState(() => clamp(start, 0, Math.max(0, photos.length - 1)));
  const [view, setView] = useState<View>(NO_ZOOM);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [gesturing, setGesturing] = useState(false);
  const closed = useRef(false);
  const onCloseRef = useRef(onClose);
  const box = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const photo = photos[index];
  const { url, missing } = usePhotoImage(photo?.id);
  const many = photos.length > 1;

  const close = useCallback((): void => {
    if (closed.current) return;
    closed.current = true;
    onCloseRef.current();
    if (isOurState()) history.back();
  }, []);
  const go = useCallback(
    (delta: number): void => {
      setIndex((i) => clamp(i + delta, 0, photos.length - 1));
      setView(NO_ZOOM);
    },
    [photos.length],
  );

  // Zurück-Geste (Android) schließt: eigener History-Eintrag, popstate = schließen
  useEffect(() => {
    if (isOurState()) history.replaceState({ ...(history.state as object), [HISTORY_KEY]: true }, '');
    else history.pushState({ [HISTORY_KEY]: true }, '');
    const onPop = (): void => {
      if (closed.current) return;
      closed.current = true;
      onCloseRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Tastatur vor Sheet/Dialog abfangen (die hören auf document): Esc, Pfeile
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeBtn.current?.focus();
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') close();
      else if (ev.key === 'ArrowRight') go(1);
      else if (ev.key === 'ArrowLeft') go(-1);
      else return;
      ev.preventDefault();
      ev.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (previous?.isConnected) previous.focus();
    };
  }, [close, go]);

  // ---------- Gesten ----------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ x: number; y: number; view: View; pinch?: { d: number; scale: number }; moved: boolean } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if ((e.target as HTMLElement).closest('button,a')) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setGesturing(true);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      gesture.current = { x: e.clientX, y: e.clientY, view, pinch: { d: dist(pts[0]!, pts[1]!), scale: view.scale }, moved: true };
    } else if (pts.length === 1) {
      gesture.current = { x: e.clientX, y: e.clientY, view, moved: false };
    }
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const pts = [...pointers.current.values()];
    if (g.pinch && pts.length >= 2) {
      const scale = clamp((g.pinch.scale * dist(pts[0]!, pts[1]!)) / g.pinch.d, 1, MAX_ZOOM);
      setView({ ...g.view, scale });
      return;
    }
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (Math.abs(dx) > TAP_SLOP || Math.abs(dy) > TAP_SLOP) g.moved = true;
    if (g.view.scale > 1) setView({ ...g.view, x: g.view.x + dx, y: g.view.y + dy });
    else setDrag({ x: dx, y: Math.max(0, dy) });
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>): void => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) setGesturing(false);
    const g = gesture.current;
    if (!g) return;
    if (g.pinch) {
      if (pointers.current.size === 0) {
        gesture.current = null;
        setView((v) => (v.scale < 1.05 ? NO_ZOOM : v));
      }
      return;
    }
    gesture.current = null;
    setDrag({ x: 0, y: 0 });
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.moved) {
      // Doppeltipp: an der Stelle hinein-, sonst herauszoomen
      const prev = lastTap.current;
      const now = e.timeStamp;
      if (prev && now - prev.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 30) {
        lastTap.current = null;
        if (view.scale > 1) setView(NO_ZOOM);
        else {
          const r = e.currentTarget.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          setView({ scale: ZOOM, x: (cx - e.clientX) * (ZOOM - 1), y: (cy - e.clientY) * (ZOOM - 1) });
        }
      } else lastTap.current = { t: now, x: e.clientX, y: e.clientY };
      return;
    }
    if (g.view.scale > 1) return;
    const action = classifySwipe(dx, dy);
    if (action === 'next') go(1);
    else if (action === 'prev') go(-1);
    else if (action === 'close') close();
  };
  const onPointerCancel = (e: PointerEvent<HTMLDivElement>): void => {
    pointers.current.delete(e.pointerId);
    gesture.current = null;
    setGesturing(false);
    setDrag({ x: 0, y: 0 });
  };

  // Tab bleibt im Viewer (und erreicht kein Sheet dahinter)
  const trapTab = (ev: ReactKeyboardEvent<HTMLDivElement>): void => {
    ev.stopPropagation();
    if (ev.key !== 'Tab' || !box.current) return;
    const items = [...box.current.querySelectorAll<HTMLElement>('button:not([disabled])')];
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

  const share = async (): Promise<void> => {
    if (!photo) return;
    try {
      const r = await shareOrSave(photo.id, `logbuch-foto-${index + 1}`);
      if (r === 'saved') toast('Foto gespeichert');
    } catch {
      toast('Foto konnte nicht geteilt werden');
    }
  };

  if (!photo) return null;
  const counter = `${index + 1} / ${photos.length}`;
  const moving = drag.x !== 0 || drag.y !== 0;
  const transform = moving
    ? `translate(${drag.x}px, ${drag.y}px)`
    : `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  return createPortal(
    <div
      ref={box}
      className="pv"
      role="dialog"
      aria-modal="true"
      aria-label={`Foto ${counter}`}
      onKeyDown={trapTab}
      style={moving && drag.y > 0 ? { backgroundColor: `rgba(0,0,0,${Math.max(0.4, 1 - drag.y / 400)})` } : undefined}
    >
      <div className="pv-top">
        <span className="pv-count num" aria-live="polite">
          {many ? counter : ''}
        </span>
        <button className="pv-btn" type="button" onClick={() => void share()} aria-label="Foto teilen oder speichern">
          <Icon name="up" size={22} />
        </button>
        <button ref={closeBtn} className="pv-btn" type="button" onClick={close} aria-label="Foto schließen">
          <Icon name="x" size={24} />
        </button>
      </div>
      <div
        className="pv-stage"
        data-testid="photo-viewer-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {url ? (
          <img
            src={url}
            alt={photo.caption ? `Foto ${counter}: ${photo.caption}` : `Foto ${counter}`}
            draggable={false}
            style={{ transform, transition: gesturing ? 'none' : 'transform .18s ease-out' }}
          />
        ) : (
          <p className="pv-msg">{missing ? 'Foto nicht übertragen' : 'Foto wird geladen …'}</p>
        )}
        {many && index > 0 ? (
          <button className="pv-btn pv-prev" type="button" aria-label="Vorheriges Foto" onClick={() => go(-1)}>
            <Icon name="chev-l" size={28} />
          </button>
        ) : null}
        {many && index < photos.length - 1 ? (
          <button className="pv-btn pv-next" type="button" aria-label="Nächstes Foto" onClick={() => go(1)}>
            <Icon name="chev-r" size={28} />
          </button>
        ) : null}
      </div>
      {photo.caption ? <p className="pv-cap">{photo.caption}</p> : null}
    </div>,
    document.body,
  );
}

/** Zustand „welches Foto ist offen“ für eine Fotoliste. */
export function usePhotoViewer(photos: readonly ViewerPhoto[]): { open: (index: number) => void; viewer: ReactElement | null } {
  const [start, setStart] = useState<number>();
  const viewer =
    start === undefined ? null : <PhotoViewer key={start} photos={photos} start={start} onClose={() => setStart(undefined)} />;
  return { open: setStart, viewer };
}
