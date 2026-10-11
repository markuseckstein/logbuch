import { useCallback, useState } from 'react';
import { hashBlob, resizeImage } from '../device';
import { db } from '../db/db';
import {
  MAX_PHOTOS_PER_DAY_REPORT, MAX_PHOTOS_PER_ENTRY, MaxPhotosError, addPhotosToDayReport, addPhotosToEntry,
  dayPhotoHashes, type PhotoInput,
} from '../db/repo';
import { localDate, planPhotoAdds, type ID, type LogEntry } from '../domain';
import { useToast } from './toast';

export type PhotoTarget =
  | { kind: 'entry'; entry: Pick<LogEntry, 'id' | 'tripId' | 'time' | 'tzOffsetMin' | 'photoIds'> }
  | { kind: 'report'; tripId: ID; date: string; photoIds: readonly ID[] };

export interface PhotoImportResult {
  added: number;
  skippedDuplicate: number;
  skippedLimit: number;
  failed: number;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Toast-Text, z. B. "3 Fotos hinzugefügt · 1 übersprungen (schon an diesem Tag vorhanden)". */
export function photoImportMessage(r: PhotoImportResult, limitLabel: string): string {
  const parts = [r.added > 0 ? `${plural(r.added, 'Foto', 'Fotos')} hinzugefügt` : 'Kein Foto hinzugefügt'];
  if (r.skippedDuplicate > 0) parts.push(`${r.skippedDuplicate} übersprungen (schon an diesem Tag vorhanden)`);
  if (r.skippedLimit > 0) parts.push(`${r.skippedLimit} übersprungen (${limitLabel})`);
  if (r.failed > 0) parts.push(`${r.failed} fehlgeschlagen`);
  return parts.join(' · ');
}

export function targetInfo(t: PhotoTarget): { tripId: ID; date: string; max: number; count: number; limitLabel: string } {
  if (t.kind === 'entry') {
    const { entry } = t;
    return {
      tripId: entry.tripId, date: localDate(entry.time, entry.tzOffsetMin), max: MAX_PHOTOS_PER_ENTRY,
      count: entry.photoIds.length, limitLabel: `max. ${MAX_PHOTOS_PER_ENTRY} pro Eintrag`,
    };
  }
  return {
    tripId: t.tripId, date: t.date, max: MAX_PHOTOS_PER_DAY_REPORT, count: t.photoIds.length,
    limitLabel: `max. ${MAX_PHOTOS_PER_DAY_REPORT} pro Tagesbericht`,
  };
}

/** Hash -> Dedup-Plan -> Verkleinern (nacheinander) -> atomar speichern. */
export async function importPhotos(
  files: readonly File[], target: PhotoTarget, onProgress: (text: string | undefined) => void,
): Promise<PhotoImportResult & { limitLabel: string }> {
  const { tripId, date, max, count, limitLabel } = targetInfo(target);
  let failed = 0;
  onProgress('Fotos werden geprüft …');
  const hashed: { file: File; hash: string }[] = [];
  for (const file of files) {
    try {
      hashed.push({ file, hash: await hashBlob(file) });
    } catch {
      failed += 1;
    }
  }
  const plan = planPhotoAdds({
    candidates: hashed, existingDayHashes: await dayPhotoHashes(db, tripId, date), currentCount: count, max,
  });
  const inputs: PhotoInput[] = [];
  for (const [n, idx] of plan.accept.entries()) {
    const item = hashed[idx]!;
    onProgress(`Foto ${n + 1} von ${plan.accept.length} …`);
    try {
      inputs.push({ ...(await resizeImage(item.file)), hash: item.hash });
    } catch {
      failed += 1;
    }
  }
  let added = 0;
  if (inputs.length > 0) {
    try {
      if (target.kind === 'entry') await addPhotosToEntry(db, target.entry.id, inputs);
      else await addPhotosToDayReport(db, tripId, date, inputs);
      added = inputs.length;
    } catch (err) {
      if (!(err instanceof MaxPhotosError)) throw err;
      failed += inputs.length;
    }
  }
  onProgress(undefined);
  return { added, skippedDuplicate: plan.skippedDuplicate, skippedLimit: plan.skippedLimit, failed, limitLabel };
}

/** Hook für PhotoPicker: onAdd(files) mit Fortschritt und Toast. */
export function usePhotoImport(target: PhotoTarget): { onAdd: (files: File[]) => Promise<void>; progress?: string } {
  const toast = useToast();
  const [progress, setProgress] = useState<string>();
  const onAdd = useCallback(
    async (files: File[]): Promise<void> => {
      if (files.length === 0) return;
      try {
        const { limitLabel, ...result } = await importPhotos(files, target, setProgress);
        toast(photoImportMessage(result, limitLabel));
      } catch {
        setProgress(undefined);
        toast('Fotos konnten nicht gespeichert werden');
      }
    },
    [target, toast],
  );
  return { onAdd, progress };
}
