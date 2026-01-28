/**
 * Mock Remotion render script for tests.
 * Same CLI as render.mts: --input <json> --outDir <dir> [--output <json>]
 * Writes { outputs: [...] } to --output (or stdout if omitted). Does not run Remotion.
 */
import fs from 'node:fs';
import path from 'node:path';

function parseArgs() {
  const args = process.argv.slice(2);
  let input = '';
  let outDir = '';
  let output = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) input = args[i + 1];
    if (args[i] === '--outDir' && args[i + 1]) outDir = args[i + 1];
    if (args[i] === '--output' && args[i + 1]) output = args[i + 1];
  }
  if (!input || !outDir) {
    console.error('Usage: node mock-remotion-render.mjs -- --input <json-path> --outDir <dir> [--output <json-path>]');
    process.exit(1);
  }
  return { input, outDir, output };
}

const { input: inputPath, outDir, output: outputPath } = parseArgs();
const raw = fs.readFileSync(inputPath, 'utf-8');
const { placements } = JSON.parse(raw);

const outputs = (placements || []).map(
  (p) => path.join(outDir, `info${p.placementNumber}_mock${Date.now().toString(36)}.mp4`)
);
const json = JSON.stringify({ outputs });

if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, json, 'utf-8');
} else {
  console.log(json);
}
