/**
 * Copy of src/agent/buildGuidance.js for the self-contained package.
 * test/buildGuidanceFreshness.test.mjs fails when the two differ.
 */

export const FEATURE_GAP_PREFIX = '// FEATURE-GAP:';

/** One line for the tools that create parts and insert features. */
export const BUILD_FLOW_NOTE = ' Build in ribbon order: block out every part of the assembly as plain blocks first (within seconds of the prompt, then screenshot for the user), then Build and Shape, then Polish, then pattern and place; finish each stage across the whole assembly before the next. Features first: a set_script snippet is the fallback for one operation no feature can do, and it starts with // FEATURE-GAP: <missing feature or option> | <why the existing feature did not work>. Hardware is one part per unique fastener type, one instance patterned to every place it goes.';

/** The full guidance, shown once at pair time and in the server instructions. */
export const BUILD_GUIDANCE = [
  'How to build in SurfCAD. Work in the order of the feature ribbon: Block, Build, Shape, Polish, Move.',
  '1. Block out first. Within seconds of the prompt, create every part of the assembly as plain blocks (create_part, then insert_cube, insert_cylinder, insert_sphere, insert_tube, insert_hex_prism) at roughly the right size and position, and take a screenshot so the user can approve the layout and proportions before any detail goes in. Never plan silently for long before something appears in the viewport.',
  '2. Build. Shape each block into its real form with Build and Shape features: insert_hole, insert_cut, insert_boolean, insert_shell, insert_add_draft; insert_make_extrude, insert_make_revolve, insert_make_sweep, insert_make_loft (sketch_* and slot_* for the profiles).',
  '3. Polish. insert_fillet_edges, insert_chamfer_edges, insert_move_face, insert_delete_face.',
  '4. Pattern and place. insert_array3_d (grid) and insert_polar_array for repeats and hardware, then insert_move, insert_center, insert_align, insert_mirror, and part_set_transform or joints for final positions.',
  'Finish each stage across the whole assembly before starting the next, and take a screenshot after each stage.',
  'Features first. Use insert_* or invoke_helper whenever a feature can do the job. Use a set_script snippet only when no feature can, keep it to that one operation (not the whole part), and start it with a gap comment in this exact form so it can be searched: // FEATURE-GAP: <missing feature or option> | <why the existing feature did not work>. Example: // FEATURE-GAP: sweep along 3D path | the frame tube follows a curve and extrude only goes straight.',
  'Hardware. Give each unique fastener type its own part named by its spec (Bolt M5x12 SHCS, Nut M5 nylock, Star nut 1-1/8"); two fasteners are the same type only when size, length, and head style all match. Model one instance per part and pattern it to every place it goes with the same spacing and centers as the holes it fits, so moving the holes moves the fasteners. Never one part that holds every fastener, never a copy-paste loop. Do hardware in the pattern-and-place stage, after the parts it fastens are finished.',
].join('\n');
