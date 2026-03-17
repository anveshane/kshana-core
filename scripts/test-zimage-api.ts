/**
 * Quick test: generate an image using the zimage API-format workflow.
 * Run with: npx tsx scripts/test-zimage-api.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import {
  loadWorkflowTemplate,
  parameterizeWorkflowByName,
  getRegistry,
  ComfyUIClient,
} from '../src/services/comfyui/index.js';

const OUTPUT_DIR = path.join(process.cwd(), 'test-output');

async function main() {
  // Ensure output dir exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const registry = getRegistry();
  const metadata = registry.get('zimage')!;
  console.log(`Using workflow: ${metadata.displayName} (${metadata.filename})`);

  // Load template
  const template = loadWorkflowTemplate(metadata.filename);
  console.log('Template loaded. Format:', 'nodes' in template ? 'LiteGraph' : 'API');

  // Parameterize
  const workflow = parameterizeWorkflowByName('zimage', template, {
    sceneNumber: 1,
    prompt: 'A majestic snow-capped mountain at golden hour, dramatic lighting, cinematic composition, 8k detailed photograph',
    negativePrompt: 'blurry, ugly, bad quality, deformed',
    aspectRatio: '16:9',
    seed: 42,
    filenamePrefix: 'test_zimage_api',
  });

  console.log('Workflow parameterized. Nodes:', Object.keys(workflow).length);

  // Log key node values for verification
  const node6 = (workflow as Record<string, any>)['6'];
  const node7 = (workflow as Record<string, any>)['7'];
  const node3 = (workflow as Record<string, any>)['3'];
  const node13 = (workflow as Record<string, any>)['13'];
  const node9 = (workflow as Record<string, any>)['9'];

  console.log('\n--- Parameter verification ---');
  console.log('Positive prompt (node 6):', typeof node6?.inputs?.text === 'string' ? node6.inputs.text.slice(0, 80) + '...' : node6?.inputs?.text);
  console.log('Negative prompt (node 7):', node7?.inputs?.text);
  console.log('Seed (node 3):', node3?.inputs?.seed);
  console.log('Dimensions (node 13):', node13?.inputs?.width, 'x', node13?.inputs?.height);
  console.log('Filename prefix (node 9):', node9?.inputs?.filename_prefix);

  // Queue with ComfyUI
  console.log('\n--- Submitting to ComfyUI ---');
  const client = new ComfyUIClient({ outputDir: OUTPUT_DIR });

  try {
    const queueResult = await client.queueWorkflow(workflow as Record<string, unknown>, undefined, true);
    console.log(`Queued! Prompt ID: ${queueResult.promptId}`);

    // Wait for completion
    console.log('Waiting for completion...');
    const result = await client.waitForCompletionWS(
      queueResult.promptId,
      queueResult.clientId!,
      (info) => {
        if (info.percentage > 0) {
          process.stdout.write(`\r  Progress: ${info.percentage}% - ${info.message}`);
        }
      },
    );
    console.log(`\nCompletion status: ${result.status}`);

    // Download output
    const images = await client.getOutputImages(queueResult.promptId);
    if (images.length > 0) {
      const first = images[0]!;
      const savedPath = await client.downloadImage(
        first.filename,
        first.subfolder,
        first.type,
        `test_zimage_api_${Date.now()}.png`,
      );
      console.log(`\nImage saved to: ${savedPath}`);
    } else {
      console.log('\nNo output images found.');
    }
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : err);
  }
}

main();
