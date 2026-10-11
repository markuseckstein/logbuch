# device/ – Vertrag (Schnittstelle für die UI)

Dünne Adapter um Browser-APIs. Die UI importiert nur aus `src/device/index.ts`.

```ts
// geolocation.ts
export type FixError = 'denied' | 'unavailable' | 'timeout' | 'unsupported';
export interface FixResult { position?: Position; error?: FixError }
/** Schneller Fix (gecachte/grobe Position erlaubt, ~3 s), danach Verbesserung per watchPosition
 *  für max. `improveForMs` (Default 20 s). `onImproved` wird bei jeder genaueren Position gerufen.
 *  Rückgabe: Promise des ersten Ergebnisses + stop()-Funktion. */
export function captureFix(opts?: { onImproved?: (p: Position) => void; improveForMs?: number }):
  { first: Promise<FixResult>; stop: () => void };

// image.ts
/** Verkleinert auf max. Kantenlänge (Default 2000 px), JPEG Qualität 0.85, EXIF-Orientierung beachtet. */
export function resizeImage(file: Blob, opts?: { maxEdge?: number; quality?: number }):
  Promise<{ blob: Blob; width: number; height: number; mime: string }>;

// wakeLock.ts
/** Fordert Screen Wake Lock an, erneuert ihn bei visibilitychange. Rückgabe: release(). null wenn nicht unterstützt. */
export function keepScreenOn(): Promise<(() => void) | null>;

// liveTrack.ts
/** watchPosition-basiertes Live-Tracking (nur Vordergrund). Punkte werden gefiltert:
 *  mind. `minIntervalMs` (Default 30 s) UND mind. `minDistanceM` (Default 25 m) seit letztem Punkt, Genauigkeit ≤ 50 m. */
export function startLiveTracking(opts: { onPoint: (p: TrackPoint) => void; onError?: (e: FixError) => void;
  minIntervalMs?: number; minDistanceM?: number }): () => void;

// files.ts
/** Teilt die Datei per Web Share (wenn canShare({files})), sonst Download über <a download>. */
export function saveOrShareFile(blob: Blob, fileName: string): Promise<'shared' | 'downloaded' | 'cancelled'>;
/** Öffnet Dateiauswahl und liefert die Datei (oder null bei Abbruch). */
export function pickFile(accept: string): Promise<File | null>;
```
