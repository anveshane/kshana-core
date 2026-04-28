#!/usr/bin/env tsx
/**
 * Generate preview images for all template styles using ComfyUI Z-Image.
 * Output: frontend/public/previews/<style-id>.png
 *
 * Usage: pnpm tsx scripts/generate-style-previews.ts
 */

import 'dotenv/config';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';
import {
  ComfyUIClient,
  loadWorkflowTemplate,
  parameterizeWorkflowByName,
} from '../src/services/comfyui/index.js';
import { getRegistry } from '../src/services/comfyui/WorkflowRegistry.js';

const OUTPUT_DIR = join(process.cwd(), 'frontend', 'public', 'previews');
if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

// Style prompts — each produces a representative image for that style
const STYLE_PROMPTS: Record<string, string> = {
  // Narrative styles
  cinematic_realism: 'A lone figure stands on a rain-soaked bridge at night, city lights reflecting in wet asphalt, dramatic volumetric lighting from sodium lamps cutting through fog, photorealistic cinematic look, 35mm film grain, anamorphic lens flare',
  anime: 'A young warrior with flowing blue hair stands on a cliff edge overlooking a vast ocean at sunset, cherry blossom petals swirling in the wind, vibrant anime art style, Studio Ghibli inspired, cel shading, dramatic sky with pink and orange clouds',
  stylized_3d: 'A small robot with big expressive eyes sits in a cozy treehouse reading a tiny book, warm golden light streaming through the window, Pixar-style 3D rendering, subsurface scattering on skin, soft depth of field, whimsical and charming',
  watercolor: 'A peaceful village nestled in misty mountains, traditional houses with tiled roofs, a winding stone path through a flower garden, soft watercolor painting style, wet-on-wet technique, delicate color bleeding, paper texture visible',

  // Documentary styles
  cinematic_documentary: 'An elderly craftsman carefully shapes pottery on a wheel in his workshop, dramatic side lighting from a dusty window, shallow depth of field, cinematic documentary photography, rich earth tones, 85mm portrait lens',
  news_style: 'A wide shot of a modern city skyline with construction cranes, clean sharp focus throughout, neutral color grading, informational documentary style, clear sky, morning light, professional news broadcast quality',
  nature_documentary: 'A majestic snow leopard stalks through a Himalayan mountain landscape at dawn, golden hour light illuminating its spotted fur, BBC Planet Earth style, crystal clear telephoto lens, pristine wilderness, mist in the valley below',

  // Short styles
  viral_aesthetic: 'Close-up of vibrant neon-lit food being prepared in slow motion, sauce dripping dramatically, high contrast colors, trendy social media aesthetic, vertical composition, shallow depth of field with bokeh lights, punchy saturation',
  cinematic_short: 'A dancer mid-leap in an urban alley, dramatic backlight creating a silhouette, cinematic film quality in vertical format, moody blue and amber tones, dust particles in the air, 50mm prime lens look',
  lo_fi: 'A cozy desk setup with a vintage lamp, steaming coffee cup, and a cassette player, warm nostalgic lo-fi aesthetic, film photography grain, slightly faded colors, soft focus vignette, retro filter, peaceful night scene through window',
  minimal_clean: 'A single white ceramic cup on a light wooden table, minimal composition, abundant white space, soft natural daylight from the left, clean minimalist style, subtle shadows, focus on simplicity and form',

  // Infomercial styles
  professional_product: 'A sleek smartphone floating at an angle against a gradient background, studio lighting with rim light and key light, professional product photography, reflections on surface, clean white and silver tones, commercial quality',
  lifestyle: 'A person using a laptop at a bright cafe terrace, fresh juice and pastries on the table, natural lifestyle photography, warm morning light, shallow depth of field, authentic and aspirational mood',
  tech_sleek: 'A pair of wireless earbuds on a dark matte surface with subtle blue LED accent lighting, modern tech product style, sharp reflections, dark and moody with selective lighting, premium feel',
  infomercial_classic: 'A happy family gathered around a kitchen counter demonstrating a blender with colorful fruits, bright even studio lighting, warm and energetic classic infomercial style, clean white kitchen, vibrant colors',
};

// Also generate one per template type (hero image)
const TEMPLATE_PROMPTS: Record<string, string> = {
  narrative: 'A dramatic movie still of a lone figure walking toward a glowing doorway in a vast dark landscape, cinematic composition with leading lines, volumetric light rays, epic scale, film production quality',
  documentary: 'A powerful documentary photograph of morning fog lifting over rice terraces with a farmer silhouetted against the sunrise, golden hour, telephoto compression, stunning natural landscape',
  short: 'A dynamic vertical-format social media content frame, a person doing an incredible skateboard trick mid-air, urban backdrop with graffiti, high-energy composition, motion blur, vibrant colors',
  infomercial: 'A beautifully lit product showcase with a premium watch on a marble pedestal, studio lighting creating dramatic shadows, commercial advertising quality, luxury feel, sharp detail',
  graphic_novel: 'A dramatic graphic novel panel showing a masked hero perched on a gargoyle overlooking a noir city at night, rain and neon, comic book ink style with halftone dots, dynamic composition, speech bubble space',
};

async function generateImage(prompt: string, outputPath: string, label: string): Promise<boolean> {
  const registry = getRegistry();
  const workflowMeta = registry.get('zimage');
  if (!workflowMeta) {
    console.error('  ✗ zimage workflow not found');
    return false;
  }

  const client = new ComfyUIClient({ outputDir: OUTPUT_DIR });
  const template = loadWorkflowTemplate(workflowMeta.filename);
  const workflow = parameterizeWorkflowByName('zimage', template, {
    sceneNumber: 0,
    prompt,
    negativePrompt: 'blurry, low quality, distorted, watermark, text, logo, ugly, deformed',
    aspectRatio: '16:9',
    width: 768,
    height: 432,
    seed: Math.floor(Math.random() * 999999),
    filenamePrefix: 'preview',
  });

  console.log(`  ⏳ ${label}...`);
  try {
    const result = await client.queueWorkflow(workflow as Record<string, unknown>, undefined, true);
    await client.waitForCompletionWS(result.promptId, result.clientId, (info) => {
      if (info.percentage > 0 && info.percentage % 25 === 0) {
        process.stdout.write(`  ${info.percentage}% `);
      }
    });
    console.log('');

    const outputs = await client.getOutputImages(result.promptId);
    if (outputs.length === 0) {
      console.error(`  ✗ No output for ${label}`);
      return false;
    }

    const savedPath = await client.downloadImage(
      outputs[0]!.filename,
      outputs[0]!.subfolder,
      outputs[0]!.type,
      `preview_${Date.now()}.png`,
    );
    copyFileSync(savedPath, outputPath);
    console.log(`  ✓ ${label} → ${outputPath}`);
    return true;
  } catch (err) {
    console.error(`  ✗ ${label}: ${err}`);
    return false;
  }
}

async function main() {
  console.log('Generating style preview images...');
  console.log(`Output: ${OUTPUT_DIR}\n`);

  // Generate template hero images
  console.log('=== Template Previews ===');
  for (const [id, prompt] of Object.entries(TEMPLATE_PROMPTS)) {
    const outPath = join(OUTPUT_DIR, `template_${id}.png`);
    if (existsSync(outPath)) {
      console.log(`  ⏭ template_${id} (exists)`);
      continue;
    }
    await generateImage(prompt, outPath, `template: ${id}`);
  }

  // Generate style preview images
  console.log('\n=== Style Previews ===');
  for (const [id, prompt] of Object.entries(STYLE_PROMPTS)) {
    const outPath = join(OUTPUT_DIR, `style_${id}.png`);
    if (existsSync(outPath)) {
      console.log(`  ⏭ style_${id} (exists)`);
      continue;
    }
    await generateImage(prompt, outPath, `style: ${id}`);
  }

  console.log('\nDone!');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
