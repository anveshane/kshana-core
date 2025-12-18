#!/usr/bin/env tsx
/**
 * Test script for ComfyUI WAN 2.2 workflows.
 *
 * Supports two modes:
 * 1. Single image (wan-singleimage.json) - Image to video generation
 * 2. Start-end images (wan start-end.json) - Interpolation between two images
 *
 * Usage:
 *   # Single image mode
 *   tsx scripts/test-wan-workflow.ts --image <path> --prompt <text> [options]
 *
 *   # Start-end mode (requires --end-image)
 *   tsx scripts/test-wan-workflow.ts --image <start> --end-image <end> --prompt <text> [options]
 *
 * Options:
 *   --image <path>       Start/single image file path (required)
 *   --end-image <path>   End image file path (enables start-end mode)
 *   --prompt <text>      Motion/video prompt (required)
 *   --negative <text>    Negative prompt (optional)
 *   --seed <number>      Random seed (optional, defaults to random)
 *   --url <url>          ComfyUI base URL (optional, defaults to COMFYUI_BASE_URL env or http://localhost:8188)
 *   --wait               Wait for completion and download the video (optional)
 *   --output <path>      Output directory for downloaded video (optional, defaults to ./outputs)
 *
 * Examples:
 *   # Single image to video (queue only)
 *   tsx scripts/test-wan-workflow.ts --image ./scene.png --prompt "camera slowly pans across the scene"
 *
 *   # Single image to video (wait and download)
 *   tsx scripts/test-wan-workflow.ts --image ./scene.png --prompt "camera slowly pans" --wait
 *
 *   # Start to end interpolation with download
 *   tsx scripts/test-wan-workflow.ts --image ./start.png --end-image ./end.png --prompt "smooth transition" --wait --output ./videos
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { ComfyUIClient } from '../src/services/comfyui/ComfyUIClient';
import { loadWorkflowTemplate, parameterizeWanWorkflow, parameterizeWanStartEndWorkflow } from '../src/services/comfyui/WorkflowLoader';

interface Args {
  image: string;
  endImage?: string;
  prompt: string;
  negative?: string;
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
      case '--image':
        result.image = next;
        i++;
        break;
      case '--end-image':
        result.endImage = next;
        i++;
        break;
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
  if (!result.image) {
    console.error('Error: --image is required');
    printUsage();
    process.exit(1);
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
Usage: tsx scripts/test-wan-workflow.ts --image <path> --prompt <text> [options]

Modes:
  Single image:    Provide --image only for image-to-video generation
  Start-end:       Provide both --image and --end-image for interpolation

Options:
  --image <path>       Start/single image file path (required)
  --end-image <path>   End image file path (enables start-end mode)
  --prompt <text>      Motion/video prompt describing desired motion (required)
  --negative <text>    Negative prompt (optional)
  --seed <number>      Random seed for reproducibility (optional)
  --url <url>          ComfyUI base URL (optional, defaults to COMFYUI_BASE_URL env or http://localhost:8188)
  --wait               Wait for completion and download the generated video
  --output <path>      Output directory for downloaded video (default: ./outputs)
  --help, -h           Show this help message

Examples:
  # Single image to video (queue only)
  tsx scripts/test-wan-workflow.ts --image ./scene.png --prompt "camera slowly pans across the scene"

  # Single image to video (wait and download)
  tsx scripts/test-wan-workflow.ts --image ./scene.png --prompt "camera slowly pans" --wait

  # Start to end interpolation with custom output directory
  tsx scripts/test-wan-workflow.ts --image ./start.png --end-image ./end.png --prompt "smooth transition" --wait --output ./videos
`);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const isStartEndMode = !!args.endImage;

  // Resolve image paths
  const startImagePath = path.resolve(args.image);
  if (!fs.existsSync(startImagePath)) {
    console.error(`Error: Start image file not found: ${startImagePath}`);
    process.exit(1);
  }

  let endImagePath: string | undefined;
  if (isStartEndMode) {
    endImagePath = path.resolve(args.endImage!);
    if (!fs.existsSync(endImagePath)) {
      console.error(`Error: End image file not found: ${endImagePath}`);
      process.exit(1);
    }
  }

  console.log('='.repeat(60));
  console.log(`ComfyUI WAN 2.2 ${isStartEndMode ? 'Start-End' : 'Single Image'} Workflow Test`);
  console.log('='.repeat(60));
  console.log(`Mode:     ${isStartEndMode ? 'Start-End Interpolation' : 'Single Image to Video'}`);
  console.log(`Start:    ${startImagePath}`);
  if (endImagePath) console.log(`End:      ${endImagePath}`);
  console.log(`Prompt:   ${args.prompt}`);
  if (args.negative) console.log(`Negative: ${args.negative}`);
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
  });

  try {
    // Calculate step count
    const baseSteps = isStartEndMode ? 4 : 3;
    const stepCount = args.wait ? baseSteps + 2 : baseSteps; // +2 for wait and download

    // Step 1: Upload image(s)
    console.log(`\n[1/${stepCount}] Uploading start image: ${path.basename(startImagePath)}`);
    const startUploadResult = await client.uploadImage(startImagePath);
    console.log(`      Uploaded as: ${startUploadResult.name} (subfolder: ${startUploadResult.subfolder || 'root'}, type: ${startUploadResult.type})`);

    let endUploadResult: { name: string; subfolder: string; type: string } | undefined;
    if (isStartEndMode && endImagePath) {
      console.log(`\n[2/${stepCount}] Uploading end image: ${path.basename(endImagePath)}`);
      endUploadResult = await client.uploadImage(endImagePath);
      console.log(`      Uploaded as: ${endUploadResult.name} (subfolder: ${endUploadResult.subfolder || 'root'}, type: ${endUploadResult.type})`);
    }

    // Step 2/3: Load and parameterize workflow
    const loadStep = isStartEndMode ? 3 : 2;
    const queueStep = isStartEndMode ? 4 : 3;

    let workflow: Record<string, unknown>;

    if (isStartEndMode) {
      console.log(`\n[${loadStep}/${stepCount}] Loading workflow template: wan start-end.json`);
      const template = loadWorkflowTemplate('wan start-end.json');

      console.log('      Parameterizing workflow...');
      workflow = parameterizeWanStartEndWorkflow(template, {
        prompt: args.prompt,
        negativePrompt: args.negative,
        seed: args.seed,
        startImageFilename: startUploadResult.name,
        endImageFilename: endUploadResult!.name,
        filenamePrefix: 'WanStartEnd',
      });
    } else {
      console.log(`\n[${loadStep}/${stepCount}] Loading workflow template: wan-singleimage.json`);
      const template = loadWorkflowTemplate('wan-singleimage.json');

      console.log('      Parameterizing workflow...');
      workflow = parameterizeWanWorkflow(template, {
        prompt: args.prompt,
        negativePrompt: args.negative,
        seed: args.seed,
        inputImageFilename: startUploadResult.name,
        filenamePrefix: 'WanTest',
      });
    }

    // Step 3/4: Queue workflow
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
      console.log('      This may take several minutes depending on the workflow...\n');

      const result = await client.waitForCompletion(promptId, (pct, msg) => {
        process.stdout.write(`\r      Progress: ${pct}% - ${msg}                    `);
      });

      console.log('\n');

      if (result.status === 'error') {
        console.error('      Workflow failed with error');
        process.exit(1);
      }

      console.log(`      Workflow ${result.status === 'completed' ? 'completed successfully' : 'completed (with timeout warning)'}!`);

      // Step: Download outputs
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
