/**
 * Test script for Z-Image Turbo text-to-image workflow.
 *
 * Usage:
 *   tsx scripts/test-zimage.ts --prompt "a cinematic skyline at dusk" [--negative "low quality"] [--seed 1234] [--aspect 16:9] [--url <comfy_url>] [--output ./outputs]
 */

import 'dotenv/config';
import * as path from 'path';
import {
  ComfyUIClient,
  loadWorkflowTemplate,
  parameterizeWorkflowByName,
} from '../src/services/comfyui/index.js';
import { getRegistry } from '../src/services/comfyui/WorkflowRegistry.js';

interface Args {
  prompt: string;
  negative?: string;
  seed?: number;
  aspect?: string;
  url?: string;
  output?: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const result: Partial<Args> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--prompt':
        result.prompt = next;
        i++;
        break;
      case '--negative':
        result.negative = next;
        i++;
        break;
      case '--seed':
        result.seed = parseInt(next, 10);
        i++;
        break;
      case '--aspect':
        result.aspect = next;
        i++;
        break;
      case '--url':
        result.url = next;
        i++;
        break;
      case '--output':
        result.output = next;
        i++;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
    }
  }

  if (!result.prompt) {
    console.error('Error: --prompt is required');
    printUsage();
    process.exit(1);
  }

  return result as Args;
}

function printUsage(): void {
  console.log(`
Usage: tsx scripts/test-zimage.ts --prompt "a cinematic skyline" [options]

Options:
  --prompt <text>      Text prompt (required)
  --negative <text>    Negative prompt (optional)
  --seed <number>      Seed (optional)
  --aspect <ratio>     Aspect ratio: 16:9 | 9:16 | 1:1 | 4:3 | 3:4 (default: 16:9)
  --url <url>          ComfyUI base URL (default: COMFYUI_BASE_URL or http://localhost:8188)
  --output <path>      Output directory (default: ./outputs)
`);
}

async function main() {
  const args = parseArgs();

  const baseUrl = args.url || process.env['COMFYUI_BASE_URL'] || 'http://localhost:8188';
  const outputDir = args.output || './outputs';
  const aspectRatio = (args.aspect || '16:9') as '16:9' | '9:16' | '1:1' | '4:3' | '3:4';

  console.log('============================================================');
  console.log('ComfyUI Z-Image Text-to-Image Test');
  console.log('============================================================');
  console.log(`Prompt:   ${args.prompt}`);
  console.log(`Negative: ${args.negative ?? '(none)'}`);
  console.log(`Seed:     ${args.seed ?? '(random)'}`);
  console.log(`Aspect:   ${aspectRatio}`);
  console.log(`URL:      ${baseUrl}`);
  console.log(`Output:   ${path.resolve(outputDir)}`);
  console.log('============================================================\n');

  const registry = getRegistry();
  const meta = registry.get('zimage');
  if (!meta) {
    throw new Error('Z-Image workflow metadata not found');
  }

  const template = loadWorkflowTemplate(meta.filename);

  const workflow = parameterizeWorkflowByName('zimage', template, {
    sceneNumber: 1,
    prompt: args.prompt,
    negativePrompt: args.negative,
    seed: args.seed,
    aspectRatio,
    filenamePrefix: 'ZImageTest',
  });

  const client = new ComfyUIClient({ baseUrl, outputDir, timeout: 600 });

  try {
    const savedPath = await client.generateAndDownload(workflow as Record<string, unknown>);
    console.log(`\n✅ Image generated and saved to: ${savedPath}`);
  } catch (err) {
    console.error('\n❌ Generation failed:', err);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
