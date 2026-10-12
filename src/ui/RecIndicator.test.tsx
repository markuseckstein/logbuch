import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RecIndicator } from './App';
import { LiveRouteContext } from './live';
import { makeActions, renderUi, useCleanDb } from './test-utils';

describe('RecIndicator', () => {
  useCleanDb();

  it('ist ein Knopf: Tipp löst „zum Live-Route-Schalter“ aus', async () => {
    const actions = makeActions();
    renderUi(
      <LiveRouteContext.Provider value={{ active: true, startedAt: Date.now() - 2000, start: vi.fn(), stop: vi.fn() }}>
        <RecIndicator />
      </LiveRouteContext.Provider>,
      actions,
    );
    const rec = await screen.findByRole('button', { name: /Live-Route wird aufgezeichnet.*Antippen zum Beenden/ });
    expect(rec).toHaveTextContent(/REC 0:00:0\d/);
    await userEvent.setup().click(rec);
    expect(actions.focusLiveToggle).toHaveBeenCalledTimes(1);
  });

  it('fehlt ohne laufende Aufzeichnung', () => {
    renderUi(<RecIndicator />);
    expect(screen.queryByRole('button', { name: /Live-Route/ })).not.toBeInTheDocument();
  });
});
