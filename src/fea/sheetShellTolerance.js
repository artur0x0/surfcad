/**
 * How far the sheet metallica shell solve may sit from the TET10 reference
 * (`src/fea/fixtures/sheetMetallicaReference.json`), as a fraction.
 *
 * Measured shell vs single fresh tet meshes of the same build, eight CI runs
 * and eight spark runs: tip displacement 4.81% to 5.21% (the shell is
 * stiffer in the bends), solver p95 (top and bottom fibres vs tet nodes,
 * the legend number) 2.15% to 4.53%, and the p95 of the render-surface
 * sample 6.9% to 13.4% (that sample follows the tet mesh, which is why the
 * old 12% limit tripped). The shell itself is deterministic (29,520 DOF,
 * u 27.233 mm, p95 236.23 MPa on every run), so against the stored median
 * the unit test sees fixed numbers (5.0%, 2.1%, 10.0% on the 2026-10-23
 * reference) and the limits below are headroom for a real change. The
 * nightly golden compares against a single fresh tet, so they also cover
 * the measured single-mesh range.
 */
export const SHELL_VS_TET_TOLERANCE = Object.freeze({
  displacementMax: 0.08,
  p95: 0.10,
  surfaceP95: 0.14,
});
