/**
 * Surfaces the harness must not grow a command for.
 *
 * Quote, order, cart, and checkout spend money. They stay on the screen
 * for a person. A coverage check may list them as exempt, and that list
 * must not shrink into a command.
 */

export const AGENT_EXEMPT = Object.freeze([
  Object.freeze({
    id: 'quote',
    surface: 'QuoteModal',
    reason: 'Commerce spends money. Quote is permanently exempt from the agent harness.',
  }),
  Object.freeze({
    id: 'order',
    surface: 'part-row Order',
    reason: 'Commerce spends money. Order is permanently exempt from the agent harness.',
  }),
  Object.freeze({
    id: 'cart',
    surface: 'cart',
    reason: 'Commerce spends money. Cart is permanently exempt from the agent harness.',
  }),
  Object.freeze({
    id: 'checkout',
    surface: 'checkout',
    reason: 'Commerce spends money. Checkout is permanently exempt from the agent harness.',
  }),
  Object.freeze({
    id: 'data-scs-surf-quote',
    surface: 'SheetMetal ScsHandoff',
    reason: 'Commerce spends money; SurfCAD quote is permanently exempt from the agent harness.',
  }),
]);
