import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderUi, useCleanDb } from '../test-utils';
import { PhotoImage } from './PhotoImage';

describe('PhotoImage', () => {
  useCleanDb();

  it('zeigt „Foto nicht übertragen“, wenn das Bild lokal fehlt', async () => {
    renderUi(<PhotoImage photoId="gibt-es-nicht" alt="Foto" />);
    expect(await screen.findByRole('img', { name: 'Foto nicht übertragen' })).toBeInTheDocument();
  });
});
