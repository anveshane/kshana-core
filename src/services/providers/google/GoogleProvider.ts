/**
 * Google AI provider — Nano Banana 2 (images) + Veo 2 (video).
 *
 * Image generation & editing: Uses the Gemini API with gemini-2.0-flash-preview-image-generation
 * model which supports multimodal input (text + images) and outputs images.
 *
 * Video generation: Uses the Veo 2 API (async operation — submit, poll, download).
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

export class GoogleProvider implements GenerationProvider {
  readonly id = 'google';
  readonly displayName = 'Google AI (Gemini)';
  readonly capabilities: GenerationCapability[] = [
    'image_generation',
    'image_editing',
    'video_generation',
  ];

  private get apiKey(): string | undefined {
    return process.env['GOOGLE_AI_API_KEY'];
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async generateImage(
    input: ImageGenerationInput,
    onProgress?: ProviderProgressCallback,
  ): Promise<GenerationResult> {
    const apiKey = this.apiKey;
    if (!apiKey) throw new Error('GOOGLE_AI_API_KEY not set');

    onProgress?.({ percentage: 10, message: 'Sending to Google AI...', done: false });

    // Build multimodal content parts
    const parts: Array<Record<string, unknown>> = [];

    // Add reference images if provided (up to 14 supported by Gemini)
    if (input.referenceImages) {
      for (const ref of input.referenceImages.slice(0, 14)) {
        if (fs.existsSync(ref.filePath)) {
          const imageData = fs.readFileSync(ref.filePath);
          const base64 = imageData.toString('base64');
          const mimeType = ref.filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
          parts.push({
            inlineData: { mimeType, data: base64 },
          });
          parts.push({
            text: `This is a ${ref.type} reference image for "${ref.name}".`,
          });
        }
      }
    }

    // Add the text prompt
    parts.push({ text: input.prompt });

    const requestBody = {
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    };

    const model = 'gemini-2.0-flash-preview-image-generation';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    onProgress?.({ percentage: 30, message: 'Generating image...', done: false });

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google AI API error (${response.status}): ${errorText}`);
    }

    const result = await response.json() as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            inlineData?: { mimeType: string; data: string };
            text?: string;
          }>;
        };
      }>;
    };

    onProgress?.({ percentage: 80, message: 'Saving image...', done: false });

    // Extract the image from the response
    const candidate = result.candidates?.[0];
    const imagePart = candidate?.content?.parts?.find(
      (p) => p.inlineData?.mimeType?.startsWith('image/'),
    );

    if (!imagePart?.inlineData) {
      throw new Error('No image in Google AI response');
    }

    // Save to file
    const ext = imagePart.inlineData.mimeType === 'image/png' ? '.png' : '.jpg';
    const filename = `${input.filenamePrefix || 'google'}_${nanoid(8)}${ext}`;
    const outputPath = path.join(input.outputDir, filename);

    if (!fs.existsSync(input.outputDir)) {
      fs.mkdirSync(input.outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, Buffer.from(imagePart.inlineData.data, 'base64'));

    onProgress?.({ percentage: 100, message: 'Complete', done: true });

    return {
      filePath: outputPath,
      mimeType: imagePart.inlineData.mimeType,
      metadata: { provider: 'google', model },
    };
  }

  async editImage(
    input: ImageEditInput,
    onProgress?: ProviderProgressCallback,
  ): Promise<GenerationResult> {
    const apiKey = this.apiKey;
    if (!apiKey) throw new Error('GOOGLE_AI_API_KEY not set');

    onProgress?.({ percentage: 10, message: 'Sending to Google AI for editing...', done: false });

    // Build parts: base image + reference images + edit prompt
    const parts: Array<Record<string, unknown>> = [];

    // Add base image
    const baseImageData = fs.readFileSync(input.baseImagePath);
    const baseMime = input.baseImagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
    parts.push({
      inlineData: { mimeType: baseMime, data: baseImageData.toString('base64') },
    });
    parts.push({ text: 'This is the base image to edit.' });

    // Add reference images
    if (input.referenceImages) {
      for (const refPath of input.referenceImages.slice(0, 2)) {
        if (fs.existsSync(refPath)) {
          const refData = fs.readFileSync(refPath);
          const refMime = refPath.endsWith('.png') ? 'image/png' : 'image/jpeg';
          parts.push({
            inlineData: { mimeType: refMime, data: refData.toString('base64') },
          });
        }
      }
    }

    // Add edit prompt
    parts.push({ text: input.editPrompt });

    const requestBody = {
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    };

    const model = 'gemini-2.0-flash-preview-image-generation';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    onProgress?.({ percentage: 30, message: 'Editing image...', done: false });

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google AI API error (${response.status}): ${errorText}`);
    }

    const result = await response.json() as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            inlineData?: { mimeType: string; data: string };
          }>;
        };
      }>;
    };

    onProgress?.({ percentage: 80, message: 'Saving edited image...', done: false });

    const candidate = result.candidates?.[0];
    const imagePart = candidate?.content?.parts?.find(
      (p) => p.inlineData?.mimeType?.startsWith('image/'),
    );

    if (!imagePart?.inlineData) {
      throw new Error('No image in Google AI edit response');
    }

    const ext = imagePart.inlineData.mimeType === 'image/png' ? '.png' : '.jpg';
    const filename = `${input.filenamePrefix || 'google_edit'}_${nanoid(8)}${ext}`;
    const outputPath = path.join(input.outputDir, filename);

    if (!fs.existsSync(input.outputDir)) {
      fs.mkdirSync(input.outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, Buffer.from(imagePart.inlineData.data, 'base64'));

    onProgress?.({ percentage: 100, message: 'Complete', done: true });

    return {
      filePath: outputPath,
      mimeType: imagePart.inlineData.mimeType,
      metadata: { provider: 'google', model },
    };
  }

  async generateVideo(
    input: VideoGenerationInput,
    onProgress?: ProviderProgressCallback,
  ): Promise<GenerationResult> {
    const apiKey = this.apiKey;
    if (!apiKey) throw new Error('GOOGLE_AI_API_KEY not set');

    onProgress?.({ percentage: 5, message: 'Uploading image to Google AI...', done: false });

    // Step 1: Upload the source image to get a file URI
    const imageData = fs.readFileSync(input.sourceImagePath);
    const imageMime = input.sourceImagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

    // Upload via resumable upload API
    const uploadInitUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`;
    const uploadInitResponse = await fetch(uploadInitUrl, {
      method: 'POST',
      headers: {
        'Content-Type': imageMime,
        'X-Goog-Upload-Protocol': 'raw',
        'X-Goog-Upload-Command': 'upload, finalize',
      },
      body: imageData,
    });

    if (!uploadInitResponse.ok) {
      const errorText = await uploadInitResponse.text();
      throw new Error(`Google AI file upload failed (${uploadInitResponse.status}): ${errorText}`);
    }

    const uploadResult = await uploadInitResponse.json() as {
      file?: { uri: string; name: string };
    };
    const fileUri = uploadResult.file?.uri;
    if (!fileUri) {
      throw new Error('No file URI in upload response');
    }

    onProgress?.({ percentage: 15, message: 'Submitting video generation...', done: false });

    // Step 2: Submit video generation request
    const model = 'veo-2.0-generate-001';
    const generateUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning?key=${apiKey}`;

    const generateBody = {
      instances: [{
        prompt: input.prompt,
        image: { gcsUri: fileUri },
      }],
      parameters: {
        aspectRatio: input.width && input.height
          ? (input.width > input.height ? '16:9' : input.width < input.height ? '9:16' : '1:1')
          : '16:9',
        durationSeconds: input.durationSeconds ?? 8,
      },
    };

    const generateResponse = await fetch(generateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(generateBody),
    });

    if (!generateResponse.ok) {
      const errorText = await generateResponse.text();
      throw new Error(`Google AI Veo API error (${generateResponse.status}): ${errorText}`);
    }

    const operation = await generateResponse.json() as {
      name: string;
      done?: boolean;
    };

    onProgress?.({ percentage: 25, message: 'Video generation in progress...', done: false });

    // Step 3: Poll for completion
    const pollUrl = `https://generativelanguage.googleapis.com/v1beta/${operation.name}?key=${apiKey}`;
    const maxPollTime = 600_000; // 10 minutes
    const pollInterval = 10_000; // 10 seconds
    const startTime = Date.now();

    let videoResult: { videoUri?: string; videoData?: string } | undefined;

    while (Date.now() - startTime < maxPollTime) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));

      const elapsed = Date.now() - startTime;
      const progress = Math.min(90, 25 + (elapsed / maxPollTime) * 65);
      onProgress?.({ percentage: progress, message: 'Generating video...', done: false });

      const pollResponse = await fetch(pollUrl);
      if (!pollResponse.ok) continue;

      const pollResult = await pollResponse.json() as {
        done?: boolean;
        response?: {
          predictions?: Array<{
            videoUri?: string;
            bytesBase64Encoded?: string;
          }>;
        };
      };

      if (pollResult.done) {
        const prediction = pollResult.response?.predictions?.[0];
        videoResult = {
          videoUri: prediction?.videoUri,
          videoData: prediction?.bytesBase64Encoded,
        };
        break;
      }
    }

    if (!videoResult) {
      throw new Error('Video generation timed out');
    }

    onProgress?.({ percentage: 95, message: 'Downloading video...', done: false });

    // Step 4: Download the video
    const filename = `${input.filenamePrefix || 'veo'}_${nanoid(8)}.mp4`;
    const outputPath = path.join(input.outputDir, filename);

    if (!fs.existsSync(input.outputDir)) {
      fs.mkdirSync(input.outputDir, { recursive: true });
    }

    if (videoResult.videoData) {
      // Video returned inline as base64
      fs.writeFileSync(outputPath, Buffer.from(videoResult.videoData, 'base64'));
    } else if (videoResult.videoUri) {
      // Download from URI
      const videoResponse = await fetch(videoResult.videoUri);
      if (!videoResponse.ok) {
        throw new Error(`Failed to download video from ${videoResult.videoUri}`);
      }
      const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
      fs.writeFileSync(outputPath, videoBuffer);
    } else {
      throw new Error('No video data in Veo response');
    }

    onProgress?.({ percentage: 100, message: 'Complete', done: true });

    return {
      filePath: outputPath,
      mimeType: 'video/mp4',
      metadata: { provider: 'google', model },
    };
  }
}
