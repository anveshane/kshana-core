#!/usr/bin/env tsx
/**
 * Calibrate the VLM fidelity judge by comparing its per-question
 * verdicts against Claude's verdicts on the same (image, prompt,
 * rubric) inputs.
 *
 * The VLM is the production judge — we want it trusted for image /
 * video-frame fidelity scoring. Claude (via `claude -p`) acts as
 * ground truth during calibration. The loop:
 *
 *   1. Run the VLM judge on each calibration case — it sees image +
 *      prompt + rubric and returns YES/NO for each rubric question.
 *   2. Run Claude with identical inputs — it reads the image via the
 *      Read tool and returns YES/NO for each rubric question.
 *   3. Diff per-question verdicts. Agreement = match rate across all
 *      questions × all cases.
 *   4. If agreement is low, tune `prompts/skills/defaults/vlm_image_judge.md`
 *      to close the gap. Re-run.
 *
 * Calibration passes when per-question agreement >= 80%.
 *
 * Usage:
 *   pnpm calibrate-vlm
 *
 * Prerequisites:
 *   - LLM routing config (.llm-routing.json or env) so
 *     `utility.image_review` points at a vision-capable model.
 *   - The `claude` CLI in PATH.
 *   - Calibration images present at paths in
 *     `tests/calibration/vlm-judge-calibration.json`.
 */

import 'dotenv/config';
import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, statSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { createHash } from 'crypto';
import { LLMClient } from '../src/core/llm/index.js';
import { buildRouterFromEnv } from '../src/core/llm/index.js';
import { judgeImage, loadRubric, type JudgeResult, type Rubric, type QuestionVerdict } from '../src/core/eval/vlmJudge.js';

// ── Public types ────────────────────────────────────────────────────────

export interface CalibrationCase {
  id: string;
  imagePath: string;
  prompt: string;
  notes?: string;
}

export interface CalibrationFile {
  description: string;
  rubric: string;
  cases: CalibrationCase[];
}

export interface QuestionDiff {
  id: string;
  vlmPass: boolean;
  claudePass: boolean;
  agree: boolean;
  vlmReasoning: string;
  claudeReasoning: string;
}

export interface CaseComparison {
  caseId: string;
  total: number;
  agreements: number;
  disagreements: number;
  agreementPct: number;
  perQuestion: QuestionDiff[];
}

// ── Pure helper (covered by tests/unit/calibrationDiff.test.ts) ─────────

/**
 * Per-question diff between VLM verdicts and Claude verdicts.
 *
 * Pure function — no I/O. Counts how many rubric questions the two
 * judges agree on. Agreement is the primary calibration signal: if
 * the VLM answers the same questions the same way Claude does across
 * a calibration set, the VLM prompt is dialed in.
 */
export function diffVerdicts(
  caseId: string,
  vlm: QuestionVerdict[],
  claude: QuestionVerdict[],
  rubricQuestionIds: string[],
): CaseComparison {
  const vlmById = new Map(vlm.map(q => [q.id, q]));
  const claudeById = new Map(claude.map(q => [q.id, q]));

  const perQuestion: QuestionDiff[] = rubricQuestionIds.map(id => {
    const v = vlmById.get(id);
    const c = claudeById.get(id);
    const vlmPass = v?.pass ?? false;
    const claudePass = c?.pass ?? false;
    return {
      id,
      vlmPass,
      claudePass,
      agree: vlmPass === claudePass,
      vlmReasoning: v?.reasoning ?? 'no verdict',
      claudeReasoning: c?.reasoning ?? 'no verdict',
    };
  });

  const agreements = perQuestion.filter(q => q.agree).length;
  const total = perQuestion.length;
  return {
    caseId,
    total,
    agreements,
    disagreements: total - agreements,
    agreementPct: total === 0 ? 0 : Math.round((agreements / total) * 100),
    perQuestion,
  };
}

// ── Claude-as-judge via `claude -p` ────────────────────────────────────

const CLAUDE_MODEL = process.env['EVAL_CLAUDE_MODEL'] ?? 'sonnet';

/**
 * Build a JSON schema matching the VLM judge's output shape for a
 * given rubric. Claude returns the same structure so we can diff
 * per-question without post-processing.
 */
function buildJudgeSchema(rubric: Rubric): Record<string, unknown> {
  const questionItem = {
    type: 'object',
    properties: {
      id: { type: 'string', enum: rubric.questions.map(q => q.id) },
      pass: { type: 'boolean' },
      reasoning: { type: 'string' },
    },
    required: ['id', 'pass', 'reasoning'],
    additionalProperties: false,
  };
  return {
    type: 'object',
    properties: {
      questions: { type: 'array', items: questionItem, minItems: rubric.questions.length, maxItems: rubric.questions.length },
      ltxAchievability: { type: 'string', enum: ['high', 'medium', 'low'] },
      topIssue: { type: 'string' },
    },
    required: ['questions', 'ltxAchievability', 'topIssue'],
    additionalProperties: false,
  };
}

/**
 * Invoke `claude -p` non-interactively with the Read tool allowed so
 * it can read the image file, and with a JSON schema so the output
 * is a structured per-question verdict matching the VLM's shape.
 */
/**
 * Cache key for a Claude verdict — tied to the image file's mtime +
 * size and to the rubric's question ids + prompt. Any change to these
 * invalidates. Since Claude is our ground-truth and we don't tweak
 * Claude's prompt during tuning iterations, this avoids paying the
 * Claude cost on every re-run of the loop.
 */
function claudeCacheKey(imagePath: string, imagePrompt: string, rubric: Rubric): string {
  const h = createHash('sha256');
  try {
    const stat = statSync(imagePath);
    h.update(`${imagePath}|${stat.size}|${stat.mtimeMs}`);
  } catch {
    h.update(`${imagePath}|missing`);
  }
  h.update('|prompt:');
  h.update(imagePrompt);
  h.update('|rubric:');
  h.update(rubric.questions.map(q => `${q.id}=${q.question}`).join('\n'));
  return h.digest('hex').slice(0, 16);
}

function claudeJudge(imagePath: string, imagePrompt: string, rubric: Rubric): QuestionVerdict[] {
  const rubricText = rubric.questions.map((q, i) => `${i + 1}. [${q.id}] ${q.question}`).join('\n');
  const userPrompt = `You are a visual fidelity judge. Read the image file at: ${imagePath}

That image was generated from the prompt below. Your job: decide for each rubric question whether the image faithfully realises the prompt. Answer YES (pass: true) or NO (pass: false) with a terse one-line reason for each.

## PROMPT used to generate the image
${imagePrompt}

## Rubric questions
${rubricText}

## Calibration guidance (match this philosophy)
- FAIL on identity substitution (named character with stated attributes ends up visibly different on age/ethnicity/build/distinguishing features).
- FAIL on duplication when the prompt names DIFFERENT characters and the image shows near-identical instances.
- FAIL on prominent hallucinated subjects (including animals the prompt did not name).
- BE FORGIVING on cosmetics: minor face shape, shade drift, animal pattern variation when species matches, minor hand artifacts, background micro-detail, stylistic mood interpretation, shot-scale drift between adjacent categories.
- Don't hedge — lean PASS unless there's a clear identifiable problem.

Output only the JSON conforming to the schema. Use the question ids exactly.`;

  const schema = buildJudgeSchema(rubric);
  const tmpFile = join(tmpdir(), `calibrate-vlm-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  writeFileSync(tmpFile, userPrompt);
  try {
    const cmd = `cat "${tmpFile}" | claude -p --model ${CLAUDE_MODEL} --allowed-tools Read --permission-mode bypassPermissions --output-format json --json-schema '${JSON.stringify(schema).replace(/'/g, "'\\''")}'`;
    const raw = execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 300000 });
    const envelope = JSON.parse(raw);
    const structured = envelope.structured_output ?? (envelope.result ? JSON.parse(envelope.result) : null);
    if (!structured || !Array.isArray(structured.questions)) {
      throw new Error('Claude returned no structured output');
    }
    return structured.questions.map((q: { id: string; pass: boolean; reasoning: string }) => ({
      id: q.id,
      pass: q.pass === true,
      reasoning: q.reasoning ?? '',
    }));
  } finally {
    try { unlinkSync(tmpFile); } catch { /* */ }
  }
}

// ── Output formatting ──────────────────────────────────────────────────

function formatCase(cmp: CaseComparison): string {
  const symbol = cmp.agreementPct >= 80 ? '✓' : '✗';
  const header = `  ${symbol} ${cmp.caseId.padEnd(40)} agreement ${String(cmp.agreementPct).padStart(3)}%  (${cmp.agreements}/${cmp.total})`;
  const lines: string[] = [header];
  const disagreements = cmp.perQuestion.filter(q => !q.agree);
  for (const d of disagreements) {
    lines.push(`     ✗ ${d.id.padEnd(30)} VLM=${d.vlmPass ? 'PASS' : 'FAIL'}  Claude=${d.claudePass ? 'PASS' : 'FAIL'}`);
    lines.push(`       VLM:    ${d.vlmReasoning.slice(0, 140)}`);
    lines.push(`       Claude: ${d.claudeReasoning.slice(0, 140)}`);
  }
  return lines.join('\n');
}

// ── Main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(join(__dirname, '..'));
  const calibPath = join(projectRoot, 'tests', 'calibration', 'vlm-judge-calibration.json');

  if (!existsSync(calibPath)) {
    console.error(`Calibration file not found: ${calibPath}`);
    process.exit(1);
  }

  const calib: CalibrationFile = JSON.parse(readFileSync(calibPath, 'utf-8'));
  const rubric = loadRubric(calib.rubric);

  const router = buildRouterFromEnv(projectRoot);
  const vlmClient: LLMClient = router.getClient('utility.image_review');
  const vlmCfg = router.resolveConfig('utility.image_review');

  const logDir = join(projectRoot, 'test-output', 'vlm-calibration');
  mkdirSync(logDir, { recursive: true });

  console.log('=== VLM Judge Calibration ===');
  console.log(`  rubric:      ${rubric.name} (${rubric.questions.length} questions)`);
  console.log(`  cases:       ${calib.cases.length}`);
  console.log(`  VLM:         ${vlmCfg.model} @ ${vlmCfg.baseUrl ?? 'default'}`);
  console.log(`  Claude:      ${CLAUDE_MODEL}`);
  console.log(`  agreement pass threshold: 80%`);
  console.log('');

  const comparisons: CaseComparison[] = [];
  const rubricIds = rubric.questions.map(q => q.id);

  for (const c of calib.cases) {
    const absImg = c.imagePath.startsWith('/') ? c.imagePath : join(projectRoot, c.imagePath);
    process.stdout.write(`  judging ${c.id}:\n`);

    process.stdout.write(`    VLM...    `);
    const t0 = Date.now();
    const vlmResult: JudgeResult = await judgeImage(absImg, c.prompt, rubric, vlmClient);
    process.stdout.write(`(${Math.round((Date.now() - t0) / 1000)}s, topIssue="${vlmResult.topIssue.slice(0, 80)}")\n`);

    process.stdout.write(`    Claude... `);
    const t1 = Date.now();
    const claudeCacheDir = join(projectRoot, 'test-output', 'vlm-calibration', 'claude-cache');
    mkdirSync(claudeCacheDir, { recursive: true });
    const cacheFile = join(claudeCacheDir, `${c.id}.${claudeCacheKey(absImg, c.prompt, rubric)}.json`);
    let claudeVerdicts: QuestionVerdict[];
    if (existsSync(cacheFile)) {
      claudeVerdicts = JSON.parse(readFileSync(cacheFile, 'utf-8'));
      process.stdout.write('(cached)\n');
    } else {
      try {
        claudeVerdicts = claudeJudge(absImg, c.prompt, rubric);
        writeFileSync(cacheFile, JSON.stringify(claudeVerdicts, null, 2));
      } catch (err) {
        process.stdout.write(`ERROR: ${(err as Error).message}\n`);
        continue;
      }
      process.stdout.write(`(${Math.round((Date.now() - t1) / 1000)}s)\n`);
    }

    const cmp = diffVerdicts(c.id, vlmResult.questions, claudeVerdicts, rubricIds);
    comparisons.push(cmp);

    // Persist per-case log for offline inspection.
    writeFileSync(join(logDir, `${c.id}.json`), JSON.stringify({
      case: c,
      vlm: vlmResult,
      claude: claudeVerdicts,
      comparison: cmp,
    }, null, 2));

    process.stdout.write(`    agreement: ${cmp.agreementPct}% (${cmp.agreements}/${cmp.total})\n`);
  }

  console.log('');
  console.log('--- Per-case breakdown ---');
  for (const cmp of comparisons) {
    console.log(formatCase(cmp));
  }
  console.log('');

  const totalQuestions = comparisons.reduce((s, c) => s + c.total, 0);
  const totalAgreements = comparisons.reduce((s, c) => s + c.agreements, 0);
  const overallPct = totalQuestions === 0 ? 0 : Math.round((totalAgreements / totalQuestions) * 100);

  console.log(`--- Summary ---`);
  console.log(`  overall agreement: ${overallPct}% (${totalAgreements}/${totalQuestions} question-level matches)`);

  // Per-question aggregate: how often does each rubric question agree across cases?
  const perQuestionAggregate: Record<string, { agree: number; total: number }> = {};
  for (const cmp of comparisons) {
    for (const q of cmp.perQuestion) {
      const a = perQuestionAggregate[q.id] ?? (perQuestionAggregate[q.id] = { agree: 0, total: 0 });
      a.total += 1;
      if (q.agree) a.agree += 1;
    }
  }
  const worst = Object.entries(perQuestionAggregate)
    .map(([id, v]) => ({ id, pct: Math.round((v.agree / v.total) * 100), agree: v.agree, total: v.total }))
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 3);
  if (worst.length > 0 && worst[0]!.pct < 100) {
    console.log(`  weakest questions:`);
    for (const w of worst) {
      console.log(`    ${w.id.padEnd(30)} ${w.pct}% agreement  (${w.agree}/${w.total})`);
    }
  }

  if (overallPct >= 80) {
    console.log(`  ✓ Calibration passes. VLM judge is dialed in enough to trust for batch eval.`);
    process.exit(0);
  } else {
    console.log(`  ✗ Calibration below 80%. Tune prompts/skills/defaults/vlm_image_judge.md and re-run.`);
    process.exit(1);
  }
}

const invokedDirectly = (() => {
  const invoked = process.argv[1];
  if (!invoked) return false;
  return invoked.endsWith('calibrate-vlm.ts') || invoked.endsWith('calibrate-vlm.js');
})();

if (invokedDirectly) {
  main().catch(err => {
    console.error('Fatal:', (err as Error).message);
    process.exit(1);
  });
}
