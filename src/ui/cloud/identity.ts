import { db } from '../../db/db';
import { linkCrewEmail, setAuthor } from '../../db/repo';
import { isSharedRealm, type ID, type Trip } from '../../domain';

/**
 * „Ich bin …“ setzen; im Cloud-Logbuch zusätzlich das Crew-Mitglied mit der Konto-E-Mail verknüpfen,
 * damit es auf allen eigenen Geräten (auch nach Ab-/Anmelden) gilt.
 */
export async function chooseAuthor(trip: Pick<Trip, 'id' | 'realmId'>, crewId: ID): Promise<void> {
  await setAuthor(db, trip.id, crewId);
  const email = db.cloudUser()?.email;
  if (email && isSharedRealm(trip.realmId)) await linkCrewEmail(db, crewId, email).catch(() => undefined);
}
