const LAYER_ID = 'surfcad-agent-visible-layer';

function prefersReducedMotion() {
  try {
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * DOM overlay: synthetic cursor, highlight ring, click ripple. Pointer-events none.
 */
export function createAgentVisibleOverlay(root = typeof document !== 'undefined' ? document.body : null) {
  if (!root) {
    return {
      destroy() {},
      moveCursorTo: async () => {},
      flashHighlight: async () => {},
      flashPoint: async () => {},
      flashRegion: async () => {},
      rippleAt: async () => {},
    };
  }

  let layer = root.querySelector(`#${LAYER_ID}`);
  if (!layer) {
    layer = document.createElement('div');
    layer.id = LAYER_ID;
    layer.setAttribute('data-agent-visible-layer', '');
    layer.className = 'agent-visible-layer';
    root.appendChild(layer);
  }

  const cursor = document.createElement('div');
  cursor.className = 'agent-visible-cursor';
  cursor.setAttribute('aria-hidden', 'true');
  layer.appendChild(cursor);

  const reduced = prefersReducedMotion();

  function placeCursor(x, y) {
    cursor.style.transform = `translate(${x}px, ${y}px)`;
  }

  async function moveCursorTo(point, { durationMs = reduced ? 0 : 320 } = {}) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    const start = cursor._pos || { x: point.x, y: point.y };
    const end = { x: point.x, y: point.y };
    cursor._pos = end;
    if (durationMs <= 0 || reduced) {
      placeCursor(end.x, end.y);
      cursor.classList.add('agent-visible-cursor--shown');
      return;
    }
    const t0 = performance.now();
    cursor.classList.add('agent-visible-cursor--shown');
    await new Promise((resolve) => {
      const tick = (now) => {
        const t = Math.min(1, (now - t0) / durationMs);
        const e = t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
        placeCursor(start.x + (end.x - start.x) * e, start.y + (end.y - start.y) * e);
        if (t < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
  }

  async function flashHighlight(el, { ms = reduced ? 120 : 520 } = {}) {
    if (!el || !(el instanceof Element)) return;
    el.classList.add('agent-visible-target-flash');
    await sleep(ms);
    el.classList.remove('agent-visible-target-flash');
  }

  async function flashRegion(selector, opts) {
    const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!el) return;
    await flashHighlight(el, opts);
  }

  async function flashPoint(point, { ms = reduced ? 100 : 400 } = {}) {
    if (!point) return;
    const ring = document.createElement('div');
    ring.className = 'agent-visible-point-ring';
    ring.style.left = `${point.x}px`;
    ring.style.top = `${point.y}px`;
    layer.appendChild(ring);
    await sleep(ms);
    ring.remove();
  }

  async function rippleAt(point) {
    if (!point || reduced) return;
    const ripple = document.createElement('div');
    ripple.className = 'agent-visible-ripple';
    ripple.style.left = `${point.x}px`;
    ripple.style.top = `${point.y}px`;
    layer.appendChild(ripple);
    await sleep(480);
    ripple.remove();
  }

  function destroy() {
    cursor.remove();
    if (layer.childElementCount === 0) layer.remove();
  }

  return {
    destroy,
    moveCursorTo,
    flashHighlight,
    flashPoint,
    flashRegion,
    rippleAt,
  };
}
