// components/ViewSnapControl.jsx — standard-view snap cluster for the lower toolbar.
//
// One orientation button, one menu, no hidden second action:
//   tap      unfurls the cluster (Front / Right / Top / Iso appear to its left)
//   tap again closes it — the icon becomes a left arrow while open so it reads as
//            "this button belongs to the menu beside me", not "snap to iso"
// The menu flies out *left* because the cluster lives on the right edge of the
// viewport: growing leftwards keeps it on screen, and the arrow always points
// the same way the menu unfurled.
// Isometric lives *inside* the popup with the other three views (it used to be
// the trigger's hidden second tap, which nobody could discover).
// Any snap closes the cluster.
import React, { useState } from 'react';
import { Box, Square, PanelRight, PanelTop, Cuboid, ArrowLeft } from 'lucide-react';

// Left to right inside the popped-up bar.
const VIEWS = [
  { key: 'front', label: 'Snap to Front', Icon: Square },
  { key: 'right', label: 'Snap to Right', Icon: PanelRight },
  { key: 'top', label: 'Snap to Top', Icon: PanelTop },
  { key: 'iso', label: 'Snap to Isometric', Icon: Cuboid },
];

const ViewSnapControl = ({ onSnap }) => {
  const [open, setOpen] = useState(false);

  const handleSnap = (key) => {
    onSnap?.(key);
    setOpen(false);                  // a chosen view retires the cluster
  };

  return (
    <div className="relative flex">
      {/* `w-max` + no wrapping keeps the flyout a single horizontal row. It is
          absolutely positioned with only `right` set, inside a ~36px-wide
          parent, so its shrink-to-fit width is near zero — add `flex-wrap` and
          it collapses into a vertical stack, which is exactly what happened. */}
      {open && (
        <div
          className="view-snap-popup absolute right-full top-1/2 -translate-y-1/2 mr-2.5
            flex w-max flex-nowrap items-center gap-2
            bg-white/60 backdrop-blur-sm p-2 rounded-lg shadow-lg"
          role="group"
          aria-label="Standard view snaps"
          data-view-snap-popup=""
        >
          {VIEWS.map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => handleSnap(key)}
              className="p-2 rounded text-blue-600 hover:bg-blue-100 active:bg-blue-200"
              title={label}
              aria-label={label}
              data-ui-action={`data-view-snap-${key}`}
            >
              <Icon size={20} />
            </button>
          ))}
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className={`p-2 rounded ${
          open
            ? 'text-green-600 bg-green-100'
            : 'text-blue-600 hover:bg-gray-100 active:bg-blue-100'
        }`}
        title={open ? 'Hide view snaps' : 'Show view snaps (Front / Right / Top / Iso)'}
        aria-label="View snaps"
        aria-expanded={open}
        data-ui-action="data-view-snap-toggle"
      >
        {/* Open → arrow toward the menu that just unfurled left of this button. */}
        {open ? <ArrowLeft size={20} /> : <Box size={20} />}
      </button>
    </div>
  );
};

export default ViewSnapControl;
