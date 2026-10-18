/**
 * Shared classes for inline profile-menu rows (Connect agent, Account, Sign out).
 * White text on dark chrome — same row height/padding as Cart, not a big button.
 */

export const PROFILE_MENU_ITEM_CLASS = [
  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs',
  'text-on-dark font-ui hover:bg-white/10',
].join(' ');
