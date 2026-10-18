/**
 * Imperative opener for the privacy consent popup.
 * Profile menus, the privacy page, and a later Account pane call this.
 */

const openers = new Set();

/** Re-open Accept all / Required only (first-visit popup, or later change). */
export function openPrivacyChoices() {
  for (const cb of openers) {
    try {
      cb();
    } catch {
      /* opener */
    }
  }
}

/**
 * @param {() => void} callback
 * @returns {() => void} unsubscribe
 */
export function onOpenPrivacyChoices(callback) {
  openers.add(callback);
  return () => openers.delete(callback);
}
