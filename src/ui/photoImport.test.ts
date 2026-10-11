import { describe, expect, it } from 'vitest';
import { photoImportMessage } from './photoImport';

const r = (o: Partial<Parameters<typeof photoImportMessage>[0]>) => ({ added: 0, skippedDuplicate: 0, skippedLimit: 0, failed: 0, ...o });

describe('photoImportMessage', () => {
  it('reports added and duplicates', () => {
    expect(photoImportMessage(r({ added: 3, skippedDuplicate: 1 }), 'max. 5 pro Eintrag'))
      .toBe('3 Fotos hinzugefügt · 1 übersprungen (schon an diesem Tag vorhanden)');
  });
  it('reports limit skips and singular', () => {
    expect(photoImportMessage(r({ added: 1, skippedLimit: 2 }), 'max. 5 pro Eintrag'))
      .toBe('1 Foto hinzugefügt · 2 übersprungen (max. 5 pro Eintrag)');
  });
  it('handles nothing added and failures', () => {
    expect(photoImportMessage(r({ skippedDuplicate: 2, failed: 1 }), 'x'))
      .toBe('Kein Foto hinzugefügt · 2 übersprungen (schon an diesem Tag vorhanden) · 1 fehlgeschlagen');
  });
});
