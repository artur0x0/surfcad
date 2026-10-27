import React from 'react';
import {
  AlignVerticalJustifyCenter,
  Circle,
  FlipHorizontal2,
  Focus,
  Move,
} from 'lucide-react';
import Angle from './icons/Angle';

/** One glyph per joint type. The joints row and the joint card share it. */
const JOINT_ICONS = Object.freeze({
  coincident: AlignVerticalJustifyCenter,
  concentric: Circle,
  distance: Move,
  angle: Angle,
  symmetric: FlipHorizontal2,
  fixed: Focus,
});

export function JointGlyph({ type, size = 16 }) {
  const Icon = JOINT_ICONS[type] || AlignVerticalJustifyCenter;
  return <Icon size={size} strokeWidth={2} aria-hidden="true" />;
}
