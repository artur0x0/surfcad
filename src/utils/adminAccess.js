/** Shared admin UI gates — keep ProfilePanel and /admin in lockstep. */

export const ADMIN_STATS_DAYS = Object.freeze([7, 30, 120]);

/**
 * @param {{ isLoading?: boolean, isAdmin?: boolean }} state
 * @returns {'pending' | 'allow' | 'not_found'}
 */
export function adminPageAccess({ isLoading = false, isAdmin = false } = {}) {
  if (isLoading) return 'pending';
  if (isAdmin === true) return 'allow';
  return 'not_found';
}

export function profileAdminVisible(user) {
  return user?.isAdmin === true;
}
