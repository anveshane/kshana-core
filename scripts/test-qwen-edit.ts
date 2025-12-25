#!/usr/bin/env tsx
/**
 * Test script for ComfyUI Qwen Edit workflow.
 *
 * Tests the qwen_edit workflow with 1-3 reference images.
 *
 * Usage:
 *   tsx scripts/test-qwen-edit.ts --image1 <path> --prompt <text> [options]
 *
 * Options:
 *   --image1 <path>      Primary/base image (required)
 *   --image2 <path>      Second reference image (optional)
 *   --image3 <path>      Third reference image (optional)
 *   --prompt <text>      Edit prompt (required)
 *   --negative <text>    Negative prompt (optional)
 *   --seed <number>      Random seed (optional)
 *   --wait               Wait for completion and download
 *   --output <path>      Output directory (default: ./outputs)
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { ComfyUIClient } from '../src/services/comfyui/ComfyUIClient';
import { loadWorkflowTemplate, parameterizeQwenEditWorkflow } from '../src/services/comfyui/WorkflowLoader';

interface Args {
  image1: string;
  image2?: string;
  image3?: string;
  prompt: string;
  negative?: string;
  seed?: number;
  wait?: boolean;
  output?: string;
  lightning?: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const result: Partial<Args> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--image1':
        result.image1 = next;
        i++;
        break;
      case '--image2':
        result.image2 = next;
        i++;
        break;
      case '--image3':
        result.image3 = next;
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
      case '--wait':
        result.wait = true;
        break;
      case '--output':
        result.output = next;
        i++;
        break;
      case '--lightning':
        result.lightning = true;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
    }
  }

  if (!result.image1) {
    console.error('Error: --image1 is required');
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
Usage: tsx scripts/test-qwen-edit.ts --image1 <path> --prompt <text> [options]

Options:
  --image1 <path>      Primary/base image to edit (required)
  --image2 <path>      Second reference image (optional)
  --image3 <path>      Third reference image (optional)
  --prompt <text>      Edit prompt describing the transformation (required)
  --negative <text>    Negative prompt (optional)
  --seed <number>      Random seed for reproducibility (optional)
  --wait               Wait for completion and download the generated image
  --output <path>      Output directory (default: ./outputs)
  --lightning          Use Lightning LoRA for faster generation (4 steps instead of 20)
  --help, -h           Show this help message

Examples:
  # Single image edit
  tsx scripts/test-qwen-edit.ts --image1 ./base.png --prompt "change the background to a forest"

  # With character reference
  tsx scripts/test-qwen-edit.ts --image1 ./setting.png --image2 ./character.png --prompt "add the character from image2 into the scene"

  # With multiple references and wait
  tsx scripts/test-qwen-edit.ts --image1 ./base.png --image2 ./char.png --image3 ./style.png --prompt "combine elements" --wait
`);
}

async function main(): Promise<void> {
  const args = parseArgs();

  // Collect all images
  const images: string[] = [];

  const image1Path = path.resolve(args.image1);
  if (!fs.existsSync(image1Path)) {
    console.error(`Error: Image 1 not found: ${image1Path}`);
    process.exit(1);
  }
  images.push(image1Path);

  if (args.image2) {
    const image2Path = path.resolve(args.image2);
    if (!fs.existsSync(image2Path)) {
      console.error(`Error: Image 2 not found: ${image2Path}`);
      process.exit(1);
    }
    images.push(image2Path);
  }

  if (args.image3) {
    const image3Path = path.resolve(args.image3);
    if (!fs.existsSync(image3Path)) {
      console.error(`Error: Image 3 not found: ${image3Path}`);
      process.exit(1);
    }
    images.push(image3Path);
  }

  console.log('='.repeat(60));
  console.log('ComfyUI Qwen Edit Workflow Test');
  console.log('='.repeat(60));
  console.log(`Images:   ${images.length} image(s)`);
  images.forEach((img, i) => console.log(`  ${i + 1}. ${img}`));
  console.log(`Prompt:   ${args.prompt}`);
  if (args.negative) console.log(`Negative: ${args.negative}`);
  if (args.seed) console.log(`Seed:     ${args.seed}`);
  console.log(`Lightning: ${args.lightning ? 'Yes (4 steps)' : 'No (20 steps)'}`);
  console.log(`Wait:     ${args.wait ? 'Yes' : 'No'}`);
  console.log('='.repeat(60));

  // Create ComfyUI client
  const baseUrl = process.env['COMFYUI_BASE_URL'] || 'http://localhost:8188';
  const outputDir = args.output || './outputs';
  console.log(`\nConnecting to ComfyUI at: ${baseUrl}`);

  const client = new ComfyUIClient({
    baseUrl,
    outputDir,
  });

  try {
    const stepCount = args.wait ? 4 : 2;

    // Step 1: Upload images
    console.log(`\n[1/${stepCount}] Uploading ${images.length} image(s)...`);
    const uploadedNames: string[] = [];

    for (let i = 0; i < images.length; i++) {
      const imgPath = images[i];
      console.log(`  Uploading image ${i + 1}: ${path.basename(imgPath)}`);
      const result = await client.uploadImage(imgPath);
      uploadedNames.push(result.name);
      console.log(`    -> Uploaded as: ${result.name}`);
    }

    // Step 2: Load and parameterize workflow
    const workflowFile = args.lightning ? 'qwen_edit-lightning.json' : 'qwen_edit-simple.json';
    console.log(`\n[2/${stepCount}] Loading and parameterizing ${workflowFile}...`);
    const template = loadWorkflowTemplate(workflowFile);

    // First image is primary, rest are additional references
    const [primaryImage, ...additionalImages] = uploadedNames;

    const workflow = parameterizeQwenEditWorkflow(template, {
      prompt: args.prompt,
      negativePrompt: args.negative,
      seed: args.seed,
      filenamePrefix: 'QwenEditTest',
      inputImageFilename: primaryImage,
      referenceImageFilenames: additionalImages.length > 0 ? additionalImages : undefined,
    });

    // Step 3: Queue workflow
    console.log(`\n[3/${stepCount}] Queueing workflow to ComfyUI...`);
    const promptId = await client.queueWorkflow(workflow as Record<string, unknown>);

    console.log('\n' + '='.repeat(60));
    console.log('Workflow queued successfully!');
    console.log('='.repeat(60));
    console.log(`\nprompt_id: ${promptId}`);
    console.log(`\nMonitor progress at: ${baseUrl}/history/${promptId}`);

    if (args.wait) {
      console.log(`\n[4/${stepCount}] Waiting for completion...`);

      const result = await client.waitForCompletion(promptId, (pct, msg) => {
        process.stdout.write(`\r  Progress: ${pct}% - ${msg}                    `);
      });

      console.log('\n');

      if (result.status === 'error') {
        console.error('  Workflow failed with error');
        process.exit(1);
      }

      console.log(`  Workflow completed!`);

      // Download outputs
      const outputs = await client.getOutputImages(promptId);

      if (outputs.length === 0) {
        console.log('  No output files found');
      } else {
        for (const output of outputs) {
          const downloadedPath = await client.downloadImage(
            output.filename,
            output.subfolder,
            output.type
          );
          console.log(`  Downloaded: ${downloadedPath}`);
        }
      }

      console.log('\n' + '='.repeat(60));
      console.log('SUCCESS! Image generation complete.');
      console.log('='.repeat(60));
      console.log(`\nOutput directory: ${path.resolve(outputDir)}`);
    }

    console.log('');
  } catch (error) {
    console.error('\nError:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
