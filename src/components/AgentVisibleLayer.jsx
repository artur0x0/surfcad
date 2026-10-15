import { useEffect, useRef } from 'react';
import { fillAgentHost } from '../agent/host';
import {
  createAgentVisibleDirector,
  createAgentVisibleOverlay,
  initialVisibleOptionsFromEnv,
  mergeAgentVisibleOptions,
} from '../agent/visible';

/**
 * Operator-visible agent cues (cursor, highlights, pacing). Mounted when the
 * agent bridge is active. Does not change command outcomes — only presentation.
 */
export default function AgentVisibleLayer({ agentHostRef }) {
  const optionsRef = useRef(mergeAgentVisibleOptions(initialVisibleOptionsFromEnv({
    location: typeof location !== 'undefined' ? location : null,
    localStorage: typeof localStorage !== 'undefined' ? localStorage : null,
  })));
  const directorRef = useRef(null);

  useEffect(() => {
    const overlay = createAgentVisibleOverlay(document.body);
    directorRef.current = createAgentVisibleDirector(overlay, () => optionsRef.current);
    return () => {
      directorRef.current = null;
      overlay.destroy();
    };
  }, []);

  useEffect(() => {
    if (!agentHostRef) return undefined;
    fillAgentHost(agentHostRef, {
      readAgentVisible() {
        return { ...optionsRef.current };
      },
      setAgentVisible(patch) {
        optionsRef.current = mergeAgentVisibleOptions(patch, optionsRef.current);
        return { ...optionsRef.current };
      },
      agentVisibleDirector: directorRef.current,
    });
    return undefined;
  });

  return null;
}
