/**
 * Test the full provider path: ComfyUIProvider.generateImage() with manifest-based parameterization.
 * Run with: npx tsx scripts/test-provider-path.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import { ComfyUIProvider } from '../src/services/providers/comfyui/ComfyUIProvider.js';

const OUTPUT_DIR = path.join(process.cwd(), 'test-output');

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const provider = new ComfyUIProvider();
  console.log(`Provider: ${provider.displayName}`);
  console.log(`Available: ${provider.isAvailable()}`);

  console.log('\n--- Generating image via provider (manifest path) ---');

  try {
    const result = await provider.generateImage(
      {
        prompt: 'A serene Japanese garden with a small bridge over a koi pond, cherry blossoms falling, soft morning light',
        negativePrompt: 'blurry, ugly, bad quality',
        aspectRatio: '16:9',
        seed: 123,
        outputDir: OUTPUT_DIR,
        filenamePrefix: 'test_provider',
      },
      (info) => {
        if (info.percentage > 0) {
          process.stdout.write(`\r  Progress: ${info.percentage}% - ${info.message}`);
        }
      },
    );

    console.log(`\n\nImage saved to: ${result.filePath}`);
    console.log(`MIME type: ${result.mimeType}`);
    console.log('Metadata:', result.metadata);
  } catch (err) {
    console.error('\nError:', err instanceof Error ? err.message : err);
    if (err instanceof Error) console.error(err.stack);
  }
}

main();
