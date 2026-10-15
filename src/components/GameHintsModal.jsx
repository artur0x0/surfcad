import React, { useState } from 'react';
import { X, BookOpen, Copy, Check } from 'lucide-react';

/**
 * Per-puzzle Hint (slice 07): solution/target code + Copy + helper allowlist.
 * Does not dump the full pack blurbs — progression titles live in the picker.
 * Allowlist mirrors HELPER_FUNCTIONS.md puzzle vocabulary (compact).
 */
const ALLOWLIST = [
  { name: 'filletEdges(part, edges, r, opts?)', role: 'Circular fillet on convex edges (planar / closed-run)' },
  { name: 'filletAlongPath(part, path, r, opts?)', role: 'Dihedral fillet/chamfer swept along a path' },
  { name: 'edge(part, id) / edgesBetween(part, faceA, faceB)', role: 'Fillet-mode boundary by id (re-pick if faceIDs change)' },
  { name: 'chamferEdges(part, edges, c)', role: 'Equal-leg chamfer' },
  { name: 'convexEdges(part)', role: 'Select convex edges (for fillet/chamfer)' },
  { name: 'roundedBox(size, radius, segments?)', role: 'Box with rounded edges' },
  { name: 'tube / hexPrism', role: 'Primitive solids' },
  { name: 'clearanceHole / tapDrillHole', role: 'Fastener holes by size' },
  { name: 'cboreHole / cskHole', role: 'Counterbore / countersink' },
  { name: 'hole / holeSpan / holePattern', role: 'Generic through-holes' },
  { name: 'facesByNormal / workplaneFromFace / …', role: 'Selection helpers' },
  { name: 'shell, cut, addDraft, mirror, array3D, polarArray…', role: 'Solids / layout' },
  { name: 'loft / makeLoft, offsetPlaneFrame, sweep, makeExtrude, makeRevolve', role: 'Profiles / paths' },
  { name: 'center / align', role: 'Placement' },
];

/** Prefer targetScript (solution); fall back to hint text. */
function solutionCode(puzzle) {
  const raw = (puzzle?.targetScript || puzzle?.hint || '').trim();
  return raw;
}

const GameHintsModal = ({ onClose, puzzle = null }) => {
  const [copied, setCopied] = useState(false);
  const code = solutionCode(puzzle);

  const handleCopy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.warn('[GameHintsModal] Copy failed:', err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center surface-scrim p-3">
      <div
        role="dialog"
        aria-labelledby="game-hints-title"
        className="w-full max-w-lg max-h-[85dvh] overflow-hidden flex flex-col rounded-lg surface-glass border border-chrome-border shadow-xl"
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-chrome-border shrink-0">
          <div className="flex items-center gap-2 text-white min-w-0">
            <BookOpen size={18} className="text-cyan-400 shrink-0" />
            <h2 id="game-hints-title" className="font-semibold text-sm truncate">
              Hint{puzzle?.title ? ` · ${puzzle.title}` : ''}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-chrome-secondary hover:text-white hover:bg-gray-800 shrink-0"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto p-4 space-y-4 text-sm text-gray-200">
          <p className="text-xs text-chrome-secondary">
            Match the grey ghost. Copy the target below into the blank editor,
            or rewrite it yourself with the allowlist helpers.
          </p>

          {puzzle?.blurb && (
            <p className="text-xs text-gray-300">{puzzle.blurb}</p>
          )}

          <div className="rounded border border-gray-600/50 bg-gray-950/60 overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-chrome-border/80 bg-gray-800/50">
              <span className="text-xs font-semibold text-gray-300">Target code</span>
              <button
                type="button"
                onClick={handleCopy}
                disabled={!code}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium text-cyan-200 hover:bg-chrome-border disabled:opacity-40"
                title="Copy target code"
              >
                {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            {code ? (
              <pre className="p-3 text-[11px] leading-relaxed text-gray-200 whitespace-pre font-mono overflow-x-auto max-h-[40vh]">
                {code}
              </pre>
            ) : (
              <p className="p-3 text-xs text-gray-500">No target code for this puzzle.</p>
            )}
          </div>

          <div>
            <div className="text-xs font-semibold text-gray-300 mb-2">Helper allowlist</div>
            <ul className="space-y-2">
              {ALLOWLIST.map((row) => (
                <li key={row.name} className="border-b border-gray-800 pb-2 last:border-0">
                  <code className="text-[11px] text-emerald-300 font-mono break-all">{row.name}</code>
                  <div className="text-xs text-chrome-secondary mt-0.5">{row.role}</div>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-[11px] text-gray-500">
            Full reference: HELPER_FUNCTIONS.md (repo root). Unsupported: curved
            planar singleton curved-face fillets (use filletAlongPath / Strategy=sweep), open curved runs under C6, concave “fillets”, arbitrary
            fastener sizes outside the table.
          </p>
        </div>
      </div>
    </div>
  );
};

export default GameHintsModal;
