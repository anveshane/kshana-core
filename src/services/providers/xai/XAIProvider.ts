/**
 * xAI provider — Aurora (images) + Grok Imagine (video).
 *
 * Image generation: Aurora model via POST https://api.x.ai/v1/images/generations
 * Image editing: Aurora supports multimodal editing with image input
 * Video generation: Grok Imagine 1.0 for short video generation
 */
import * as fs from 'fs';
import * as path from 'path';
import { nanoid } from 'nanoid';
import type {
  GenerationProvider,
  GenerationCapability,
  GenerationResult,
  ImageGenerationInput,
  ImageEditInput,
  VideoGenerationInput,
  ProviderProgressCallback,
} from '../types.js';

export class XAIProvider implements GenerationProvider {
  readonly id = 'xai';
  readonly displayName = 'xAI (Aurora / Grok)';
  readonly capabilities: GenerationCapability[] = [
    'image_generation',
    'image_editing',
    'video_generation',
  ];

  private get apiKey(): string | undefined {
    return process.env['XAI_API_KEY'];
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async generateImage(
    input: ImageGenerationInput,
    onProgress?: ProviderProgressCallback,
  ): Promise<GenerationResult> {
    const apiKey = this.apiKey;
    if (!apiKey) throw new Error('XAI_API_KEY not set');

    onProgress?.({ percentage: 10, message: 'Sending to xAI Aurora...', done: false });

    const requestBody: Record<string, unknown> = {
      model: 'aurora',
      prompt: input.prompt,
      n: 1,
      response_format: 'b64_json',
    };

    // Add negative prompt if provided
    if (input.negativePrompt) {
      requestBody['negative_prompt'] = input.negativePrompt;
    }

    const url = 'https://api.x.ai/v1/images/generations';

    onProgress?.({ percentage: 30, message: 'Generating image with Aurora...', done: false });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`xAI API error (${response.status}): ${errorText}`);
    }

    const result = await response.json() as {
      data?: Array<{
        b64_json?: string;
        url?: string;
      }>;
    };

    onProgress?.({ percentage: 80, message: 'Saving image...', done: false });

    const imageData = result.data?.[0];
    if (!imageData) {
      throw new Error('No image data in xAI response');
    }

    const filename = `${input.filenamePrefix || 'aurora'}_${nanoid(8)}.png`;
    const outputPath = path.join(input.outputDir, filename);

    if (!fs.existsSync(input.outputDir)) {
      fs.mkdirSync(input.outputDir, { recursive: true });
    }

    if (imageData.b64_json) {
      fs.writeFileSync(outputPath, Buffer.from(imageData.b64_json, 'base64'));
    } else if (imageData.url) {
      // Download from URL
      const imgResponse = await fetch(imageData.url);
      if (!imgResponse.ok) {
        throw new Error(`Failed to download image from xAI`);
      }
      const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
      fs.writeFileSync(outputPath, imgBuffer);
    } else {
      throw new Error('No image content in xAI response');
    }

    onProgress?.({ percentage: 100, message: 'Complete', done: true });

    return {
      filePath: outputPath,
      mimeType: 'image/png',
      metadata: { provider: 'xai', model: 'aurora' },
    };
  }

  async editImage(
    input: ImageEditInput,
    onProgress?: ProviderProgressCallback,
  ): Promise<GenerationResult> {
    const apiKey = this.apiKey;
    if (!apiKey) throw new Error('XAI_API_KEY not set');

    onProgress?.({ percentage: 10, message: 'Sending to xAI Aurora for editing...', done: false });

    // Aurora supports image editing via the chat completions endpoint with vision
    const imageData = fs.readFileSync(input.baseImagePath);
    const base64Image = imageData.toString('base64');
    const imageMime = input.baseImagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

    // Build content parts
    const contentParts: Array<Record<string, unknown>> = [
      {
        type: 'image_url',
        image_url: {
          url: `data:${imageMime};base64,${base64Image}`,
        },
      },
    ];

    // Add reference images
    if (input.referenceImages) {
      for (const refPath of input.referenceImages.slice(0, 2)) {
        if (fs.existsSync(refPath)) {
          const refData = fs.readFileSync(refPath);
          const refMime = refPath.endsWith('.png') ? 'image/png' : 'image/jpeg';
          contentParts.push({
            type: 'image_url',
            image_url: {
              url: `data:${refMime};base64,${refData.toString('base64')}`,
            },
          });
        }
      }
    }

    contentParts.push({
      type: 'text',
      text: input.editPrompt,
    });

    const requestBody = {
      model: 'aurora',
      prompt: input.editPrompt,
      image: {
        type: 'base64',
        media_type: imageMime,
        data: base64Image,
      },
      n: 1,
      response_format: 'b64_json',
    };

    const url = 'https://api.x.ai/v1/images/edits';

    onProgress?.({ percentage: 30, message: 'Editing image with Aurora...', done: false });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`xAI edit API error (${response.status}): ${errorText}`);
    }

    const result = await response.json() as {
      data?: Array<{
        b64_json?: string;
        url?: string;
      }>;
    };

    onProgress?.({ percentage: 80, message: 'Saving edited image...', done: false });

    const editedImage = result.data?.[0];
    if (!editedImage) {
      throw new Error('No image data in xAI edit response');
    }

    const filename = `${input.filenamePrefix || 'aurora_edit'}_${nanoid(8)}.png`;
    const outputPath = path.join(input.outputDir, filename);

    if (!fs.existsSync(input.outputDir)) {
      fs.mkdirSync(input.outputDir, { recursive: true });
    }

    if (editedImage.b64_json) {
      fs.writeFileSync(outputPath, Buffer.from(editedImage.b64_json, 'base64'));
    } else if (editedImage.url) {
      const imgResponse = await fetch(editedImage.url);
      if (!imgResponse.ok) {
        throw new Error('Failed to download edited image from xAI');
      }
      const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
      fs.writeFileSync(outputPath, imgBuffer);
    } else {
      throw new Error('No image content in xAI edit response');
    }

    onProgress?.({ percentage: 100, message: 'Complete', done: true });

    return {
      filePath: outputPath,
      mimeType: 'image/png',
      metadata: { provider: 'xai', model: 'aurora' },
    };
  }

  async generateVideo(
    input: VideoGenerationInput,
    onProgress?: ProviderProgressCallback,
  ): Promise<GenerationResult> {
    const apiKey = this.apiKey;
    if (!apiKey) throw new Error('XAI_API_KEY not set');

    onProgress?.({ percentage: 5, message: 'Sending to xAI Grok Imagine...', done: false });

    // Read and encode source image
    const imageData = fs.readFileSync(input.sourceImagePath);
    const base64Image = imageData.toString('base64');
    const imageMime = input.sourceImagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

    const requestBody = {
      model: 'grok-imagine-1.0',
      prompt: input.prompt,
      image: {
        type: 'base64',
        media_type: imageMime,
        data: base64Image,
      },
      duration: input.durationSeconds ?? 8,
      response_format: 'b64_json',
    };

    const url = 'https://api.x.ai/v1/videos/generations';

    onProgress?.({ percentage: 15, message: 'Video generation submitted...', done: false });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`xAI video API error (${response.status}): ${errorText}`);
    }

    // Check if it's an async operation (returns operation ID to poll)
    const result = await response.json() as {
      id?: string;
      status?: string;
      data?: Array<{
        b64_json?: string;
        url?: string;
      }>;
    };

    let videoData: { b64_json?: string; url?: string } | undefined;

    if (result.data?.[0]) {
      // Synchronous response
      videoData = result.data[0];
    } else if (result.id) {
      // Async operation — poll for completion
      const pollUrl = `https://api.x.ai/v1/videos/generations/${result.id}`;
      const maxPollTime = 600_000; // 10 minutes
      const pollInterval = 10_000;
      const startTime = Date.now();

      while (Date.now() - startTime < maxPollTime) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));

        const elapsed = Date.now() - startTime;
        const progress = Math.min(90, 20 + (elapsed / maxPollTime) * 70);
        onProgress?.({ percentage: progress, message: 'Generating video...', done: false });

        const pollResponse = await fetch(pollUrl, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
        });

        if (!pollResponse.ok) continue;

        const pollResult = await pollResponse.json() as {
          status?: string;
          data?: Array<{ b64_json?: string; url?: string }>;
        };

        if (pollResult.status === 'completed' && pollResult.data?.[0]) {
          videoData = pollResult.data[0];
          break;
        } else if (pollResult.status === 'failed') {
          throw new Error('xAI video generation failed');
        }
      }
    }

    if (!videoData) {
      throw new Error('Video generation timed out or no data returned');
    }

    onProgress?.({ percentage: 95, message: 'Saving video...', done: false });

    const filename = `${input.filenamePrefix || 'grok'}_${nanoid(8)}.mp4`;
    const outputPath = path.join(input.outputDir, filename);

    if (!fs.existsSync(input.outputDir)) {
      fs.mkdirSync(input.outputDir, { recursive: true });
    }

    if (videoData.b64_json) {
      fs.writeFileSync(outputPath, Buffer.from(videoData.b64_json, 'base64'));
    } else if (videoData.url) {
      const videoResponse = await fetch(videoData.url);
      if (!videoResponse.ok) {
        throw new Error('Failed to download video from xAI');
      }
      const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
      fs.writeFileSync(outputPath, videoBuffer);
    } else {
      throw new Error('No video content in xAI response');
    }

    onProgress?.({ percentage: 100, message: 'Complete', done: true });

    return {
      filePath: outputPath,
      mimeType: 'video/mp4',
      metadata: { provider: 'xai', model: 'grok-imagine-1.0' },
    };
  }
}
