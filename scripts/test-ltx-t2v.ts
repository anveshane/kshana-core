#!/usr/bin/env tsx
/**
 * Test LTX23 text-to-video (no source image).
 *
 * Usage:
 *   pnpm tsx scripts/test-ltx-t2v.ts [prompt] [duration] [width] [height]
 */

import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { ComfyUIClient } from '../src/services/comfyui/ComfyUIClient.js';
import { loadWorkflowTemplate, parameterizeWorkflowByName } from '../src/services/comfyui/WorkflowLoader.js';
import { getRegistry } from '../src/services/comfyui/WorkflowRegistry.js';

async function main() {
  const prompt = process.argv[2] || 'Static wide shot. Rust-red shipping containers stacked four high. Chemical mist churns through depth. Sodium light beams slash through haze.';
  const duration = parseInt(process.argv[3] || '3', 10);
  const width = parseInt(process.argv[4] || '848', 10);
  const height = parseInt(process.argv[5] || '480', 10);

  const outputDir = join(process.cwd(), 'test-output');
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  console.log(`Prompt: ${prompt}`);
  console.log(`Duration: ${duration}s, Resolution: ${width}x${height}`);
  console.log(`Mode: TEXT-TO-VIDEO (no source image)`);
  console.log('');

  const client = new ComfyUIClient({ outputDir });
  const registry = getRegistry();
  const workflowMetadata = registry.get('ltx23');
  if (!workflowMetadata) {
    console.error('LTX23 workflow not found');
    process.exit(1);
  }

  console.log('Loading workflow...');
  const template = loadWorkflowTemplate(workflowMetadata.filename);
  // No inputImageFilename — triggers t2v mode
  const workflow = parameterizeWorkflowByName('ltx23', template, {
    sceneNumber: 0,
    prompt,
    filenamePrefix: 'test_t2v',
    durationSeconds: duration,
    width,
    height,
  } as Parameters<typeof parameterizeWorkflowByName>[2]);

  console.log('Queueing workflow...');
  const queueResult = await client.queueWorkflow(workflow as Record<string, unknown>, undefined, true);
  console.log(`Prompt ID: ${queueResult.promptId}`);

  console.log('Waiting for completion...');
  const result = await client.waitForCompletionWS(queueResult.promptId, queueResult.clientId!, (info) => {
    if (info.percentage > 0) process.stdout.write(`\r  ${info.message}`);
  });
  console.log('\n');

  if (result.status !== 'completed') {
    console.error(`Failed: ${result.status}`);
    process.exit(1);
  }

  const images = await client.getOutputImages(queueResult.promptId);
  if (images.length === 0) {
    console.error('No output files');
    process.exit(1);
  }

  const first = images[0]!;
  const outputFilename = `test_t2v_${Date.now()}.mp4`;
  const savedPath = await client.downloadImage(first.filename, first.subfolder, first.type, outputFilename);
  console.log(`Output saved: ${savedPath}`);
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
