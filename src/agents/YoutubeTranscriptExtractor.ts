/**
 * YouTube Transcript Extractor Agent
 *
 * A specialized agent for extracting transcripts from YouTube videos.
 * Can be used as a sub-agent in workflows that need transcript extraction.
 */
import { EventEmitter } from 'events';
import type { LLMClient } from '../core/llm/index.js';
import type { ToolDefinition } from '../core/llm/types.js';
import { fetchYouTubeTranscriptTool } from '../services/youtube/tools.js';
import { storeContextTool, fetchContextTool } from '../core/tools/builtin/index.js';
import { loadAndRenderMarkdown } from '../core/prompts/loader.js';

export interface TranscriptExtractionResult {
  status: 'success' | 'error';
  transcript?: string;
  contextRef?: string;
  videoId?: string;
  outputFile?: string;
  error?: string;
}

export interface TranscriptExtractorOptions {
  youtubeUrl: string;
  task?: string;
  outputFile?: string;
  storeInContext?: boolean;
  contextLabel?: string;
}

interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  toolCallId?: string;
  name?: string;
}

export class YoutubeTranscriptExtractor extends EventEmitter {
  private llm: LLMClient;
  private tools: Map<string, ToolDefinition>;
  private maxIterations = 5;

  constructor(llm: LLMClient) {
    super();
    this.llm = llm;

    // Only the tools this agent needs
    this.tools = new Map([
      [fetchYouTubeTranscriptTool.name, fetchYouTubeTranscriptTool],
      [storeContextTool.name, storeContextTool],
      [fetchContextTool.name, fetchContextTool],
    ]);
  }

  /**
   * Extract transcript from a YouTube video.
   */
  async extract(options: TranscriptExtractorOptions): Promise<TranscriptExtractionResult> {
    const { youtubeUrl, task, outputFile, storeInContext = true, contextLabel } = options;

    // Build system prompt
    const basePrompt = loadAndRenderMarkdown('subagents/transcript-extractor.md', {});
    const systemPrompt = `${basePrompt}

<youtube_url>${youtubeUrl}</youtube_url>

<task>${task || 'Extract the full transcript from this YouTube video.'}</task>

${storeInContext ? `After extracting, store the transcript using store_context with label "${contextLabel || 'YouTube Transcript'}".` : ''}
`;

    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Please extract the transcript from ${youtubeUrl}` },
    ];

    let capturedTranscript: string | undefined;
    let contextRef: string | undefined;
    let videoId: string | undefined;

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      this.emit('iteration', { iteration, maxIterations: this.maxIterations });

      // Call LLM
      const toolsArray = Array.from(this.tools.values());
      let responseContent = '';
      const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
      const toolCallAccumulators = new Map<number, { id: string; name: string; arguments: string }>();

      for await (const chunk of this.llm.generateStream({
        messages,
        tools: toolsArray,
        temperature: 0,
      })) {
        if (chunk.content) {
          responseContent += chunk.content;
          this.emit('content', { content: chunk.content });
        }
        if (chunk.toolCallDelta) {
          const delta = chunk.toolCallDelta;
          let acc = toolCallAccumulators.get(delta.index);
          if (!acc) {
            acc = { id: delta.id ?? '', name: delta.name ?? '', arguments: '' };
            toolCallAccumulators.set(delta.index, acc);
          }
          if (delta.id) acc.id = delta.id;
          if (delta.name) acc.name = delta.name;
          if (delta.arguments) acc.arguments += delta.arguments;
        }
      }

      // Parse tool calls
      for (const [, acc] of toolCallAccumulators) {
        if (acc.id && acc.name) {
          try {
            toolCalls.push({
              id: acc.id,
              name: acc.name,
              arguments: acc.arguments ? JSON.parse(acc.arguments) : {},
            });
          } catch {
            toolCalls.push({ id: acc.id, name: acc.name, arguments: {} });
          }
        }
      }

      // Add assistant message
      messages.push({
        role: 'assistant',
        content: responseContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      });

      // If no tool calls, we're done
      if (toolCalls.length === 0) {
        break;
      }

      // Execute tool calls
      for (const toolCall of toolCalls) {
        const tool = this.tools.get(toolCall.name);
        if (!tool?.handler) {
          messages.push({
            role: 'tool',
            content: JSON.stringify({ error: `Tool ${toolCall.name} not found` }),
            toolCallId: toolCall.id,
            name: toolCall.name,
          });
          continue;
        }

        this.emit('tool_call', { name: toolCall.name, arguments: toolCall.arguments });

        try {
          const result = await Promise.resolve(tool.handler(toolCall.arguments));
          const resultObj = result as Record<string, unknown>;

          // Capture transcript from fetch_youtube_transcript
          if (toolCall.name === 'fetch_youtube_transcript') {
            if (resultObj['transcript'] || resultObj['content']) {
              capturedTranscript = (resultObj['content'] || resultObj['transcript']) as string;
              videoId = resultObj['video_id'] as string;
              this.emit('transcript_captured', {
                length: capturedTranscript.length,
                videoId,
              });
            }
          }

          // Capture context_ref from store_context
          if (toolCall.name === 'store_context' && resultObj['context_ref']) {
            contextRef = resultObj['context_ref'] as string;
            this.emit('context_stored', { contextRef });
          }

          messages.push({
            role: 'tool',
            content: JSON.stringify(result),
            toolCallId: toolCall.id,
            name: toolCall.name,
          });

          this.emit('tool_result', { name: toolCall.name, result });
        } catch (error) {
          const errorMsg = String(error);
          messages.push({
            role: 'tool',
            content: JSON.stringify({ error: errorMsg }),
            toolCallId: toolCall.id,
            name: toolCall.name,
          });
          this.emit('tool_error', { name: toolCall.name, error: errorMsg });
        }
      }
    }

    // Return result
    if (capturedTranscript) {
      return {
        status: 'success',
        transcript: capturedTranscript,
        contextRef,
        videoId,
        outputFile,
      };
    }

    return {
      status: 'error',
      error: 'Failed to extract transcript after maximum iterations',
    };
  }
}

/**
 * Factory function to create a transcript extractor.
 */
export function createTranscriptExtractor(llm: LLMClient): YoutubeTranscriptExtractor {
  return new YoutubeTranscriptExtractor(llm);
}
