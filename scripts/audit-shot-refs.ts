/**
 * Retrospective audit for shot_image_prompt ref completeness.
 *
 * Walks every shot's prompt JSON on disk, reconstructs the canonical
 * availableRefs list from project.json (same list the LLM saw at
 * generation time), and measures how many frames had:
 *   - a character named in prose with no "from image N" phrase
 *   - a character named in prose with no matching entry in the references array
 *
 * Then runs `normalizeShotImagePromptWithRefs` and measures the same
 * stats on the post-normalized JSON. Reports before/after deltas.
 *
 * Usage:
 *   pnpm exec tsx scripts/audit-shot-refs.ts <project_dir>
 *   pnpm exec tsx scripts/audit-shot-refs.ts <project_dir> --write
 *
 * With --write, the normalized JSON is saved back to disk.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import {
  normalizeShotImagePromptWithRefs,
  type AvailableRefMinimal,
  type ShotImagePromptFrame,
} from '../src/core/planner/shotImagePromptNormalizer.js';

const projectDir = process.argv[2];
const writeBack = process.argv.includes('--write');
if (!projectDir) {
  console.error('Usage: pnpm exec tsx scripts/audit-shot-refs.ts <project_dir> [--write]');
  process.exit(1);
}

const projectJsonPath = join(projectDir, 'project.json');
if (!existsSync(projectJsonPath)) {
  console.error(`No project.json at ${projectJsonPath}`);
  process.exit(1);
}

const project = JSON.parse(readFileSync(projectJsonPath, 'utf-8'));
const nodes: Record<string, any> = project.executorState?.nodes ?? {};

// Build the global availableRefs list the same way ExecutorAgent does:
// iterate character_image / setting_image / object_image nodes, number
// sequentially, label = itemId.
const REF_TYPE_IDS = new Set(['character_image', 'setting_image', 'object_image']);
const typeIdToRefType = (t: string): 'character' | 'setting' | 'object' => {
  if (t === 'character_image') return 'character';
  if (t === 'setting_image') return 'setting';
  return 'object';
};
const refNodes = Object.values(nodes).filter((n: any) =>
  REF_TYPE_IDS.has(n.typeId) && n.itemId,
);
const allRefs: AvailableRefMinimal[] = refNodes.map((n: any, i: number) => ({
  imageNumber: i + 1,
  type: typeIdToRefType(n.typeId),
  refId: n.id,
  label: n.itemId,
}));

// Mirror filterRefsByPurpose from shotReferenceMapping.ts.
function filterRefsByPurpose(refs: AvailableRefMinimal[], purpose: string): AvailableRefMinimal[] {
  switch (purpose) {
    case 'set_the_world':
    case 'show_passage':
      return refs.filter(r => r.type === 'setting');
    case 'set_the_mood':
      return [];
    case 'show_clue':
    case 'show_dialogue':
    case 'show_reaction':
    case 'hold_emotion':
    case 'show_tension':
      return refs.filter(r => r.type === 'character' || r.type === 'setting');
    case 'meet_character':
      return refs.filter(r => r.type !== 'object');
    case 'show_action':
    case 'show_change':
    case 'punctuate':
    default:
      return refs;
  }
}

// Build a (sceneId → shotNum → purpose) map from the scene_video_prompt JSONs on disk.
const sceneVideoDir = join(projectDir, 'prompts', 'videos', 'scenes');
const shotPurposes = new Map<string, string>(); // key: "scene_N/shot_M"
if (existsSync(sceneVideoDir)) {
  for (const f of readdirSync(sceneVideoDir)) {
    if (!f.endsWith('.json') || f.includes('state_diff') || f.includes('.state.')) continue;
    const sceneMatch = f.match(/^(scene_\d+)\.json$/);
    if (!sceneMatch) continue;
    const sceneId = sceneMatch[1];
    try {
      let content = readFileSync(join(sceneVideoDir, f), 'utf-8').trim();
      if (content.startsWith('```')) {
        content = content.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }
      const parsed = JSON.parse(content);
      const shots = parsed.shots ?? [];
      for (const shot of shots) {
        const key = `${sceneId}/shot_${shot.shotNumber}`;
        shotPurposes.set(key, shot.purpose || '');
      }
    } catch (e) {
      console.warn(`  failed to parse ${f}: ${(e as Error).message}`);
    }
  }
}

interface FrameStats {
  total: number;
  canonicalNamed: number;
  canonicalMissingPhrase: number;
  canonicalMissingArray: number;
  canonicalMissingEither: number;
  anyCharMention: number;
  anyCharMissingPhrase: number;
  // Ref-level tallies (every label-in-prose counts as one ref opportunity).
  refOpportunities: number;
  refMissing: number;
}
function makeBucket(): FrameStats {
  return {
    total: 0,
    canonicalNamed: 0,
    canonicalMissingPhrase: 0,
    canonicalMissingArray: 0,
    canonicalMissingEither: 0,
    anyCharMention: 0,
    anyCharMissingPhrase: 0,
    refOpportunities: 0,
    refMissing: 0,
  };
}

const before = makeBucket();
const after = makeBucket();
let injectedCount = 0;

const allCharLabels = allRefs.filter(r => r.type === 'character').map(r => r.label);

// Walk every shot_image_prompt JSON on disk.
const shotsDir = join(projectDir, 'prompts', 'images', 'shots');
if (!existsSync(shotsDir)) {
  console.error(`No shots dir: ${shotsDir}`);
  process.exit(1);
}

function analyzeFrame(
  frame: ShotImagePromptFrame,
  availableRefs: AvailableRefMinimal[],
  allCharLabels: string[],
): {
  canonical: { namedChars: boolean; missingPhrase: boolean; missingArray: boolean };
  anyCharMention: boolean;
  anyCharMissingPhrase: boolean;
  // One tuple per (frame × canonical ref whose label appears in prose).
  // "missing" = phrase absent OR array entry absent.
  refOpportunities: number;
  refMissing: number;
} {
  let canonicalNamed = false;
  let canonicalMissingPhrase = false;
  let canonicalMissingArray = false;
  const prose = (frame.imagePrompt ?? '').toLowerCase();

  // "Expected ref" = a canonical label (from availableRefs) that
  // appears in prose. For each expected ref we check:
  //   (a) Is there an entry in the frame's references array for this
  //       refId? Source of truth: refId match, not imageNumber —
  //       because the reorder pass renumbers.
  //   (b) Does prose contain "from image <N>" where N is whatever
  //       imageNumber the frame's OWN references array assigns to this
  //       refId? This measures internal consistency of the final JSON:
  //       downstream tools read refs + prose together and need them
  //       aligned. They don't care about the LLM's original numbering.
  let refOpportunities = 0;
  let refMissing = 0;
  const refsByRefId = new Map<string, number>(); // refId → imageNumber in this frame
  for (const r of frame.references ?? []) {
    if (r.refId) refsByRefId.set(r.refId, r.imageNumber);
  }

  for (const ar of availableRefs) {
    const proseForm = ar.label.replace(/_/g, ' ').toLowerCase();
    if (proseForm.length < 2) continue;
    const nameRe = new RegExp(
      `(?<![A-Za-z0-9])${proseForm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`,
      'i',
    );
    if (!nameRe.test(prose)) continue;

    refOpportunities++;
    const framesN = refsByRefId.get(ar.refId);
    const hasArray = framesN !== undefined;
    // If the ref isn't in the frame's array, fall back to the canonical
    // N from availableRefs (what the LLM was told). Either the phrase
    // was written with that N, or there's no valid phrase at all.
    const checkN = framesN ?? ar.imageNumber;
    const phraseRe = new RegExp(`\\bfrom\\s+image\\s+${checkN}\\b`, 'i');
    const hasPhrase = phraseRe.test(prose);
    if (!hasPhrase || !hasArray) refMissing++;

    if (ar.type === 'character') {
      canonicalNamed = true;
      if (!hasPhrase) canonicalMissingPhrase = true;
      if (!hasArray) canonicalMissingArray = true;
    }
  }

  // Sloppy: ANY project character named in prose, regardless of
  // whether the filter allowed them. Catches cases where the LLM
  // wrote in a character that was supposed to be filtered out (e.g.
  // Parvati named in a `set_the_world` shot where the purpose filter
  // stripped her from availableRefs).
  let anyCharMention = false;
  let anyCharMissingPhrase = false;
  for (const label of allCharLabels) {
    const proseForm = label.replace(/_/g, ' ').toLowerCase();
    const nameRe = new RegExp(
      `(?<![A-Za-z0-9])${proseForm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`,
      'i',
    );
    if (!nameRe.test(prose)) continue;
    anyCharMention = true;
    // Find the nearest "from image N" within 80 chars of the first match.
    const match = nameRe.exec(prose);
    if (!match) continue;
    const tail = prose.slice(match.index + match[0].length, match.index + match[0].length + 80);
    if (!/\bfrom\s+image\s+\d+\b/.test(tail)) {
      anyCharMissingPhrase = true;
    }
  }

  return {
    canonical: {
      namedChars: canonicalNamed,
      missingPhrase: canonicalMissingPhrase,
      missingArray: canonicalMissingArray,
    },
    anyCharMention,
    anyCharMissingPhrase,
    refOpportunities,
    refMissing,
  };
}

const perShotLog: Array<{ file: string; frame: string; injected: number; details: string }> = [];

for (const f of readdirSync(shotsDir).sort()) {
  if (!f.endsWith('.json')) continue;
  const fpath = join(shotsDir, f);
  let json: any;
  try {
    json = JSON.parse(readFileSync(fpath, 'utf-8'));
  } catch (e) {
    console.warn(`  skip ${f}: ${(e as Error).message}`);
    continue;
  }
  // file name: "scene-1-shot-1.json" → sceneId "scene_1", shotNum 1
  const m = f.match(/^scene-(\d+)-shot-(\d+)\.json$/);
  if (!m) continue;
  const sceneId = `scene_${m[1]}`;
  const shotKey = `${sceneId}/shot_${m[2]}`;
  const purpose = shotPurposes.get(shotKey) ?? '';
  // Option B (2026-04-24): use UNFILTERED refs for the normalizer.
  // When the purpose filter strips characters but the LLM names them
  // anyway, we still want to tag them correctly so the image generator
  // loads the right reference. See ExecutorAgent.buildAvailableRefsForShot
  // for full rationale. `purpose` is kept around for context but unused.
  void purpose;
  void filterRefsByPurpose;
  const availableRefs = allRefs;

  if (!json.frames || typeof json.frames !== 'object') continue;

  const mutatedJson = { ...json, frames: { ...json.frames } };
  for (const frameKey of Object.keys(json.frames)) {
    const orig = json.frames[frameKey];
    if (!orig || typeof orig.imagePrompt !== 'string' || !Array.isArray(orig.references)) continue;

    const beforeStats = analyzeFrame(orig, availableRefs, allCharLabels);
    before.total++;
    if (beforeStats.canonical.namedChars) {
      before.canonicalNamed++;
      if (beforeStats.canonical.missingPhrase) before.canonicalMissingPhrase++;
      if (beforeStats.canonical.missingArray) before.canonicalMissingArray++;
      if (beforeStats.canonical.missingPhrase || beforeStats.canonical.missingArray) before.canonicalMissingEither++;
    }
    if (beforeStats.anyCharMention) before.anyCharMention++;
    if (beforeStats.anyCharMissingPhrase) before.anyCharMissingPhrase++;
    before.refOpportunities += beforeStats.refOpportunities;
    before.refMissing += beforeStats.refMissing;

    const { frame: normalized, injected } = normalizeShotImagePromptWithRefs(
      orig as ShotImagePromptFrame,
      availableRefs,
    );
    mutatedJson.frames[frameKey] = normalized;
    injectedCount += injected.length;

    if (injected.length > 0) {
      perShotLog.push({
        file: f,
        frame: frameKey,
        injected: injected.length,
        details: injected.map(i => `${i.label}#${i.imageNumber}(${i.kind})`).join(', '),
      });
    }

    const afterStats = analyzeFrame(normalized, availableRefs, allCharLabels);
    after.total++;
    if (afterStats.canonical.namedChars) {
      after.canonicalNamed++;
      if (afterStats.canonical.missingPhrase) after.canonicalMissingPhrase++;
      if (afterStats.canonical.missingArray) after.canonicalMissingArray++;
      if (afterStats.canonical.missingPhrase || afterStats.canonical.missingArray) after.canonicalMissingEither++;
    }
    if (afterStats.anyCharMention) after.anyCharMention++;
    if (afterStats.anyCharMissingPhrase) after.anyCharMissingPhrase++;
    after.refOpportunities += afterStats.refOpportunities;
    after.refMissing += afterStats.refMissing;
  }

  if (writeBack) {
    writeFileSync(fpath, JSON.stringify(mutatedJson, null, 2));
  }
}

function pct(n: number, d: number): string {
  if (d === 0) return '—';
  return `${((n / d) * 100).toFixed(1)}%`;
}

console.log(`\nProject: ${projectDir}`);
console.log(`Total frames: ${before.total}`);
console.log();
console.log(`OVERALL — of all ref opportunities (every time a canonical char/setting label appears in prose),`);
console.log(`how many are missing either "from image N" or the references array entry?`);
console.log();
console.log(`                    BEFORE                AFTER`);
console.log(`  missing/wrong:    ${String(before.refMissing).padStart(3)} / ${before.refOpportunities} (${pct(before.refMissing, before.refOpportunities).padStart(6)})     ${String(after.refMissing).padStart(3)} / ${after.refOpportunities} (${pct(after.refMissing, after.refOpportunities).padStart(6)})`);
console.log();
console.log(`Total ref injections: ${injectedCount} across ${perShotLog.length} frame(s)`);
if (perShotLog.length > 0) {
  console.log();
  console.log(`Frames touched:`);
  for (const p of perShotLog) {
    console.log(`  ${p.file} / ${p.frame}: ${p.details}`);
  }
}

if (writeBack) {
  console.log(`\n✓ Normalized JSON written back to disk (${perShotLog.length} frame(s) changed).`);
} else {
  console.log(`\n(dry run — pass --write to save normalized JSON back to disk)`);
}
