/**
 * The molding guide quotes the checker's thresholds. Where the app has a
 * constant, the topic text must carry that number, so a threshold change in
 * src/molding fails here until the guide follows (surfcad-mcp 0.3.6 §5).
 * Rib ratio, wall range and texture draft are design rules with no constant.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { GUIDE_TOPICS, callGuideTool, guideResourceContents, guideResourceList } from '../src/prompt/guide.mjs';
import { MOLD_DRAFT_MIN_DEG } from '../../../src/molding/moldDraft.js';
import { PARTING_ZERO_DRAFT_DEG } from '../../../src/molding/parting.js';
import { LIFTER_TILTS_DEG } from '../../../src/molding/sideActions.js';
import { MOLD_WALL_THICK_RATIO, MOLD_WALL_THIN_RATIO } from '../../../src/molding/wallThickness.js';

const molding = GUIDE_TOPICS.molding.text;

test('the molding guide carries the code thresholds', () => {
  assert.equal(MOLD_DRAFT_MIN_DEG, 1);
  assert.match(molding, new RegExp(`at least ${MOLD_DRAFT_MIN_DEG}° of draft`));
  assert.match(molding, new RegExp(`checked against ${MOLD_DRAFT_MIN_DEG}°`));
  assert.match(molding, new RegExp(`within ${PARTING_ZERO_DRAFT_DEG}° of vertical as vertical`));
  assert.match(molding, new RegExp(`within ${PARTING_ZERO_DRAFT_DEG}° of vertical is not a side action`));
  assert.deepEqual([...LIFTER_TILTS_DEG], [15, 20, 25]);
  const [a, b, c] = LIFTER_TILTS_DEG;
  assert.match(molding, new RegExp(`tilts of ${a}°, ${b}°, then ${c}° into the core`));
  assert.match(molding, new RegExp(`more than ${c}° cannot be made with a lifter`));
  assert.match(molding, new RegExp(`thinner than ${MOLD_WALL_THIN_RATIO}× nominal as thin`));
  assert.match(molding, new RegExp(`thicker than ${MOLD_WALL_THICK_RATIO}× nominal as thick`));
});

test('the molding and modeling topics are served by the tool and as resources, under 1,500 words', () => {
  for (const name of ['modeling', 'molding']) {
    const words = GUIDE_TOPICS[name].text.trim().split(/\s+/).length;
    assert.ok(words < 1500, `${name}: ${words} words`);
    const viaTool = callGuideTool({ topic: name });
    assert.equal(viaTool.isError, false);
    assert.ok(viaTool.content[0].text.includes(GUIDE_TOPICS[name].text), `${name} via guide tool`);
    const uri = `surfcad://guide/${name}`;
    assert.ok(guideResourceList().some((row) => row.uri === uri), `${uri} listed`);
    const contents = guideResourceContents(uri);
    assert.ok(contents.contents[0].text.includes(GUIDE_TOPICS[name].text), `${uri} reads back`);
  }
});
