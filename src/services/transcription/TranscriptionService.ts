/**
 * Audio transcription service using Google Gemini.
 * Extracts speech-to-text with timestamps from audio files.
 */

import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import type { ScriptSegment, TimeRange } from '../../tasks/video-edit/workflow/types.js';

/**
 * Transcription result from Gemini.
 */
export interface TranscriptionResult {
  success: boolean;
  text?: string;
  segments?: ScriptSegment[];
  durationMs?: number;
  language?: string;
  error?: string;
}

/**
 * Options for transcription.
 */
export interface TranscriptionOptions {
  language?: string; // Hint for expected language
  includeTimestamps?: boolean; // Default: true
  segmentByPause?: boolean; // Segment by natural pauses
  maxSegmentDurationMs?: number; // Max segment length (default: 30000ms)
}

/**
 * MIME types for audio formats.
 */
const AUDIO_MIME_TYPES: Record<string, string> = {
  '.mp3': 'audio/mp3',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
};

/**
 * TranscriptionService - Transcribes audio using Google Gemini API.
 *
 * Gemini supports audio file analysis and can extract both transcription
 * and timestamps from audio content.
 */
export class TranscriptionService {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(options?: { apiKey?: string; model?: string }) {
    this.apiKey = options?.apiKey ?? process.env['GOOGLE_API_KEY'] ?? '';
    this.model = options?.model ?? 'gemini-2.0-flash';
    this.baseUrl = 'https://generativelanguage.googleapis.com';
  }

  /**
   * Check if the service is configured with API key.
   */
  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * Transcribe an audio file and return segments with timestamps.
   */
  async transcribe(
    audioPath: string,
    options: TranscriptionOptions = {}
  ): Promise<TranscriptionResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        error: 'GOOGLE_API_KEY environment variable not set',
      };
    }

    try {
      // Read the audio file
      const audioBuffer = readFileSync(audioPath);
      const ext = extname(audioPath).toLowerCase();
      const mimeType = AUDIO_MIME_TYPES[ext];

      if (!mimeType) {
        return {
          success: false,
          error: `Unsupported audio format: ${ext}. Supported: ${Object.keys(AUDIO_MIME_TYPES).join(', ')}`,
        };
      }

      // Upload the file to Gemini
      const uploadResult = await this.uploadFile(audioBuffer, mimeType, basename(audioPath));
      if (!uploadResult.success) {
        return uploadResult as TranscriptionResult;
      }

      // Generate transcription with timestamps
      const transcriptionResult = await this.generateTranscription(
        uploadResult.fileUri!,
        uploadResult.mimeType!,
        options
      );

      // Clean up uploaded file
      if (uploadResult.fileName) {
        await this.deleteFile(uploadResult.fileName).catch(() => {
          // Ignore cleanup errors
        });
      }

      return transcriptionResult;
    } catch (error) {
      return {
        success: false,
        error: `Transcription failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Upload a file to Gemini's File API.
   */
  private async uploadFile(
    content: Buffer,
    mimeType: string,
    displayName: string
  ): Promise<{ success: boolean; fileUri?: string; fileName?: string; mimeType?: string; error?: string }> {
    const uploadUrl = `${this.baseUrl}/upload/v1beta/files?key=${this.apiKey}`;

    // Initiate resumable upload
    const initResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(content.length),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        file: { displayName },
      }),
    });

    if (!initResponse.ok) {
      const errorText = await initResponse.text();
      return {
        success: false,
        error: `File upload init failed: ${initResponse.status} - ${errorText}`,
      };
    }

    const uploadUri = initResponse.headers.get('X-Goog-Upload-URL');
    if (!uploadUri) {
      return {
        success: false,
        error: 'No upload URI received from Gemini',
      };
    }

    // Upload the file content
    const uploadResponse = await fetch(uploadUri, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize',
        'Content-Length': String(content.length),
      },
      body: content,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      return {
        success: false,
        error: `File upload failed: ${uploadResponse.status} - ${errorText}`,
      };
    }

    const uploadData = (await uploadResponse.json()) as {
      file?: { uri?: string; name?: string; mimeType?: string };
    };

    if (!uploadData.file?.uri) {
      return {
        success: false,
        error: 'No file URI in upload response',
      };
    }

    return {
      success: true,
      fileUri: uploadData.file.uri,
      fileName: uploadData.file.name,
      mimeType: uploadData.file.mimeType ?? mimeType,
    };
  }

  /**
   * Generate transcription from uploaded file.
   */
  private async generateTranscription(
    fileUri: string,
    mimeType: string,
    options: TranscriptionOptions
  ): Promise<TranscriptionResult> {
    const generateUrl = `${this.baseUrl}/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const includeTimestamps = options.includeTimestamps !== false;
    const maxSegmentMs = options.maxSegmentDurationMs ?? 30000;

    // Build the prompt for transcription
    const prompt = this.buildTranscriptionPrompt(includeTimestamps, maxSegmentMs, options.language);

    const response = await fetch(generateUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                fileData: {
                  mimeType,
                  fileUri,
                },
              },
              {
                text: prompt,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1, // Low temperature for accurate transcription
          maxOutputTokens: 8192,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Transcription generation failed: ${response.status} - ${errorText}`,
      };
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return {
        success: false,
        error: 'No transcription text in response',
      };
    }

    // Parse the transcription result
    return this.parseTranscriptionResponse(text, includeTimestamps);
  }

  /**
   * Build the prompt for transcription.
   */
  private buildTranscriptionPrompt(
    includeTimestamps: boolean,
    maxSegmentMs: number,
    language?: string
  ): string {
    const languageHint = language ? `The audio is in ${language}. ` : '';

    if (includeTimestamps) {
      return `${languageHint}Transcribe this audio with timestamps.

Output format (JSON):
{
  "segments": [
    {
      "start_ms": 0,
      "end_ms": 5000,
      "text": "The spoken text here"
    }
  ],
  "full_text": "Complete transcription without timestamps",
  "language": "detected language code (e.g., en, es, fr)"
}

Rules:
1. Create segments every ${maxSegmentMs / 1000} seconds or at natural pauses (whichever is shorter)
2. Timestamps should be accurate to within 500ms
3. Include all spoken words, no summarization
4. Preserve punctuation and capitalization
5. Output ONLY valid JSON, no other text`;
    } else {
      return `${languageHint}Transcribe this audio completely. Include all spoken words with proper punctuation. Output only the transcription text, nothing else.`;
    }
  }

  /**
   * Parse the transcription response into segments.
   */
  private parseTranscriptionResponse(
    text: string,
    includeTimestamps: boolean
  ): TranscriptionResult {
    if (!includeTimestamps) {
      return {
        success: true,
        text: text.trim(),
        segments: [
          {
            id: 'seg_1',
            index: 0,
            text: text.trim(),
            type: 'narration',
          },
        ],
      };
    }

    try {
      // Strip markdown code blocks if present
      let cleanText = text.trim();
      if (cleanText.startsWith('```')) {
        // Remove opening ```json or ``` line
        cleanText = cleanText.replace(/^```(?:json)?\s*\n?/, '');
        // Remove closing ```
        cleanText = cleanText.replace(/\n?```\s*$/, '');
      }

      // Try to parse as JSON
      const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        // Fallback to plain text if JSON parsing fails
        return {
          success: true,
          text: text.trim(),
          segments: [
            {
              id: 'seg_1',
              index: 0,
              text: text.trim(),
              type: 'narration',
            },
          ],
        };
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        segments?: Array<{
          start_ms?: number;
          end_ms?: number;
          text?: string;
        }>;
        full_text?: string;
        language?: string;
      };

      const segments: ScriptSegment[] = (parsed.segments ?? []).map((seg, index) => ({
        id: `seg_${index + 1}`,
        index,
        text: seg.text ?? '',
        type: 'narration' as const,
        timeRange: seg.start_ms !== undefined && seg.end_ms !== undefined
          ? {
              startMs: seg.start_ms,
              endMs: seg.end_ms,
            }
          : undefined,
      }));

      // Calculate total duration from last segment
      const lastSegment = segments[segments.length - 1];
      const durationMs = lastSegment?.timeRange?.endMs;

      return {
        success: true,
        text: parsed.full_text ?? segments.map(s => s.text).join(' '),
        segments,
        durationMs,
        language: parsed.language,
      };
    } catch {
      // JSON parsing failed, return as single segment
      return {
        success: true,
        text: text.trim(),
        segments: [
          {
            id: 'seg_1',
            index: 0,
            text: text.trim(),
            type: 'narration',
          },
        ],
      };
    }
  }

  /**
   * Delete an uploaded file.
   */
  private async deleteFile(fileName: string): Promise<void> {
    const deleteUrl = `${this.baseUrl}/v1beta/${fileName}?key=${this.apiKey}`;

    await fetch(deleteUrl, {
      method: 'DELETE',
    });
  }
}

// Singleton instance
export const transcriptionService = new TranscriptionService();
