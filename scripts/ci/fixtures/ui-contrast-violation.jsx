/** Fixture for test/ui-contrast-guard.test.js — must be caught by the scan. */
export function UiContrastViolationFixture() {
  return (
    <div className="surface-dark text-black font-ui">
      Black text on a dark brand surface is unreadable.
    </div>
  );
}
