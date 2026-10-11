export interface PhotoPlanInput {
  candidates: readonly { hash: string }[];
  /** Hashes of all photos already attached to entries or the report of that day. */
  existingDayHashes: ReadonlySet<string>;
  currentCount: number;
  max: number;
}

export interface PhotoPlan {
  accept: number[];
  skippedDuplicate: number;
  skippedLimit: number;
}

/** Decides which candidates (by index) may be stored: no day duplicates, within capacity. */
export function planPhotoAdds({ candidates, existingDayHashes, currentCount, max }: PhotoPlanInput): PhotoPlan {
  const seen = new Set(existingDayHashes);
  const accept: number[] = [];
  let skippedDuplicate = 0;
  let skippedLimit = 0;
  candidates.forEach((cand, i) => {
    if (seen.has(cand.hash)) {
      skippedDuplicate += 1;
    } else if (currentCount + accept.length >= max) {
      skippedLimit += 1;
    } else {
      seen.add(cand.hash);
      accept.push(i);
    }
  });
  return { accept, skippedDuplicate, skippedLimit };
}
