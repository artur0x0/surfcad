/**
 * Revoke agent tokens, then persist the new credentials.
 * A failed revoke leaves the previous password in the database, so a
 * token never outlives credentials the revoke did not get to drop.
 * @param {{ _id: unknown, save: () => Promise<unknown> }} user
 * @param {(userId: unknown) => Promise<unknown>} revoke
 */
export async function persistAfterAgentRevoke(user, revoke) {
  await revoke(user._id);
  await user.save();
}
