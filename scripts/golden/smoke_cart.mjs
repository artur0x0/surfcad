#!/usr/bin/env node
/**
 * Cart UI: part-row order, chip badge, sheet, flight, and local sync.
 * A 404 from /api/cart stays on localStorage. Checkout is not this slice.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { orderIntent, scriptHash } from '../../src/utils/cart.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

let failed = 0;
let passed = 0;
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
}

console.log('cart — hash');
ok('scriptHash is 32 hex chars', /^[0-9a-f]{32}$/.test(scriptHash('let part = 1;')));
ok('signed-out order is login, reauth-sized signedIn is add',
  orderIntent({ signedIn: false }) === 'login'
  && orderIntent({ signedIn: true }) === 'add');

console.log('\ncart — UI wiring (source)');
{
  const feed = read('src/components/PartFeed.jsx');
  const chip = read('src/components/ProfileChip.jsx');
  const panel = read('src/components/ProfilePanel.jsx');
  const drop = read('src/components/CartDrop.jsx');
  const sheet = read('src/components/CartSheet.jsx');
  const app = read('src/App.jsx');
  const toolbar = read('src/components/Toolbar.jsx');
  const view = read('src/components/Viewport.jsx');
  const sync = read('src/utils/cartSync.js');
  const storage = read('src/utils/cartStorage.js');
  const cart = read('src/utils/cart.js');
  const hook = read('src/hooks/useCart.jsx');
  const clear = read('src/utils/clearLocalCadData.js');
  const ui = read('docs/ui-map.md');
  const arch = read('docs/architecture.md');
  const pkg = read('package.json');
  const row = feed.slice(feed.indexOf('const renderPartRow'));

  ok('part row orders with stopPropagation and disables missing or error',
    /data-part-order=\{row\.id\}/.test(row)
    && /stopPropagation\(\)/.test(row)
    && /disabled=\{!!\(row\.missing \|\| row\.error\)\}/.test(row));
  ok('truck left the toolbar; upload and download left the tray',
    !/Get Quote/.test(toolbar)
    && !/<Truck /.test(toolbar)
    && !/onQuote/.test(toolbar)
    && !/data-script-upload/.test(toolbar)
    && !/data-script-download/.test(toolbar)
    && /data-part-upload/.test(feed)
    && /data-part-download/.test(feed)
    && !/data-cad-io-tray/.test(view)
    && !/onQuote/.test(view));
  ok('chip badge and signed-in profile cart row',
    /data-cart-badge/.test(chip)
    && /data-cart-count/.test(chip)
    && /data-profile-cart/.test(panel)
    && /showCart/.test(panel));
  ok('flight targets the thumbnail and the on-screen chip',
    /data-cart-flight/.test(drop)
    && /data-part-thumbnail/.test(hook)
    && /cartChipSelector/.test(hook)
    && /data-parts-profile-chip/.test(cart)
    && /data-profile-chip-variant="viewport"/.test(cart));
  ok('sheet has two-line rows, qty, and a checkout button',
    /data-cart-sheet/.test(sheet)
    && /data-cart-line=/.test(sheet)
    && /data-cart-checkout/.test(sheet)
    && /startCheckout/.test(sheet)
    && !/Checkout is coming next/.test(sheet));
  ok('App wires the cart and login, not the old quote button',
    /useCart\(/.test(app)
    && /<CartSheet /.test(app)
    && /<CartDrop /.test(app)
    && /setShowLoginModal\(true\)/.test(app)
    && !/const handleQuote = /.test(app));
  ok('storage key and 404 local-only flag',
    /surfcad_cart:/.test(storage)
    && /surfcad_cart_uploaded:/.test(storage)
    && /interpretCartResponse/.test(sync)
    && /markCartSyncLocalOnly/.test(sync));
  ok('clear local cache keeps cart keys',
    /surfcad_cart:/.test(clear)
    && !/removeItem\([^)]*surfcad_cart/.test(clear));
  ok('puzzle corner is untouched',
    /data-puzzle-unlock/.test(read('src/components/PuzzleUnlock.jsx'))
    && /z-20/.test(read('src/components/PuzzleUnlock.jsx'))
    && /<PuzzleUnlock enabled=\{mode !== 'game'\} onUnlock=\{onStartGame\} \/>/.test(view));
  ok('UI map and architecture mention the cart',
    /data-part-order/.test(ui) && /data-cart-badge/.test(ui) && /Cart/.test(arch));
  ok('package.json has golden:cart', /golden:cart/.test(pkg));
}

console.log(failed ? `\n❌ FAIL (${failed} failed, ${passed} passed)` : `\n✅ PASS (${passed})`);
process.exit(failed ? 1 : 0);
