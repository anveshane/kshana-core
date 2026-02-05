import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
let input = '';
let outDir = '';
let output = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--input' && args[i + 1]) input = args[i + 1];
  if (args[i] === '--outDir' && args[i + 1]) outDir = args[i + 1];
  if (args[i] === '--output' && args[i + 1]) output = args[i + 1];
}
const raw = fs.readFileSync(input, 'utf-8');
const data = JSON.parse(raw);
const component2 = fs.readFileSync(path.join(process.cwd(), 'src', 'components', 'Infographic2.tsx'), 'utf-8');
if (component2.includes('BAD_WATER')) {
  console.error('ReferenceError: waterGrad is not defined');
  console.error('at Infographic2 (http://localhost:3000/bundle.js:10:10)');
  process.exit(1);
}
const outputs = (data.placements || []).map((p) => path.join(outDir, `info${p.placementNumber}_mock${Date.now().toString(36)}.mp4`));
if (output) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ outputs }), 'utf-8');
}
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'captured_input.json'), raw, 'utf-8');