#!/usr/bin/env node
/**
 * Toggle the active LLM tier models in `.env` between Grok and DeepSeek.
 *
 * Each of HEAVY / MEDIUM / LIGHT must have two LLM_TIER_<TIER>_MODEL=
 * lines — one for grok, one for deepseek — with exactly one uncommented.
 * All three tiers must share the same active model. The script flips
 * them in lockstep.
 *
 * Run: `node scripts/swap-llm.js`
 *      `node scripts/swap-llm.js --env path/to/.env`  (override path)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GROK = 'x-ai/grok-4.1-fast';
const DEEPSEEK = 'deepseek/deepseek-v4-flash';
const TIERS = ['HEAVY', 'MEDIUM', 'LIGHT'];

function parseArgs(argv) {
  const args = { envPath: path.resolve(__dirname, '..', '.env') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--env' && argv[i + 1]) {
      args.envPath = path.resolve(argv[++i]);
    }
  }
  return args;
}

function fail(msg) {
  process.stderr.write(`swap-llm: ${msg}\n`);
  process.exit(1);
}

/** Match a tier line. Returns { commented, model } or null. */
function matchTierLine(tier, line) {
  const re = new RegExp(
    `^(\\s*#\\s*)?LLM_TIER_${tier}_MODEL\\s*=\\s*(\\S+)\\s*$`,
  );
  const m = line.match(re);
  if (!m) return null;
  return { commented: Boolean(m[1]), model: m[2] };
}

function main() {
  const { envPath } = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(envPath)) fail(`.env not found: ${envPath}`);

  const original = fs.readFileSync(envPath, 'utf8');
  const lines = original.split('\n');

  // Index every tier line: tier → [{ idx, commented, model, line }, ...]
  const byTier = Object.fromEntries(TIERS.map((t) => [t, []]));
  lines.forEach((line, idx) => {
    for (const tier of TIERS) {
      const parsed = matchTierLine(tier, line);
      if (parsed) byTier[tier].push({ idx, ...parsed, line });
    }
  });

  // Validate shape: each tier needs exactly one grok + one deepseek line.
  for (const tier of TIERS) {
    const entries = byTier[tier];
    if (entries.length !== 2) {
      fail(
        `tier ${tier}: expected 2 LLM_TIER_${tier}_MODEL lines (grok + deepseek), found ${entries.length}`,
      );
    }
    const models = entries.map((e) => e.model).sort();
    const expected = [DEEPSEEK, GROK].sort();
    if (models[0] !== expected[0] || models[1] !== expected[1]) {
      fail(
        `tier ${tier}: expected models [${expected.join(', ')}], found [${models.join(', ')}]`,
      );
    }
    const active = entries.filter((e) => !e.commented);
    if (active.length !== 1) {
      fail(
        `tier ${tier}: expected exactly 1 uncommented line, found ${active.length}`,
      );
    }
  }

  // All three tiers must share the same active model.
  const activeModels = TIERS.map(
    (t) => byTier[t].find((e) => !e.commented).model,
  );
  if (new Set(activeModels).size !== 1) {
    fail(
      `tiers disagree on active model: HEAVY=${activeModels[0]}, MEDIUM=${activeModels[1]}, LIGHT=${activeModels[2]}`,
    );
  }

  const outgoing = activeModels[0];
  const incoming = outgoing === GROK ? DEEPSEEK : GROK;
  const outgoingName = outgoing === GROK ? 'grok' : 'deepseek';
  const incomingName = incoming === GROK ? 'grok' : 'deepseek';

  // Apply the flip. Two line-index updates per tier.
  for (const tier of TIERS) {
    const entries = byTier[tier];
    const activeEntry = entries.find((e) => !e.commented && e.model === outgoing);
    const inactiveEntry = entries.find((e) => e.commented && e.model === incoming);
    // Comment the active line. Preserve any existing whitespace prefix.
    lines[activeEntry.idx] = `# LLM_TIER_${tier}_MODEL=${outgoing}`;
    // Uncomment the inactive line.
    lines[inactiveEntry.idx] = `LLM_TIER_${tier}_MODEL=${incoming}`;
  }

  const updated = lines.join('\n');
  if (updated === original) {
    fail('no changes computed — refusing to write');
  }
  fs.writeFileSync(envPath, updated);
  process.stdout.write(
    `Swapped ${outgoingName} → ${incomingName} across HEAVY / MEDIUM / LIGHT tiers.\n`,
  );
}

main();
