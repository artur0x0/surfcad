import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  MoveHorizontal,
  MoveVertical,
  AlignCenterHorizontal,
  Plus,
  Radius,
  Equal,
  CircleDot,
  Lock,
} from 'lucide-react';
import { Vector3 } from 'three';
import { useDisplayUnit } from '../hooks/useDisplayUnit';
import { formatDisplayLength } from '../utils/displayUnit';
import { CONSTRAINT_LABELS } from '../utils/contourGesture';
import { constraintAnchor, dimensionAnchor, planeUvToWorld } from '../utils/contourPick';
import { referenceTagAnchor } from '../utils/contourRefPick';
import { dimensionLayout, dimensionMarkup } from '../utils/contourDimensionDraw';
import { plusTagsToHide } from '../utils/contourTagPlace';
import { worldPoint } from '../utils/partPose';

const CONSTRAINT_ICONS = {
  horizontal: MoveHorizontal,
  vertical: MoveVertical,
  parallel: AlignCenterHorizontal,
  perpendicular: Plus,
  tangent: Radius,
  equal: Equal,
  coincident: CircleDot,
  fix: Lock,
};

/**
 * Floating dimension tags and constraint icons. Only while this contour
 * is open. The layer is portaled to the document body: the viewport shell
 * is a size container with overflow hidden, and on Safari that clips
 * descendants and lets the WebGL canvas paint over them. Fixed coordinates
 * come from the canvas, so a tag stays on the geometry. The layer ignores
 * pointers. Each tag does not, so orbit still hits the canvas. Tap a
 * dimension or constraint tag to reopen it in the card. Positions follow the camera
 * in a frame loop and are not React state. A perpendicular tag is a plus.
 * The same frame hides that plus when it would cover a dimension chip, and
 * collapses pluses that cover each other so a repeated constraint does not
 * stack on the value.
 */
const ContourTags = ({
  model = null,
  plane = null,
  cameraRef = null,
  canvasRef = null,
  selectedId = null,
  onSelect,
  onDelete,
  onClose,
  getAnchor = null,
}) => {
  const [unit] = useDisplayUnit();
  const nodes = useRef(new Map());
  const scratch = useRef(new Vector3());
  const layerRef = useRef(null);
  const svgRef = useRef(null);
  const markupRef = useRef('');
  const dimensions = model?.dimensions || [];
  const constraints = model?.constraints || [];

  useEffect(() => {
    let frame = 0;
    const host = layerRef.current;
    let svg = null;
    if (host) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('data-contour-dim-layer', '');
      svg.setAttribute('aria-hidden', 'true');
      svg.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;z-index:30';
      host.insertBefore(svg, host.firstChild);
      svgRef.current = svg;
      markupRef.current = '';
    }
    const dims = model?.dimensions || [];
    const cons = model?.constraints || [];
    const tick = () => {
      const camera = cameraRef?.current;
      const canvas = canvasRef?.current;
      const view = canvas?.getBoundingClientRect();
      const place = (id, uv) => {
        const el = nodes.current.get(id);
        if (!el) return;
        if (!uv || !camera || !view || view.width <= 0 || view.height <= 0 || !plane?.center) {
          el.style.display = 'none';
          el.dataset.contourTagVisible = '0';
          return;
        }
        const local = planeUvToWorld(uv, plane);
        const pose = getAnchor?.();
        const world = pose ? worldPoint(local, pose) : local;
        const p = scratch.current.set(world[0], world[1], world[2]).project(camera);
        const x = (p.x * 0.5 + 0.5) * view.width + view.left;
        const y = (-p.y * 0.5 + 0.5) * view.height + view.top;
        const inside = x >= view.left && x <= view.right && y >= view.top && y <= view.bottom;
        // A hair outside NDC still counts when the pixel is on the canvas.
        // Safari's projection can sit just past ±1 for a point that is on screen.
        const depthOk = p.z >= -1.02 && p.z <= 1.02;
        if (!inside || !depthOk) {
          el.style.display = 'none';
          el.dataset.contourTagVisible = '0';
          return;
        }
        el.style.display = '';
        el.dataset.contourTagVisible = '1';
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
      };
      const markup = [];
      if (camera && view && view.width > 0 && plane?.center) {
        const project = (uv) => {
          if (!uv) return null;
          const local = planeUvToWorld(uv, plane);
          const pose = getAnchor?.();
          const world = pose ? worldPoint(local, pose) : local;
          const p = scratch.current.set(world[0], world[1], world[2]).project(camera);
          const depthOk = p.z >= -1.02 && p.z <= 1.02;
          if (!depthOk) return null;
          return {
            x: (p.x * 0.5 + 0.5) * view.width + view.left,
            y: (-p.y * 0.5 + 0.5) * view.height + view.top,
          };
        };
        for (const dim of dims) {
          const fig = dimensionLayout(model, dim, project);
          const el = nodes.current.get(dim.id);
          if (fig) {
            markup.push(dimensionMarkup({ ...fig, id: dim.id }));
            if (el) {
              el.style.transform = 'translate(-50%, -50%)';
              const px = fig.label;
              const inside = px.x >= view.left && px.x <= view.right && px.y >= view.top && px.y <= view.bottom;
              if (!inside) {
                el.style.display = 'none';
                el.dataset.contourTagVisible = '0';
              } else {
                el.style.display = '';
                el.dataset.contourTagVisible = '1';
                el.style.left = `${px.x}px`;
                el.style.top = `${px.y}px`;
              }
            }
          } else {
            if (el) el.style.transform = 'translate(-50%, -120%)';
            place(dim.id, dimensionAnchor(model, dim));
          }
        }
        for (const con of cons) place(con.id, constraintAnchor(model, con));
        for (const ref of model?.refs || []) {
          if (!ref?.broken) continue;
          place(`broken:${ref.id}`, referenceTagAnchor(ref));
        }
      }
      const measured = [];
      for (const [id, el] of nodes.current) {
        delete el.dataset.contourTagSuppressed;
        if (el.dataset.contourTagVisible !== '1' || el.style.display === 'none') continue;
        const btn = el.querySelector('[data-contour-tag]');
        if (!btn) continue;
        const rect = btn.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;
        const icon = btn.getAttribute('data-contour-icon');
        measured.push({
          id,
          plus: icon === 'perpendicular',
          chip: icon == null,
          box: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        });
      }
      for (const id of plusTagsToHide(measured)) {
        const el = nodes.current.get(id);
        if (!el) continue;
        el.style.display = 'none';
        el.dataset.contourTagVisible = '0';
        el.dataset.contourTagSuppressed = 'plus';
      }
      const svg = svgRef.current;
      const nextMarkup = markup.join('');
      if (svg && markupRef.current !== nextMarkup) {
        svg.innerHTML = nextMarkup;
        markupRef.current = nextMarkup;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      svg?.remove();
      if (svgRef.current === svg) svgRef.current = null;
      markupRef.current = '';
    };
  }, [cameraRef, canvasRef, plane, model, getAnchor]);

  const brokenRefs = (model?.refs || []).filter((ref) => ref?.broken && ref.geom);
  if ((!dimensions.length && !constraints.length && !brokenRefs.length) || !plane) return null;

  const layer = (
    <div
      className="pointer-events-none fixed inset-0 z-30"
      ref={layerRef}
      data-contour-tags=""
      style={{ position: 'fixed', inset: 0, zIndex: 30, pointerEvents: 'none' }}
    >
      {dimensions.map((dim) => {
        const value = dim.kind === 'angle'
          ? `${Number(dim.value).toFixed(1)}°`
          : formatDisplayLength(dim.value, unit);
        const label = dim.name ? `${dim.name} ${value}` : value;
        const open = selectedId === dim.id;
        return (
          <div
            key={dim.id}
            ref={(el) => {
              if (el) nodes.current.set(dim.id, el);
              else nodes.current.delete(dim.id);
            }}
            className="pointer-events-auto fixed"
            style={{
              position: 'fixed',
              zIndex: 30,
              pointerEvents: 'auto',
              transform: 'translate(-50%, -120%)',
              display: 'none',
            }}
          >
            <button
              type="button"
              data-contour-tag={dim.id}
              className="min-h-11 min-w-11 rounded-full bg-white/90 px-2 text-[12px] font-medium text-cyan-950 shadow"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onSelect?.(dim.id);
              }}
            >
              {label}
            </button>
            {open && (
              <div
                data-contour-tag-popup={dim.id}
                className="mt-1 flex gap-1 rounded-md bg-white/95 p-1 shadow"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  data-contour-tag-delete={dim.id}
                  className="min-h-11 rounded bg-cyan-800 px-3 text-[13px] text-white"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete?.(dim.id);
                  }}
                >
                  Delete
                </button>
                <button
                  type="button"
                  data-contour-tag-close=""
                  aria-label="Close"
                  className="flex min-h-11 min-w-11 items-center justify-center rounded text-gray-700"
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose?.();
                  }}
                >
                  <X size={16} strokeWidth={2} />
                </button>
              </div>
            )}
          </div>
        );
      })}
      {constraints.map((con) => {
        const Icon = CONSTRAINT_ICONS[con.kind] || Lock;
        const open = selectedId === con.id;
        const label = CONSTRAINT_LABELS[con.kind] || con.kind;
        return (
          <div
            key={con.id}
            ref={(el) => {
              if (el) nodes.current.set(con.id, el);
              else nodes.current.delete(con.id);
            }}
            className="pointer-events-auto fixed"
            style={{
              position: 'fixed',
              zIndex: 30,
              pointerEvents: 'auto',
              transform: 'translate(-50%, -120%)',
              display: 'none',
            }}
          >
            <button
              type="button"
              data-contour-tag={con.id}
              data-contour-icon={con.kind}
              aria-label={label}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-white/90 text-cyan-950 shadow"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onSelect?.(con.id);
              }}
            >
              <Icon size={16} strokeWidth={2} />
            </button>
            {open && (
              <div
                data-contour-tag-popup={con.id}
                className="mt-1 flex gap-1 rounded-md bg-white/95 p-1 shadow"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  data-contour-tag-delete={con.id}
                  className="min-h-11 rounded bg-cyan-800 px-3 text-[13px] text-white"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete?.(con.id);
                  }}
                >
                  Delete
                </button>
                <button
                  type="button"
                  data-contour-tag-close=""
                  aria-label="Close"
                  className="flex min-h-11 min-w-11 items-center justify-center rounded text-gray-700"
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose?.();
                  }}
                >
                  <X size={16} strokeWidth={2} />
                </button>
              </div>
            )}
          </div>
        );
      })}
      {brokenRefs.map((ref) => (
        <div
          key={`broken:${ref.id}`}
          ref={(el) => {
            if (el) nodes.current.set(`broken:${ref.id}`, el);
            else nodes.current.delete(`broken:${ref.id}`);
          }}
          className="pointer-events-none fixed"
          data-contour-ref-broken={ref.id}
          style={{
            position: 'fixed',
            zIndex: 30,
            pointerEvents: 'none',
            transform: 'translate(-50%, -120%)',
            display: 'none',
          }}
        >
          <span className="rounded-full border border-red-400 bg-white/95 px-2 py-1 text-[12px] font-medium text-red-700 shadow">
            broken
          </span>
        </div>
      ))}
    </div>
  );

  if (typeof document === 'undefined' || !document.body) return layer;
  return createPortal(layer, document.body);
};

export default ContourTags;
