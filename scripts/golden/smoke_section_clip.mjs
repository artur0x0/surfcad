#!/usr/bin/env node
/**
 * View-only section clip: a wheel (disc + spokes) shared by a translated
 * and rotated instance, plus a material created after the tool is on.
 * Accept hides the preview plane and leaves the clip on. Edit shows it again.
 */
import { verifyAssemblySectionClip } from '../../src/utils/sectionClipFixture.js';

try {
  verifyAssemblySectionClip();
} catch (error) {
  console.error(error);
  console.log('section clip golden: FAILED');
  process.exit(1);
}
console.log('section clip golden: ok');
