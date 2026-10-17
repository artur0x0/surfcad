/* global structuredClone */
/**
 * Minimal cross-origin window model for popup-bridge tests. `postMessage`
 * honours targetOrigin the way browsers do (a mismatch drops the message)
 * and stamps `event.origin` / `event.source` from the real sender.
 */

export class FakeWindow {
  constructor({ origin, pathname = '/', search = '', hash = '' } = {}) {
    this.origin = origin;
    const url = new URL(origin);
    this.location = {
      origin,
      host: url.host,
      pathname,
      search,
      hash,
    };
    this.history = {
      replaceState: (_s, _t, next) => {
        const u = new URL(next, origin);
        this.location.pathname = u.pathname;
        this.location.search = u.search;
        this.location.hash = u.hash;
      },
    };
    this.closed = false;
    this.opener = null;
    /** @type {Map<string, Set<Function>>} */
    this.listeners = new Map();
    this.openCalls = [];
    this.openImpl = null;
    /** @type {Map<FakeWindow, object>} this window's handle on each peer */
    this.handles = new Map();
    /** URLs a peer navigated this window to through its handle */
    this.navigations = [];
  }

  addEventListener(type, cb) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(cb);
  }

  removeEventListener(type, cb) {
    this.listeners.get(type)?.delete(cb);
  }

  dispatch(type, event) {
    for (const cb of [...(this.listeners.get(type) || [])]) cb(event);
  }

  setInterval(fn, ms) { return setInterval(fn, ms); }

  clearInterval(id) { clearInterval(id); }

  open(url, name, features) {
    this.openCalls.push({ url, name, features });
    return this.openImpl ? this.openImpl(url, name, features) : null;
  }

  /**
   * A handle `from` can hold for `this`. Messages posted through it arrive
   * here as if sent by `from`, with `source` set to `from`'s handle on us.
   */
  handleFor(from, delivered = []) {
    const target = this;
    const handle = {
      get closed() { return target.closed; },
      close() { target.closed = true; target.dispatch('pagehide', {}); },
      location: {
        replace(url) { target.navigations.push(url); },
      },
      postMessage(data, targetOrigin) {
        if (target.closed) return;
        if (targetOrigin !== '*' && targetOrigin !== target.origin) {
          delivered.push({ dropped: true, data, targetOrigin });
          return;
        }
        delivered.push({ dropped: false, data, targetOrigin });
        const event = {
          data: structuredClone(data),
          origin: from.origin,
          source: target.handles.get(from),
        };
        queueMicrotask(() => target.dispatch('message', event));
      },
    };
    return handle;
  }
}

/**
 * Wire an opener and its popup so each holds a handle on the other.
 * @returns {{ toPopup: object, toOpener: object, toPopupLog: object[], toOpenerLog: object[] }}
 */
export function linkWindows(opener, popup) {
  const toPopupLog = [];
  const toOpenerLog = [];
  const toPopup = popup.handleFor(opener, toPopupLog);
  const toOpener = opener.handleFor(popup, toOpenerLog);
  // `target.handles.get(from)` is the receiver's handle on the sender, which
  // is what `event.source` must equal on the receiving side.
  popup.handles.set(opener, toOpener);
  opener.handles.set(popup, toPopup);
  popup.opener = toOpener;
  return { toPopup, toOpener, toPopupLog, toOpenerLog };
}

export function tick(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
