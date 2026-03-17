/**
 * Test FLUX 2 Klein Edit workflow with 2, 3, and 4 reference images.
 * Run with: npx tsx scripts/test-flux2-klein-edit.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import { parameterizeCustomWorkflow } from '../src/services/comfyui/WorkflowLoader.js';
import { FLUX2_KLEIN_EDIT_MANIFEST } from '../src/services/comfyui/builtinManifests.js';
import { ComfyUIClient } from '../src/services/comfyui/ComfyUIClient.js';

const OUTPUT_DIR = path.join(process.cwd(), 'test-output');
const WORKFLOW_PATH = path.join(process.cwd(), 'workflows', 'flux2_klein_edit.json');

// Reference images from the project
const IMAGES_DIR = path.join(process.cwd(), 'sun_hadnt_yet_cleared.kshana', 'assets', 'images');
const REF_IMAGES = [
  path.join(IMAGES_DIR, 'T2f9DpXD_CharRef_Isha_00001_.png'),       // Character: Isha
  path.join(IMAGES_DIR, '0jZCrE-k_CharRef_Parvati_00001_.png'),    // Character: Parvati
  path.join(IMAGES_DIR, 'i-E3K3C-_SettingRef_MrsSinghsBungalow_00001_.png'), // Setting: Bungalow
  path.join(IMAGES_DIR, 'R56kMY3U_CharRef_MrsSingh_00001_.png'),   // Character: Mrs Singh
];

function loadWorkflow(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf-8'));
}

async function uploadImages(client: ComfyUIClient, imagePaths: string[]): Promise<string[]> {
  const filenames: string[] = [];
  for (const imgPath of imagePaths) {
    const basename = path.basename(imgPath);
    console.log(`  Uploading: ${basename}`);
    const result = await client.uploadImage(imgPath);
    filenames.push(result.name);
    console.log(`    → ${result.name}`);
  }
  return filenames;
}

async function runTest(
  client: ComfyUIClient,
  label: string,
  prompt: string,
  uploadedFilenames: string[],
) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST: ${label} (${uploadedFilenames.length} reference images)`);
  console.log(`${'='.repeat(60)}`);

  const workflow = parameterizeCustomWorkflow(loadWorkflow(), FLUX2_KLEIN_EDIT_MANIFEST, {
    prompt,
    inputImageFilenames: uploadedFilenames,
    filenamePrefix: `test_flux2_klein_${uploadedFilenames.length}ref`,
  });

  // Log key node state
  const nodeCount = Object.keys(workflow).length;
  const guider = (workflow['92:63'] as any)?.inputs;
  console.log(`  Nodes in workflow: ${nodeCount}`);
  console.log(`  CFGGuider positive → ${JSON.stringify(guider?.positive)}`);
  console.log(`  CFGGuider negative → ${JSON.stringify(guider?.negative)}`);
  console.log(`  Prompt: "${prompt.slice(0, 80)}..."`);

  // Verify pruned nodes are gone
  for (let i = uploadedFilenames.length; i < 4; i++) {
    const loadNodeId = ['76', '81', '82', '83'][i];
    if (workflow[loadNodeId!] !== undefined) {
      console.error(`  ERROR: LoadImage node ${loadNodeId} should have been pruned!`);
    }
  }

  // Submit to ComfyUI
  console.log('  Submitting to ComfyUI...');
  try {
    const queueResult = await client.queueWorkflow(workflow, undefined, true);
    console.log(`  Queued! Prompt ID: ${queueResult.promptId}`);

    console.log('  Waiting for completion...');
    const result = await client.waitForCompletionWS(
      queueResult.promptId,
      queueResult.clientId!,
      (info) => {
        if (info.percentage > 0) {
          process.stdout.write(`\r  Progress: ${info.percentage}% - ${info.message}    `);
        }
      },
    );
    console.log(`\n  Status: ${result.status}`);

    const images = await client.getOutputImages(queueResult.promptId);
    if (images.length > 0) {
      const first = images[0]!;
      const savedPath = await client.downloadImage(
        first.filename,
        first.subfolder,
        first.type,
        `test_flux2_klein_${uploadedFilenames.length}ref_${Date.now()}.png`,
      );
      console.log(`  Image saved: ${savedPath}`);
    } else {
      console.log('  No output images found.');
    }
  } catch (err) {
    console.error(`  ERROR: ${err instanceof Error ? err.message : err}`);
  }
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Verify all reference images exist
  for (const img of REF_IMAGES) {
    if (!fs.existsSync(img)) {
      console.error(`Reference image not found: ${img}`);
      process.exit(1);
    }
  }

  const client = new ComfyUIClient({ outputDir: OUTPUT_DIR });

  // Upload all 4 images upfront
  console.log('Uploading reference images...');
  const uploadedFilenames = await uploadImages(client, REF_IMAGES);
  console.log(`Uploaded ${uploadedFilenames.length} images.\n`);

  // Test 1: 2 reference images (Isha + Parvati)
  // image 1 = Isha, image 2 = Parvati
  await runTest(
    client,
    '2 references — two characters together',
    'The young woman from image 1 and the young woman from image 2 are standing side by side in a sunlit garden. They are smiling warmly at the camera, wearing casual summer outfits. Soft natural daylight filters through the trees behind them, casting dappled shadows on the grass. Shallow depth of field with the background softly blurred. Realistic photography, no text, no watermark.',
    uploadedFilenames.slice(0, 2),
  );

  // Test 2: 3 reference images (Isha + Parvati + Bungalow setting)
  // image 1 = Isha, image 2 = Parvati, image 3 = Bungalow
  await runTest(
    client,
    '3 references — two characters in a setting',
    'The young woman from image 1 and the young woman from image 2 are sitting together on the verandah of the colonial bungalow shown in image 3. They are sharing afternoon tea, leaning towards each other in relaxed conversation. Warm golden light filters through ivy-covered pillars, casting long shadows across the wooden floor. Realistic photography, soft diffused daylight, no text, no watermark.',
    uploadedFilenames.slice(0, 3),
  );

  // Test 3: 4 reference images (Isha + Parvati + Bungalow + Mrs Singh)
  // image 1 = Isha, image 2 = Parvati, image 3 = Bungalow, image 4 = Mrs Singh
  await runTest(
    client,
    '4 references — three characters in a setting',
    'The older woman from image 4 is seated in a cushioned armchair inside the living room of the bungalow from image 3. The young woman from image 1 and the young woman from image 2 sit together on a sofa across from her. They are engaged in a warm family conversation. Soft interior lighting from a table lamp casts a golden glow across the room. Realistic photography, no text, no watermark.',
    uploadedFilenames.slice(0, 4),
  );

  console.log('\n\nAll tests complete!');
}

main();
