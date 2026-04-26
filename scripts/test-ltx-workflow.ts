#!/usr/bin/env tsx
/**
 * Test script for ComfyUI LTX-2.3 GGUF video generation workflow.
 *
 * Supports two modes via a single workflow:
 * 1. Text-to-Video (t2v) - Generate video from text prompt
 * 2. Image-to-Video (i2v) - Animate a static image based on motion prompt
 *
 * Usage:
 *   # Text-to-video mode
 *   tsx scripts/test-ltx-workflow.ts --mode t2v --prompt <text> [options]
 *
 *   # Image-to-video mode
 *   tsx scripts/test-ltx-workflow.ts --mode i2v --image <path> --prompt <text> [options]
 *
 * Options:
 *   --mode <t2v|i2v>     Generation mode (required)
 *   --prompt <text>      Video/motion prompt (required)
 *   --image <path>       Input image file path (required for i2v mode)
 *   --width <number>     Video width (default: 1280)
 *   --height <number>    Video height (default: 720)
 *   --duration <number>  Duration in seconds (1-20, default: 10)
 *   --seed <number>      Random seed (optional, defaults to random)
 *   --url <url>          ComfyUI base URL (optional, defaults to COMFYUI_BASE_URL env or http://localhost:8188)
 *   --wait               Wait for completion and download the video (optional)
 *   --output <path>      Output directory for downloaded video (optional, defaults to ./outputs)
 *
 * Examples:
 *   # Text-to-video (queue only)
 *   tsx scripts/test-ltx-workflow.ts --mode t2v --prompt "A cheerful puppet singing in the rain"
 *
 *   # Text-to-video (wait and download)
 *   tsx scripts/test-ltx-workflow.ts --mode t2v --prompt "A puppet dancing" --width 1280 --height 720 --wait
 *
 *   # Image-to-video with download
 *   tsx scripts/test-ltx-workflow.ts --mode i2v --image ./scene.png --prompt "The character starts dancing" --wait
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { ComfyUIClient } from '../src/services/comfyui/ComfyUIClient';
import { loadWorkflowTemplate, parameterizeWorkflowByName } from '../src/services/comfyui/WorkflowLoader';

interface Args {
  mode: 't2v' | 'i2v';
  prompt: string;
  image?: string;
  width?: number;
  height?: number;
  duration?: number;
  seed?: number;
  url?: string;
  wait?: boolean;
  output?: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const result: Partial<Args> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--mode':
        if (next !== 't2v' && next !== 'i2v') {
          console.error('Error: --mode must be either "t2v" or "i2v"');
          process.exit(1);
        }
        result.mode = next as 't2v' | 'i2v';
        i++;
        break;
      case '--prompt':
        result.prompt = next;
        i++;
        break;
      case '--image':
        result.image = next;
        i++;
        break;
      case '--width':
        result.width = parseInt(next, 10);
        i++;
        break;
      case '--height':
        result.height = parseInt(next, 10);
        i++;
        break;
      case '--duration':
        result.duration = parseInt(next, 10);
        i++;
        break;
      case '--seed':
        result.seed = parseInt(next, 10);
        i++;
        break;
      case '--url':
        result.url = next;
        i++;
        break;
      case '--wait':
        result.wait = true;
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

  // Validate required args
  if (!result.mode) {
    console.error('Error: --mode is required (t2v or i2v)');
    printUsage();
    process.exit(1);
  }

  if (!result.prompt) {
    console.error('Error: --prompt is required');
    printUsage();
    process.exit(1);
  }

  if (result.mode === 'i2v' && !result.image) {
    console.error('Error: --image is required for i2v mode');
    printUsage();
    process.exit(1);
  }

  return result as Args;
}

function printUsage(): void {
  console.log(`
Usage: tsx scripts/test-ltx-workflow.ts --mode <t2v|i2v> --prompt <text> [options]

Modes:
  t2v    Text-to-Video: Generate video from text prompt
  i2v    Image-to-Video: Animate a static image with motion prompt

Options:
  --mode <t2v|i2v>     Generation mode (required)
  --prompt <text>      Video/motion prompt (required)
  --image <path>       Input image file path (required for i2v mode)
  --width <number>     Video width in pixels (default: 1280)
  --height <number>    Video height in pixels (default: 720)
  --duration <number>  Duration in seconds (1-20, default: 10)
  --seed <number>      Random seed for reproducibility (optional)
  --url <url>          ComfyUI base URL (optional, defaults to COMFYUI_BASE_URL env)
  --wait               Wait for completion and download the generated video
  --output <path>      Output directory for downloaded video (default: ./outputs)
  --help, -h           Show this help message

Examples:
  # Text-to-video (queue only)
  tsx scripts/test-ltx-workflow.ts --mode t2v --prompt "A cheerful puppet singing in the rain"

  # Text-to-video with custom dimensions (wait and download)
  tsx scripts/test-ltx-workflow.ts --mode t2v --prompt "A puppet dancing" --width 1280 --height 720 --duration 10 --wait

  # Image-to-video with download
  tsx scripts/test-ltx-workflow.ts --mode i2v --image ./scene.png --prompt "The character starts dancing" --duration 8 --wait
`);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const isI2VMode = args.mode === 'i2v';

  // Resolve image path if i2v mode
  let imagePath: string | undefined;
  if (isI2VMode && args.image) {
    imagePath = path.resolve(args.image);
    if (!fs.existsSync(imagePath)) {
      console.error(`Error: Image file not found: ${imagePath}`);
      process.exit(1);
    }
  }

  // Set default values
  const duration = Math.min(Math.max(args.duration || 10, 1), 20);
  const width = args.width || 1280;
  const height = args.height || 720;
  const t2vMode = !isI2VMode;

  console.log('='.repeat(60));
  console.log(`ComfyUI LTX-2.3 GGUF ${isI2VMode ? 'Image-to-Video' : 'Text-to-Video'} Test`);
  console.log('='.repeat(60));
  console.log(`Mode:     ${args.mode.toUpperCase()}`);
  if (imagePath) console.log(`Image:    ${imagePath}`);
  console.log(`Prompt:   ${args.prompt.substring(0, 80)}${args.prompt.length > 80 ? '...' : ''}`);
  console.log(`Size:     ${width}x${height}`);
  console.log(`Duration: ${duration}s`);
  if (args.seed) console.log(`Seed:     ${args.seed}`);
  console.log(`Wait:     ${args.wait ? 'Yes (will download video)' : 'No (queue only)'}`);
  console.log('='.repeat(60));

  // Create ComfyUI client
  const baseUrl = args.url || process.env['COMFYUI_BASE_URL'] || 'http://localhost:8188';
  const outputDir = args.output || './outputs';
  console.log(`\nConnecting to ComfyUI at: ${baseUrl}`);

  const client = new ComfyUIClient({
    baseUrl,
    outputDir,
    timeout: 1800, // 30 min - video generation is compute-intensive
  });

  try {
    // Calculate step count
    const baseSteps = isI2VMode ? 4 : 3;
    const stepCount = args.wait ? baseSteps + 2 : baseSteps;

    let uploadedImageName: string | undefined;

    // Step 1 (i2v only): Upload image
    if (isI2VMode && imagePath) {
      console.log(`\n[1/${stepCount}] Uploading image: ${path.basename(imagePath)}`);
      const uploadResult = await client.uploadImage(imagePath);
      uploadedImageName = uploadResult.name;
      console.log(`      Uploaded as: ${uploadResult.name} (subfolder: ${uploadResult.subfolder || 'root'}, type: ${uploadResult.type})`);
    }

    // Load and parameterize workflow
    const loadStep = isI2VMode ? 2 : 1;
    const queueStep = isI2VMode ? 3 : 2;

    console.log(`\n[${loadStep}/${stepCount}] Loading workflow template: cloud/ltx23_fl2v_cloud.json`);
    const template = loadWorkflowTemplate('cloud/ltx23_fl2v_cloud.json');

    console.log('      Parameterizing workflow...');
    const workflow = parameterizeWorkflowByName('ltx23', template, {
      sceneNumber: 0,
      prompt: args.prompt,
      seed: args.seed,
      durationSeconds: duration,
      width,
      height,
      inputImageFilename: uploadedImageName,
      filenamePrefix: `LTX23_${args.mode.toUpperCase()}_Test`,
    } as Parameters<typeof parameterizeWorkflowByName>[2]);

    // Queue workflow
    console.log(`\n[${queueStep}/${stepCount}] Queueing workflow to ComfyUI...`);
    const promptId = await client.queueWorkflow(workflow);

    console.log('\n' + '='.repeat(60));
    console.log('Workflow queued successfully!');
    console.log('='.repeat(60));
    console.log(`\nprompt_id: ${promptId}`);
    console.log(`\nMonitor progress at: ${baseUrl}/history/${promptId}`);
    console.log(`View queue at:       ${baseUrl}/queue`);

    // If --wait flag is set, wait for completion and download
    if (args.wait) {
      const waitStep = queueStep + 1;
      const downloadStep = queueStep + 2;

      console.log(`\n[${waitStep}/${stepCount}] Waiting for workflow completion...`);
      console.log('      This may take several minutes (LTX-2.3 generation is compute-intensive)...\n');

      const result = await client.waitForCompletion(promptId, (pct, msg) => {
        process.stdout.write(`\r      Progress: ${pct}% - ${msg}                    `);
      });

      console.log('\n');

      if (result.status === 'error') {
        console.error('      Workflow failed with error');
        process.exit(1);
      }

      console.log(`      Workflow ${result.status === 'completed' ? 'completed successfully' : 'completed (with timeout warning)'}!`);

      // Download outputs
      console.log(`\n[${downloadStep}/${stepCount}] Downloading generated video(s)...`);
      const outputs = await client.getOutputImages(promptId);

      if (outputs.length === 0) {
        console.log('      No output files found');
      } else {
        for (const output of outputs) {
          const downloadedPath = await client.downloadImage(
            output.filename,
            output.subfolder,
            output.type
          );
          console.log(`      Downloaded: ${downloadedPath}`);
        }
      }

      console.log('\n' + '='.repeat(60));
      console.log('SUCCESS! Video generation complete.');
      console.log('='.repeat(60));
      console.log(`\nOutput directory: ${path.resolve(outputDir)}`);
    } else {
      console.log('\n(Use --wait flag to wait for completion and download the video)');
    }

    console.log('');
  } catch (error) {
    console.error('\nError:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
