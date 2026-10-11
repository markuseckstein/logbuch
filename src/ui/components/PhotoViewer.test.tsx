import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db/db';
import { ToastProvider } from '../toast';
import { useCleanDb } from '../test-utils';
import { PhotoViewer, classifySwipe, type ViewerPhoto } from './PhotoViewer';
import { PhotoGrid } from './PhotoImage';

const photos: ViewerPhoto[] = [
  { id: 'p1', caption: '14:05 · Seeschwalbe · Alice' },
  { id: 'p2', caption: '14:05 · Seeschwalbe · Alice' },
  { id: 'p3' },
];

async function seedPhotos(): Promise<void> {
  await db.photos.bulkPut(
    ['p1', 'p2', 'p3'].map((id, i) => ({ id, tripId: 't', blob: new Blob([id], { type: 'image/jpeg' }), mime: 'image/jpeg', width: 2000, height: 1500, createdAt: i })),
  );
}

function Host({ start = 0, onClose = vi.fn() }: { start?: number; onClose?: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <ToastProvider>
      {open ? (
        <PhotoViewer
          photos={photos}
          start={start}
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        />
      ) : (
        <p>zu</p>
      )}
    </ToastProvider>
  );
}

const stage = () => screen.getByTestId('photo-viewer-stage');
function swipe(dx: number, dy: number): void {
  fireEvent.pointerDown(stage(), { pointerId: 1, clientX: 200, clientY: 300 });
  fireEvent.pointerMove(stage(), { pointerId: 1, clientX: 200 + dx, clientY: 300 + dy });
  fireEvent.pointerUp(stage(), { pointerId: 1, clientX: 200 + dx, clientY: 300 + dy });
}

describe('classifySwipe', () => {
  it('links → nächstes, rechts → voriges, runter → schließen, kleine Bewegung → nichts', () => {
    expect(classifySwipe(-80, 10)).toBe('next');
    expect(classifySwipe(80, -10)).toBe('prev');
    expect(classifySwipe(10, 120)).toBe('close');
    expect(classifySwipe(-120, -200)).toBe('none'); // nach oben schließt nicht
    expect(classifySwipe(20, 20)).toBe('none');
  });
});

describe('PhotoViewer', () => {
  useCleanDb();
  beforeEach(async () => {
    await seedPhotos();
    history.replaceState(null, '');
  });
  afterEach(() => vi.restoreAllMocks());

  it('zeigt Zähler und Bildunterschrift, blättert per Pfeil-Buttons und Tastatur', async () => {
    const user = userEvent.setup();
    render(<Host start={1} />);
    const dlg = screen.getByRole('dialog', { name: 'Foto 2 / 3' });
    expect(dlg).toHaveTextContent('2 / 3');
    expect(dlg).toHaveTextContent('14:05 · Seeschwalbe · Alice');
    expect(await screen.findByRole('img', { name: /Foto 2 \/ 3/ })).toHaveAttribute('src', 'blob:test');
    await user.click(screen.getByRole('button', { name: 'Nächstes Foto' }));
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Foto 3 / 3');
    expect(screen.queryByRole('button', { name: 'Nächstes Foto' })).toBeNull(); // am Ende
    await user.keyboard('{ArrowLeft}');
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Foto 1 / 3');
    expect(screen.queryByRole('button', { name: 'Vorheriges Foto' })).toBeNull();
  });

  it('wischt zwischen den Fotos und schließt beim Wischen nach unten', async () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    swipe(-100, 5);
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Foto 2 / 3');
    swipe(100, 0);
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Foto 1 / 3');
    swipe(5, 30); // zu kurz
    expect(onClose).not.toHaveBeenCalled();
    swipe(0, 150);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByText('zu')).toBeInTheDocument();
  });

  it('Doppeltipp zoomt hinein und wieder heraus; gezoomt blättert Wischen nicht', async () => {
    render(<Host />);
    const img = await screen.findByRole('img', { name: /Foto 1 \/ 3/ });
    const tap = (t: number): void => {
      fireEvent.pointerDown(stage(), { pointerId: 1, clientX: 100, clientY: 100, timeStamp: t });
      fireEvent.pointerUp(stage(), { pointerId: 1, clientX: 100, clientY: 100, timeStamp: t });
    };
    tap(1000);
    tap(1150);
    expect(img.style.transform).toContain('scale(2.5)');
    swipe(-100, 0); // verschiebt nur
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Foto 1 / 3');
    tap(5000);
    tap(5100);
    expect(img.style.transform).toContain('scale(1)');
  });

  it('schließt per X und Esc und nimmt dabei den eigenen History-Eintrag zurück', async () => {
    const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { unmount } = render(<Host onClose={onClose} />);
    expect(history.state).toEqual({ photoViewer: true });
    await user.click(screen.getByRole('button', { name: 'Foto schließen' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(back).toHaveBeenCalledTimes(1);
    unmount();

    history.replaceState(null, '');
    render(<Host onClose={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('Zurück-Geste (popstate) schließt, ohne erneut zurückzugehen', async () => {
    const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    act(() => {
      history.replaceState(null, ''); // Browser ist bereits zurückgegangen
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
    expect(screen.getByText('zu')).toBeInTheDocument();
  });

  it('Esc schließt nur den Viewer, nicht das Sheet dahinter', async () => {
    const sheetEsc = vi.fn();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') sheetEsc();
    };
    document.addEventListener('keydown', onKey);
    try {
      render(<Host />);
      await userEvent.setup().keyboard('{Escape}');
      expect(screen.getByText('zu')).toBeInTheDocument();
      expect(sheetEsc).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', onKey);
    }
  });
});

describe('PhotoGrid öffnet den Viewer', () => {
  useCleanDb();
  beforeEach(seedPhotos);
  it('antippen öffnet das Foto groß mit Bildunterschrift', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <PhotoGrid photoIds={['p1', 'p2']} caption="10:00 · Möwe · Bob" />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Foto 2 groß anzeigen' }));
    const dlg = screen.getByRole('dialog', { name: 'Foto 2 / 2' });
    expect(dlg).toHaveTextContent('10:00 · Möwe · Bob');
    await user.click(screen.getByRole('button', { name: 'Foto schließen' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
