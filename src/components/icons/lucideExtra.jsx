/**
 * Lucide icons that the pinned lucide-react (0.469) predates, drawn from
 * Lucide's own icon data (ISC) with the same frame: 24 px viewBox, no fill,
 * `currentColor` stroke of 2, round caps and joins. Props follow lucide-react
 * (`size`, `className`, `strokeWidth`). Replace with the package icons when
 * lucide-react is upgraded.
 */

import React from 'react';

function LucideIcon({ name, size = 24, strokeWidth = 2, className = '', children, ...rest }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`lucide lucide-${name}${className ? ` ${className}` : ''}`}
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Lucide `angle`: a corner with an arc. */
export function Angle(props) {
  return (
    <LucideIcon name="angle" {...props}>
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <path d="M3 11a10 10 0 0 1 10 10" />
    </LucideIcon>
  );
}

/** Lucide `ruler-dimension-line`: a dimension line over a ruler. */
export function RulerDimensionLine(props) {
  return (
    <LucideIcon name="ruler-dimension-line" {...props}>
      <path d="M10 15v-3" />
      <path d="M14 15v-3" />
      <path d="M18 15v-3" />
      <path d="M2 8V4" />
      <path d="M22 6H2" />
      <path d="M22 8V4" />
      <path d="M6 15v-3" />
      <rect x="2" y="12" width="20" height="8" rx="2" />
    </LucideIcon>
  );
}
