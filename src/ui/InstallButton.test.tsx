import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstallButton, captureInstallPrompt, resetInstallPromptForTest } from './InstallButton';

function fire() {
  const ev = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn(async () => undefined),
    userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
  });
  act(() => {
    window.dispatchEvent(ev);
  });
  return ev;
}

function setStandalone(on: boolean): void {
  window.matchMedia = ((query: string) => ({ matches: on && query === '(display-mode: standalone)' })) as unknown as typeof window.matchMedia;
}

describe('InstallButton (App installieren)', () => {
  afterEach(cleanup);
  beforeEach(() => {
    setStandalone(false);
    resetInstallPromptForTest();
    captureInstallPrompt();
  });

  it('kein automatischer Hinweis: das Ereignis wird nur gemerkt', async () => {
    render(<InstallButton />);
    const ev = fire();
    expect(ev.defaultPrevented).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(ev.prompt).not.toHaveBeenCalled();
  });

  it('Browser bietet Installation an: Klick öffnet den Browser-Dialog', async () => {
    const ev = fire();
    render(<InstallButton />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'App installieren' }));
    expect(ev.prompt).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ohne Angebot des Browsers (iPhone, Kriterien nicht erfüllt): Klick zeigt die Anleitung', async () => {
    const user = userEvent.setup();
    render(<InstallButton />);
    await user.click(screen.getByRole('button', { name: 'App installieren' }));
    const dlg = screen.getByRole('dialog', { name: 'App installieren' });
    expect(dlg).toHaveTextContent('Zum Startbildschirm hinzufügen');
    expect(dlg).toHaveTextContent('Zum Home-Bildschirm');
    await user.click(within(dlg).getByRole('button', { name: 'OK' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Browser-Dialog schon benutzt: nächster Klick zeigt die Anleitung', async () => {
    const ev = fire();
    const user = userEvent.setup();
    render(<InstallButton />);
    await user.click(screen.getByRole('button', { name: 'App installieren' }));
    await user.click(screen.getByRole('button', { name: 'App installieren' }));
    expect(ev.prompt).toHaveBeenCalledOnce();
    expect(screen.getByRole('dialog', { name: 'App installieren' })).toBeInTheDocument();
  });

  it('als App gestartet oder gerade installiert: kein Button', () => {
    setStandalone(true);
    const { unmount } = render(<InstallButton />);
    expect(screen.queryByRole('button', { name: 'App installieren' })).toBeNull();
    unmount();

    setStandalone(false);
    render(<InstallButton />);
    fire();
    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(screen.queryByRole('button', { name: 'App installieren' })).toBeNull();
  });
});
