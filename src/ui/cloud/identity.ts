import { db } from '../../db/db';
import { setAuthor } from '../../db/repo';
import type { ID, Trip } from '../../domain';

/** „Ich bin …“ auf diesem Gerät setzen (lokaler Modus; angemeldet gilt die Person mit der Konto-E-Mail). */
export async function chooseAuthor(trip: Pick<Trip, 'id'>, crewId: ID): Promise<void> {
  await setAuthor(db, trip.id, crewId);
}
