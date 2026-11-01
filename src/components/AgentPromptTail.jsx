import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { agentPromptBubblePath, agentPromptTailLayout } from '../agent/agentPromptTail.js';

const useClientLayoutEffect = typeof document !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Phone-only speech-bubble tail. Measures the Bot button and paints one
 * clipped glass shape plus a stroke of the same path, so the outline runs
 * around the tail without a seam across the base.
 */
export default function AgentPromptTail({ rootRef }) {
  const wrapRef = useRef(null);
  const fillRef = useRef(null);
  const shadowRef = useRef(null);
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

    const apply = () => {
      const button = document.querySelector('[data-agent-chat-open]');
      if (!button || !fillRef.current || !shadowRef.current || !pathRef.current || !tipRef.current) {
        wrap.dataset.agentPromptTailReady = '0';
        if (tries < 40) {
          tries += 1;
          frame = requestAnimationFrame(apply);
        }
        return;
      }
      tries = 0;
      if (button !== watchedButton) {
        if (watchedButton) ro?.unobserve(watchedButton);
        ro?.observe(button);
        watchedButton = button;
      }
      const rect = root.getBoundingClientRect();
      const btn = button.getBoundingClientRect();
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
        button: {
          left: btn.left,
          top: btn.top,
          width: btn.width,
        },
      });
      if (!layout) {
        wrap.dataset.agentPromptTailReady = '0';
        return;
      }
      const d = agentPromptBubblePath(layout);
      const clip = `path('${d}')`;
      wrap.style.height = `${layout.totalHeight}px`;
      fillRef.current.style.clipPath = clip;
      fillRef.current.style.webkitClipPath = clip;
      shadowRef.current.style.clipPath = clip;
      shadowRef.current.style.webkitClipPath = clip;
      pathRef.current.setAttribute('d', d);
      const svg = pathRef.current.ownerSVGElement;
      svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.totalHeight}`);
      tipRef.current.style.left = `${layout.tipX}px`;
      tipRef.current.style.top = `${layout.tipY}px`;
      wrap.dataset.agentPromptTailReady = '1';
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

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(followUp);
      ro?.disconnect();
      mo?.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      vv?.removeEventListener('resize', schedule);
      vv?.removeEventListener('scroll', schedule);
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
      <div ref={shadowRef} className="agent-prompt-bubble-shadow" />
      <div ref={fillRef} className="agent-prompt-bubble-fill surface-glass" />
      <svg className="agent-prompt-bubble-stroke" aria-hidden="true">
        <path ref={pathRef} />
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
