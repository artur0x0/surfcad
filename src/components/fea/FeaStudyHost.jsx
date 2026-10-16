import React, { useEffect } from 'react';
import { FeaStudyChip } from './FeaStudyChip';
import { FeaStudySheet } from './FeaStudySheet';
import { useFeaStudy } from '../../fea/useFeaStudy.js';

/**
 * One owner for the study session. Phone and desktop both mount the
 * bottom card here, inside the viewport pane. Game leaves enabled false,
 * so this mounts no card.
 */
export function FeaStudyHost({
  enabled = true,
  compact = false,
  paintOpen = false,
  script = '',
  getScript,
  onCommit,
  assemblyLocked,
  getSolid,
  getAssembly,
  getPartScript,
  getPartId,
  onHighlight,
  onContactHighlight,
  onClaim,
  onActive,
  pickRef,
  tapActionRef,
  toggleRef,
  closeRef,
  panelRef,
}) {
  const panel = useFeaStudy({
    enabled,
    compact,
    paintOpen,
    script,
    getScript,
    onCommit,
    assemblyLocked,
    getSolid,
    getAssembly,
    getPartScript,
    getPartId,
    onHighlight,
    onContactHighlight,
    onClaim,
  });
  const open = panel.open;
  const close = panel.close;
  const toggle = panel.toggle;
  const pick = panel.pick;
  const tapAction = panel.tapAction;

  useEffect(() => {
    onActive?.(open);
  }, [onActive, open]);

  useEffect(() => {
    if (!toggleRef) return undefined;
    toggleRef.current = toggle;
    return () => {
      toggleRef.current = () => {};
    };
  }, [toggle, toggleRef]);

  useEffect(() => {
    if (!closeRef) return undefined;
    closeRef.current = close;
    return () => {
      closeRef.current = () => {};
    };
  }, [close, closeRef]);

  useEffect(() => {
    if (!pickRef) return undefined;
    pickRef.current = open ? pick : null;
    return () => {
      pickRef.current = null;
    };
  }, [open, pick, pickRef]);

  useEffect(() => {
    if (!tapActionRef) return undefined;
    tapActionRef.current = open ? tapAction : null;
    return () => {
      tapActionRef.current = null;
    };
  }, [open, tapAction, tapActionRef]);

  useEffect(() => {
    if (!panelRef) return undefined;
    panelRef.current = panel;
    return () => {
      panelRef.current = null;
    };
  }, [panel, panelRef]);

  if (!open || !enabled) return null;
  if (compact) return <FeaStudySheet panel={panel} />;
  return <FeaStudyChip panel={panel} />;
}
