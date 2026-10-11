/** „eigenes Boot“ bzw. „nur lesen“. */
export function OwnershipBadge({ own }: { own: boolean }) {
  return own ? <span className="role fleet">eigenes Boot</span> : <span className="role ro">nur lesen</span>;
}
