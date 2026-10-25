/**
 * Copy of src/agent/buildGuidance.js for the self-contained package.
 * test/buildGuidanceFreshness.test.mjs fails when the two differ.
 */

export const FEATURE_GAP_PREFIX = '// FEATURE-GAP:';

/**
 * The assembly-placement rule. Server instructions, guide assembly, the
 * build-flow note, and the placement tool descriptions all use this sentence.
 */
export const JOINT_PLACEMENT_GUIDANCE = 'Fix one base part with a fixed joint, then place every part that touches or attaches to another with joint_create (one call creates the joint and solves placement). Use part_set_transform only for parts that touch nothing. Block-out positions are rough; joints set final positions.';

/** One line for the tools that create parts and insert features. */
export const BUILD_FLOW_NOTE = ` Build in ribbon order: block out every part of the assembly as plain blocks first (within seconds of the prompt, then screenshot for the user), then Build and Shape, then Polish, then pattern and place; finish each stage across the whole assembly before the next. Features first: insert_code_snippet { gap, why, script } is the fallback for one operation no feature can do (its block starts with // FEATURE-GAP: <missing feature or option> | <why the existing feature did not work>); set_script only rewrites a whole part. Hardware is one part per unique fastener type, one instance patterned to every place it goes. ${JOINT_PLACEMENT_GUIDANCE}`;

/** The full guidance, served by the MCP `guide` tool's `start` topic. */
export const BUILD_GUIDANCE = [
  'How to build in SurfCAD. Work in the order of the feature ribbon: Block, Build, Shape, Polish, Move.',
  '1. Block out first. Within seconds of the prompt, create every part of the assembly as plain blocks (create_part, then insert_cube, insert_rounded_box, insert_cylinder, insert_sphere, insert_tube, insert_hex_prism) at roughly the right size and position (block-out positions are rough; joints set final positions), and take a screenshot so the user can approve the layout and proportions before any detail goes in. Never plan silently for long before something appears in the viewport.',
  '2. Build. Shape each block into its real form with Build and Shape features: insert_hole, insert_cut, insert_boolean, insert_shell, insert_add_draft; insert_cross_section, insert_workplane, insert_make_extrude, insert_make_revolve, insert_make_sweep, insert_make_loft (sketch_* and slot_* for the profiles).',
  '3. Polish. insert_fillet_edges, insert_chamfer_edges, insert_move_face, insert_delete_face.',
  `4. Pattern and place. insert_array3_d (grid), insert_polar_array (bolt circle), and insert_pattern_points (one copy at every hole center and axis from list_faces; Array Type=Points) for repeats and hardware, then insert_move, insert_rotate, insert_center, insert_align, insert_mirror for bodies inside one part. ${JOINT_PLACEMENT_GUIDANCE}`,
  'Finish each stage across the whole assembly before starting the next, and take a screenshot after each stage.',
  'Features first. Use insert_* or invoke_helper whenever a feature can do the job. When no feature can, add a script snippet feature with insert_code_snippet { gap, why, script }: one operation, not the whole part, kept next to the other features. Its block starts with a gap comment in this exact form so it can be searched: // FEATURE-GAP: <missing feature or option> | <why the existing feature did not work>. Example: // FEATURE-GAP: sweep along 3D path | the frame tube follows a curve and extrude only goes straight. set_script is only for rewriting a whole part.',
  'Hardware. Give each unique fastener type its own part named by its spec (Bolt M5x12 SHCS, Nut M5 nylock, Star nut 1-1/8"); two fasteners are the same type only when size, length, and head style all match. Model one instance per part and pattern it to every place it goes: list_faces on the part it fastens gives the center and axis of each hole; pass them to insert_pattern_points { points: [{ at, axis }, …], up } on the fastener part (insert_array3_d or insert_polar_array for a regular grid or bolt circle), and run it again when the holes move. Never one part that holds every fastener, never a copy-paste loop. Do hardware in the pattern-and-place stage, after the parts it fastens are finished.',
].join('\n');
