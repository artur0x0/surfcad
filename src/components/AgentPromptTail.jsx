import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { agentPromptBubblePath, agentPromptTailFillPath, agentPromptTailLayout } from '../agent/agentPromptTail.js';

const useClientLayoutEffect = typeof document !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Phone-only speech bubble. The pane is plain CSS: a rounded glass box
 * with a border and a shadow, so it is drawn before anything is measured
 * and whether or not the tail fits. Once the Bot button is measured, one
 * SVG path takes over the outline (the box plus the tail, so there is no
 * seam across the tail base) and a small triangle fills the tail. Nothing
 * here depends on a clip-path over a backdrop-filter, which Safari does
 * not clip.
 */
export default function AgentPromptTail({ rootRef }) {
  const wrapRef = useRef(null);
  const fillRef = useRef(null);
  const tailRef = useRef(null);
  const pathRef = useRef(null);
  const tipRef = useRef(null);

  useClientLayoutEffect(() => {
    const root = rootRef?.current;
    const wrap = wrapRef.current;
    if (!root || !wrap) return undefined;

    let frame = 0;
    let followUp = 0;
    let tries = 0;
    let watchedButton = null;
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => schedule()) : null;

    const paint = (layout) => {
      if (!layout || !fillRef.current || !tailRef.current || !pathRef.current || !tipRef.current) {
        // No box yet. The CSS pane (fill, border, shadow) is already on
        // screen as a rounded rectangle; only the measured outline waits.
        wrap.dataset.agentPromptTailReady = '0';
        wrap.dataset.agentPromptTailShape = 'box';
        return;
      }
      // Local pixels, no viewBox: the SVG is the size of the prompt and
      // draws the tail past its bottom edge (overflow: visible).
      pathRef.current.setAttribute('d', agentPromptBubblePath(layout));
      tailRef.current.setAttribute('d', agentPromptTailFillPath(layout));
      tipRef.current.style.left = `${layout.tipX}px`;
      tipRef.current.style.top = `${layout.tipY}px`;
      wrap.dataset.agentPromptTailReady = '1';
      wrap.dataset.agentPromptTailShape = layout.hasTail ? 'tail' : 'box';
    };

    const apply = () => {
      const button = document.querySelector('[data-agent-chat-open]');
      if (!fillRef.current || !tailRef.current || !pathRef.current || !tipRef.current) {
        wrap.dataset.agentPromptTailReady = '0';
        return;
      }
      const rect = root.getBoundingClientRect();
      const btn = button ? button.getBoundingClientRect() : null;
      const layout = agentPromptTailLayout({
        prompt: {
          left: rect.left,
          top: rect.top,
          bottom: rect.bottom,
          width: root.offsetWidth,
          height: root.offsetHeight,
          visualWidth: rect.width,
          visualHeight: rect.height,
        },
        button: btn && btn.width > 0 ? {
          left: btn.left,
          top: btn.top,
          width: btn.width,
        } : null,
      });
      paint(layout);
      if (button && button !== watchedButton) {
        if (watchedButton) ro?.unobserve(watchedButton);
        ro?.observe(button);
        watchedButton = button;
      }
      // The button can mount a frame later, or the gap can open. Keep
      // looking, then add the tail. A box with no tail is already painted.
      if (button && layout?.hasTail) {
        tries = 0;
        return;
      }
      if (tries < 40) {
        tries += 1;
        frame = requestAnimationFrame(apply);
      }
    };

    // Measure in the listener. A hidden or headless document does not flush
    // requestAnimationFrame, so a resize would leave the tip on the old spot.
    // The timeout covers a layout that settles after the event.
    const schedule = () => {
      apply();
      clearTimeout(followUp);
      followUp = setTimeout(apply, 0);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    };

    apply();
    ro?.observe(root);
    const pane = root.parentElement;
    if (pane) ro?.observe(pane);
    if (document.documentElement) ro?.observe(document.documentElement);
    const mo = typeof MutationObserver === 'function'
      ? new MutationObserver(schedule)
      : null;
    mo?.observe(root, { attributes: true, attributeFilter: ['style', 'class'] });
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', schedule);
    vv?.addEventListener('scroll', schedule);
    // The prompt slides (transform, 220ms) when it folds, unfolds or moves
    // away. The class change measures at the start of the slide, where the
    // box is still far from the button; measure again where it lands.
    const onTransitionEnd = (event) => {
      if (event.target === root) schedule();
    };
    root.addEventListener('transitionend', onTransitionEnd);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(followUp);
      ro?.disconnect();
      mo?.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      vv?.removeEventListener('resize', schedule);
      vv?.removeEventListener('scroll', schedule);
      root.removeEventListener('transitionend', onTransitionEnd);
    };
  }, [rootRef]);

  return (
    <div
      ref={wrapRef}
      className="agent-prompt-tail"
      data-agent-prompt-tail=""
      data-agent-prompt-tail-ready="0"
      aria-hidden="true"
    >
      <div ref={fillRef} className="agent-prompt-bubble-fill surface-glass" data-agent-prompt-bubble="" />
      <svg className="agent-prompt-bubble-stroke" aria-hidden="true" focusable="false">
        <path ref={tailRef} className="agent-prompt-bubble-tail-fill" />
        <path ref={pathRef} className="agent-prompt-bubble-outline" data-agent-prompt-outline="" />
      </svg>
      <span ref={tipRef} className="agent-prompt-tail-tip" data-agent-prompt-tail-tip="" />
    </div>
  );
}

/** Desktop keeps the prompt's children unwrapped. Phone adds the tail and clips the body to the rounded box. */
export function AgentPromptFrame({ isMobile, rootRef, children }) {
  if (!isMobile) return children;
  return (
    <>
      <AgentPromptTail rootRef={rootRef} />
      <div className="agent-prompt-face">{children}</div>
    </>
  );
}
