/**
 * Highlights Extractor Agent
 *
 * A specialized agent for extracting visual highlights and emotional moments from transcripts.
 * Used after transcript extraction to identify key visual moments for image generation.
 */
import { EventEmitter } from 'events';
import type { LLMClient } from '../core/llm/index.js';
import type { ToolDefinition } from '../core/llm/types.js';
import { storeContextTool, fetchContextTool } from '../core/tools/builtin/index.js';
import { loadAndRenderMarkdown } from '../core/prompts/loader.js';

/**
 * Visual composition hints for a highlight.
 */
export interface HighlightVisual {
  moment_description: string;
  camera_angle: string;
  composition: string;
  lighting: string;
  key_elements: string[];
  color_palette?: string;
}

/**
 * Emotional/narrative context for a highlight.
 */
export interface HighlightNarrative {
  emotional_tone: string;
  story_beat: string;
  character_state?: string;
  thematic_weight: string;
}

/**
 * A single highlight extracted from a transcript.
 */
export interface Highlight {
  id: string;
  timestamp_range?: string;
  visual: HighlightVisual;
  narrative: HighlightNarrative;
  source_quote?: string;
}

export interface HighlightsExtractionResult {
  status: 'success' | 'error';
  highlights?: Highlight[];
  highlightsMarkdown?: string;
  contextRef?: string;
  summary?: string;
  error?: string;
}

export interface HighlightsExtractorOptions {
  transcriptRef: string;
  task?: string;
  maxHighlights?: number;
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

export class HighlightsExtractor extends EventEmitter {
  private llm: LLMClient;
  private tools: Map<string, ToolDefinition>;
  private maxIterations = 5;

  constructor(llm: LLMClient) {
    super();
    this.llm = llm;

    // Only the tools this agent needs
    this.tools = new Map([
      [storeContextTool.name, storeContextTool],
      [fetchContextTool.name, fetchContextTool],
    ]);
  }

  /**
   * Extract highlights from a transcript.
   */
  async extract(options: HighlightsExtractorOptions): Promise<HighlightsExtractionResult> {
    const {
      transcriptRef,
      task,
      maxHighlights = 10,
      storeInContext = true,
      contextLabel,
    } = options;

    // Build system prompt
    const basePrompt = loadAndRenderMarkdown('subagents/highlights-extractor.md', {});
    const systemPrompt = `${basePrompt}

<transcript_ref>${transcriptRef}</transcript_ref>

<task>${task || `Extract ${maxHighlights} visual highlights from the transcript.`}</task>

<max_highlights>${maxHighlights}</max_highlights>

${storeInContext ? `After extracting highlights, store them using store_context with label "${contextLabel || 'Video Highlights'}".` : ''}

IMPORTANT: First use fetch_context to retrieve the transcript from ${transcriptRef}, then analyze it and extract highlights.
`;

    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Please extract visual highlights from the transcript stored at ${transcriptRef}` },
    ];

    let capturedHighlights: string | undefined;
    let contextRef: string | undefined;

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
        temperature: 0.3, // Slightly higher for creative analysis
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

      // If no tool calls, we're done - capture the highlights from response
      if (toolCalls.length === 0) {
        // The response content should contain the highlights
        if (responseContent && responseContent.includes('Highlight')) {
          capturedHighlights = responseContent;
          this.emit('highlights_captured', {
            length: capturedHighlights.length,
            highlightCount: (capturedHighlights.match(/## Highlight \d+/g) || []).length,
          });
        }
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

          // Capture context_ref from store_context
          if (toolCall.name === 'store_context' && resultObj['context_ref']) {
            contextRef = resultObj['context_ref'] as string;
            // Also capture what was stored as highlights
            const storedContent = toolCall.arguments['content'] as string;
            if (storedContent && storedContent.includes('Highlight')) {
              capturedHighlights = storedContent;
              // Emit event so UI can display the count
              const highlightCount = (storedContent.match(/## Highlight \d+/g) || []).length;
              this.emit('highlights_captured', {
                length: storedContent.length,
                highlightCount,
              });
            }
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
    if (capturedHighlights) {
      const highlights = this.parseHighlights(capturedHighlights);
      return {
        status: 'success',
        highlights,
        highlightsMarkdown: capturedHighlights,
        contextRef,
        summary: `Extracted ${highlights.length} visual highlights`,
      };
    }

    return {
      status: 'error',
      error: 'Failed to extract highlights after maximum iterations',
    };
  }

  /**
   * Parse markdown highlights into structured format.
   */
  private parseHighlights(markdown: string): Highlight[] {
    const highlights: Highlight[] = [];
    const sections = markdown.split(/## Highlight \d+:/);

    for (let i = 1; i < sections.length; i++) {
      const section = sections[i];
      if (!section) continue;

      const highlight: Highlight = {
        id: `highlight_${i}`,
        visual: {
          moment_description: this.extractField(section, 'Moment') || '',
          camera_angle: this.extractField(section, 'Camera Angle') || 'medium shot',
          composition: this.extractField(section, 'Composition') || 'balanced',
          lighting: this.extractField(section, 'Lighting') || 'natural',
          key_elements: this.extractListField(section, 'Key Elements'),
          color_palette: this.extractField(section, 'Color Palette'),
        },
        narrative: {
          emotional_tone: this.extractField(section, 'Emotional Tone') || '',
          story_beat: this.extractField(section, 'Story Beat') || '',
          character_state: this.extractField(section, 'Character State'),
          thematic_weight: this.extractField(section, 'Thematic Weight') || '',
        },
        timestamp_range: this.extractField(section, 'Timestamp Range'),
        source_quote: this.extractQuote(section),
      };

      highlights.push(highlight);
    }

    return highlights;
  }

  /**
   * Extract a field value from markdown section.
   */
  private extractField(section: string, fieldName: string): string | undefined {
    const patterns = [
      new RegExp(`\\*\\*${fieldName}\\*\\*:\\s*(.+?)(?=\\n|$)`, 'i'),
      new RegExp(`- ${fieldName}:\\s*(.+?)(?=\\n|$)`, 'i'),
      new RegExp(`${fieldName}:\\s*(.+?)(?=\\n|$)`, 'i'),
    ];

    for (const pattern of patterns) {
      const match = section.match(pattern);
      if (match?.[1]) {
        return match[1].trim();
      }
    }
    return undefined;
  }

  /**
   * Extract a list field (comma-separated or bullet points).
   */
  private extractListField(section: string, fieldName: string): string[] {
    const value = this.extractField(section, fieldName);
    if (!value) return [];

    // Handle both comma-separated and bullet point lists
    if (value.includes(',')) {
      return value.split(',').map(s => s.trim()).filter(Boolean);
    }
    return [value];
  }

  /**
   * Extract quoted text from section.
   */
  private extractQuote(section: string): string | undefined {
    const match = section.match(/>\s*"?(.+?)"?(?=\n|$)/);
    return match?.[1]?.trim();
  }
}

/**
 * Factory function to create a highlights extractor.
 */
export function createHighlightsExtractor(llm: LLMClient): HighlightsExtractor {
  return new HighlightsExtractor(llm);
}
