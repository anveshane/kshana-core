/**
 * Video Agent
 *
 * Extends GenericAgent to handle video creation workflows.
 * Uses YoutubeTranscriptExtractor as a sub-agent for transcript extraction.
 * Uses HighlightsExtractor as a sub-agent for visual highlights extraction.
 */
import { GenericAgent, type AgentConfig, type GenericAgentResult } from '../core/agent/index.js';
import type { LLMClient } from '../core/llm/index.js';
import type { ToolDefinition, ToolCall } from '../core/llm/types.js';
import { YoutubeTranscriptExtractor, type TranscriptExtractionResult } from './YoutubeTranscriptExtractor.js';
import { HighlightsExtractor, type HighlightsExtractionResult } from './HighlightsExtractor.js';
import { contextStore } from '../core/context/index.js';
import {
  getOrCreateProject,
  setProjectInputType,
  projectExists,
} from '../tasks/video/workflow/index.js';
import { loadProjectFilesAsContexts } from '../tasks/video/index.js';

export interface VideoAgentConfig extends AgentConfig {
  enableTranscriptExtraction?: boolean;
  enableHighlightsExtraction?: boolean;
}

interface TranscriptPhaseState {
  active: boolean;
  youtubeUrl: string;
  task?: string;
  toolCallId: string;
  result?: TranscriptExtractionResult;
}

interface HighlightsPhaseState {
  active: boolean;
  transcriptRef: string;
  task?: string;
  toolCallId: string;
  result?: HighlightsExtractionResult;
}

export class VideoAgent extends GenericAgent {
  private transcriptExtractor: YoutubeTranscriptExtractor;
  private highlightsExtractor: HighlightsExtractor;
  private transcriptPhase: TranscriptPhaseState | null = null;
  private highlightsPhase: HighlightsPhaseState | null = null;
  private videoConfig: VideoAgentConfig;

  constructor(
    tools: Map<string, ToolDefinition>,
    llm: LLMClient,
    config: VideoAgentConfig = {}
  ) {
    super(tools, llm, config);
    this.videoConfig = config;
    this.transcriptExtractor = new YoutubeTranscriptExtractor(llm);
    this.highlightsExtractor = new HighlightsExtractor(llm);

    // Load existing project files into context store on initialization
    // This ensures $story, $characters, $scenes etc are available from plan files
    const loadedContexts = loadProjectFilesAsContexts();
    if (loadedContexts.length > 0) {
      console.log(`[VideoAgent] Loaded ${loadedContexts.length} contexts from project files: ${loadedContexts.join(', ')}`);
    }

    // Forward events from transcript extractor
    this.transcriptExtractor.on('content', (data) => {
      this.emit({
        type: 'streaming_text',
        chunk: data.content,
        done: false,
      });
    });

    this.transcriptExtractor.on('transcript_captured', (data) => {
      // Emit done with skipHistory to prevent sub-agent content from being added to orchestrator history
      // The content was already streamed for display; we don't need it in the LLM context
      this.emit({
        type: 'streaming_text',
        chunk: '',
        done: true,
        skipHistory: true,
      });
      this.emit({
        type: 'agent_text',
        text: `Captured transcript: ${data.length} chars from video ${data.videoId}`,
        isFinal: false,
      });
    });

    this.transcriptExtractor.on('tool_call', (data) => {
      this.emit({
        type: 'tool_call',
        toolCallId: `transcript-${Date.now()}`,
        toolName: data.name,
        arguments: data.arguments,
        agentName: 'TranscriptExtractor',
      });
    });

    this.transcriptExtractor.on('tool_result', (data) => {
      this.emit({
        type: 'tool_result',
        toolCallId: `transcript-${Date.now()}`,
        toolName: data.name,
        result: data.result,
        isError: false,
        agentName: 'TranscriptExtractor',
      });
    });

    // Forward events from highlights extractor
    this.highlightsExtractor.on('content', (data) => {
      this.emit({
        type: 'streaming_text',
        chunk: data.content,
        done: false,
      });
    });

    this.highlightsExtractor.on('highlights_captured', (data) => {
      // Emit done with skipHistory to prevent sub-agent content from being added to orchestrator history
      // The content was already streamed for display; we don't need it in the LLM context
      this.emit({
        type: 'streaming_text',
        chunk: '',
        done: true,
        skipHistory: true,
      });
      this.emit({
        type: 'agent_text',
        text: `Captured ${data.highlightCount} highlights (${data.length} chars)`,
        isFinal: false,
      });
    });

    this.highlightsExtractor.on('tool_call', (data) => {
      this.emit({
        type: 'tool_call',
        toolCallId: `highlights-${Date.now()}`,
        toolName: data.name,
        arguments: data.arguments,
        agentName: 'HighlightsExtractor',
      });
    });

    this.highlightsExtractor.on('tool_result', (data) => {
      this.emit({
        type: 'tool_result',
        toolCallId: `highlights-${Date.now()}`,
        toolName: data.name,
        result: data.result,
        isError: false,
        agentName: 'HighlightsExtractor',
      });
    });
  }

  /**
   * Override handleTask to intercept transcript-extractor and highlights-extractor subagent calls.
   */
  protected override async handleTask(toolCall: ToolCall): Promise<unknown> {
    const args = toolCall.arguments;
    const subagentType = args['subagent_type'] as string;

    // Intercept transcript-extractor calls
    if (subagentType === 'transcript-extractor') {
      return this.handleTranscriptExtraction(toolCall);
    }

    // Intercept highlights-extractor calls
    if (subagentType === 'highlights-extractor') {
      return this.handleHighlightsExtraction(toolCall);
    }

    // Delegate to parent for other subagent types
    return super.handleTask(toolCall);
  }

  /**
   * Handle transcript extraction using the dedicated sub-agent.
   */
  private async handleTranscriptExtraction(toolCall: ToolCall): Promise<unknown> {
    const args = toolCall.arguments;
    const youtubeUrl = args['youtube_url'] as string;
    const task = args['task'] as string;
    const outputFile = args['output_file'] as string | undefined;

    if (!youtubeUrl) {
      return { error: 'No youtube_url provided for transcript-extractor' };
    }

    // Start transcript phase
    this.transcriptPhase = {
      active: true,
      youtubeUrl,
      task,
      toolCallId: toolCall.id,
    };

    this.emit({
      type: 'agent_status',
      status: 'thinking',
      agentName: 'TranscriptExtractor',
    });

    // Extract transcript
    const result = await this.transcriptExtractor.extract({
      youtubeUrl,
      task,
      outputFile,
      storeInContext: true,
      contextLabel: `Transcript from ${youtubeUrl}`,
    });

    this.transcriptPhase.result = result;

    if (result.status === 'success') {
      // Note: Transcript is already displayed when fetch_youtube_transcript tool result is shown
      // No need to stream it again here

      // Ask for verification
      this.emit({
        type: 'question',
        question: 'I have extracted the transcript (displayed above). Does this look correct?',
        isConfirmation: false,
        options: [
          { label: 'Yes, proceed', description: 'Transcript is correct, proceed to next step' },
          { label: 'No, retry', description: 'Try extracting again' },
        ],
        autoApproveTimeoutMs: 30000,
      });

      return {
        status: 'awaiting_verification',
        task,
        transcript: result.transcript,
        contextRef: result.contextRef,
        videoId: result.videoId,
        toolCallId: toolCall.id,
        question: 'I have extracted the transcript (displayed above). Does this look correct?',
        options: [
          { label: 'Yes, proceed', description: 'Transcript is correct, proceed to next step' },
          { label: 'No, retry', description: 'Try extracting again' },
        ],
        autoApproveTimeoutMs: 30000,
      };
    }

    // Error case
    this.transcriptPhase = null;
    return {
      status: 'error',
      error: result.error,
      task,
    };
  }

  /**
   * Handle highlights extraction using the dedicated sub-agent.
   */
  private async handleHighlightsExtraction(toolCall: ToolCall): Promise<unknown> {
    const args = toolCall.arguments;
    const transcriptRef = args['transcript_ref'] as string || args['context_ref'] as string;
    const contextRefs = args['context_refs'] as string[] | undefined;
    const task = args['task'] as string;

    // Get transcript ref from either direct param or context_refs array
    const effectiveTranscriptRef = transcriptRef || contextRefs?.[0];

    if (!effectiveTranscriptRef) {
      return { error: 'No transcript_ref or context_refs provided for highlights-extractor' };
    }

    // GUARD: Check if highlights were already extracted and stored
    // This prevents duplicate extraction when the LLM calls this tool again after approval
    const existingHighlights = contextStore.get('$video_highlights');
    if (existingHighlights) {
      console.log('[VideoAgent] Highlights already exist in context - skipping duplicate extraction');
      const content = existingHighlights.content;
      return {
        status: 'already_complete',
        message: 'HIGHLIGHTS ALREADY EXTRACTED. Do not call highlights-extractor again. Proceed to Characters & Settings phase.',
        contextRef: '$video_highlights',
        highlightCount: (content.match(/## Highlight \d+/g) || []).length,
        nextPhase: 'characters_settings',
      };
    }

    // Start highlights phase
    this.highlightsPhase = {
      active: true,
      transcriptRef: effectiveTranscriptRef,
      task,
      toolCallId: toolCall.id,
    };

    this.emit({
      type: 'agent_status',
      status: 'thinking',
      agentName: 'HighlightsExtractor',
    });

    // Extract highlights
    const result = await this.highlightsExtractor.extract({
      transcriptRef: effectiveTranscriptRef,
      task,
      storeInContext: true,
      contextLabel: 'Video Highlights',
    });

    this.highlightsPhase.result = result;

    if (result.status === 'success') {
      // Ask for verification
      this.emit({
        type: 'question',
        question: 'I have extracted the visual highlights. Do these look correct?',
        isConfirmation: false,
        options: [
          { label: 'Yes, proceed', description: 'Highlights are good, proceed to next step' },
          { label: 'No, retry', description: 'Try extracting different highlights' },
        ],
        autoApproveTimeoutMs: 30000,
      });

      // Note: We exclude highlights array and highlightsMarkdown to keep response size small.
      // The content was already streamed to UI and stored in context.
      return {
        status: 'awaiting_verification',
        task,
        highlightCount: result.highlights?.length ?? 0,
        contextRef: result.contextRef,
        summary: result.summary,
        toolCallId: toolCall.id,
        question: 'I have extracted the visual highlights. Do these look correct?',
        options: [
          { label: 'Yes, proceed', description: 'Highlights are good, proceed to next step' },
          { label: 'No, retry', description: 'Try extracting different highlights' },
        ],
        autoApproveTimeoutMs: 30000,
      };
    }

    // Error case
    this.highlightsPhase = null;
    return {
      status: 'error',
      error: result.error,
      task,
    };
  }

  /**
   * Override run to handle transcript and highlights verification responses.
   */
  override async run(task: string, userResponse?: string): Promise<GenericAgentResult> {
    // Check if we're in transcript phase and this is a user response
    if (this.transcriptPhase?.active && this.transcriptPhase.result && userResponse) {
      const lower = userResponse.toLowerCase().trim();
      const isApproval = ['yes', 'proceed', 'correct', 'ok', 'good', '1'].some(w => lower.includes(w));

      if (isApproval) {
        // CRITICAL: Also store transcript as $story for downstream phases
        // This ensures characters, settings, scenes, etc. can all find the content
        const transcript = this.transcriptPhase.result.transcript;
        let storyRef = '$story'; // Default, will be updated with actual variable name
        if (transcript) {
          const result = contextStore.store(transcript, 'Full story', {
            source: 'tool',
            variableBaseName: 'story',
          });
          storyRef = result.variableName;
          console.log(`[VideoAgent] Stored transcript as ${storyRef} for downstream phases`);
        }

        // AUTOMATICALLY create/update project with YouTube workflow settings
        // This removes dependency on orchestrator LLM to do this correctly
        let projectInfo: { id: string; phase: string } | null = null;
        try {
          // Create project with transcript as the story content
          const project = getOrCreateProject(transcript || '', 'cinematic_realism');

          // Set input type to 'youtube' which skips plot/story phases
          const updatedProject = setProjectInputType('youtube');

          if (updatedProject) {
            projectInfo = {
              id: updatedProject.id,
              phase: updatedProject.currentPhase,
            };
            console.log(`[VideoAgent] Auto-created YouTube project: ${projectInfo.id}, starting at phase: ${projectInfo.phase}`);
          }
        } catch (err) {
          console.error('[VideoAgent] Failed to auto-create project:', err);
        }

        // Save transcript info before clearing phase
        const savedToolCallId = this.transcriptPhase.toolCallId;

        this.transcriptPhase = null;

        // AUTO-TRIGGER HIGHLIGHTS EXTRACTION
        // Extract visual highlights from the transcript for image generation guidance
        console.log(`[VideoAgent] Auto-triggering highlights extraction from ${storyRef}`);

        const highlightsResult = await this.handleHighlightsExtraction({
          id: `highlights-${Date.now()}`,
          name: 'Task',
          arguments: {
            subagent_type: 'highlights-extractor',
            transcript_ref: storyRef, // Use the actual stored context variable name
            task: 'Extract 8-12 visual highlights with composition hints and emotional context for image generation',
          },
        });

        // If highlights extraction succeeded and is awaiting verification,
        // return that result so user can approve highlights
        const highlightsResultObj = highlightsResult as Record<string, unknown>;
        if (highlightsResultObj['status'] === 'awaiting_verification') {
          // Add transcript approval to messages first
          const transcriptResult = {
            status: 'approved',
            message: `Transcript approved and project created. ${projectInfo ? `Project ID: ${projectInfo.id}` : ''} Now reviewing visual highlights.`,
            storyRef,
            projectId: projectInfo?.id,
          };

          // CRITICAL: OpenAI API requires assistant message with tool_calls BEFORE tool result
          this.messages.push({
            role: 'assistant',
            content: '',
            toolCalls: [{
              id: savedToolCallId,
              name: 'Task',
              arguments: { subagent_type: 'transcript-extractor' },
            }],
          });

          this.messages.push({
            role: 'tool',
            content: JSON.stringify(transcriptResult),
            toolCallId: savedToolCallId,
            name: 'Task',
          });

          // Return the highlights verification result
          return {
            status: 'waiting_for_user',
            output: '',
            todos: [],
            ...highlightsResultObj,
          } as GenericAgentResult;
        }

        // If highlights extraction failed or completed without verification,
        // continue with the normal flow
        const highlightsRef = (highlightsResultObj['contextRef'] as string) || '$video_highlights';
        const result = {
          status: 'approved',
          task: 'transcript-extraction',
          storyRef,
          highlightsRef,
          message: `Transcript and highlights ready. Project ID: ${projectInfo?.id || 'created'}. Proceed to extract characters and settings from ${storyRef}, using ${highlightsRef} for visual direction.`,
          toolCallId: savedToolCallId,
          projectCreated: !!projectInfo,
          projectId: projectInfo?.id,
          currentPhase: projectInfo?.phase,
          nextStep: `Extract characters and settings from ${storyRef} using ${highlightsRef} for visual guidance, then break into scenes.`,
        };

        // Add tool result to orchestrator messages
        this.messages.push({
          role: 'tool',
          content: JSON.stringify(result),
          toolCallId: savedToolCallId,
          name: 'Task',
        });

        this.emit({
          type: 'agent_status',
          status: 'thinking',
          agentName: this.name,
        });

        // Continue with the parent run
        return super.run(task, userResponse);
      } else {
        // Retry extraction
        const toolCallId = this.transcriptPhase.toolCallId;
        const youtubeUrl = this.transcriptPhase.youtubeUrl;
        const prevTask = this.transcriptPhase.task;

        this.transcriptPhase = null;

        const retryResult = await this.handleTranscriptExtraction({
          id: toolCallId,
          name: 'Task',
          arguments: {
            subagent_type: 'transcript-extractor',
            youtube_url: youtubeUrl,
            task: `${prevTask || ''} User feedback: ${userResponse}`.trim(),
          },
        });

        // Return a waiting result since we're back in verification mode
        return {
          status: 'waiting_for_user',
          output: '',
          todos: [],
          ...retryResult as object,
        } as GenericAgentResult;
      }
    }

    // Check if we're in highlights phase and this is a user response
    if (this.highlightsPhase?.active && this.highlightsPhase.result && userResponse) {
      const lower = userResponse.toLowerCase().trim();
      const isApproval = ['yes', 'proceed', 'correct', 'ok', 'good', '1'].some(w => lower.includes(w));

      if (isApproval) {
        // Note: We intentionally exclude the full highlights array to keep message size small.
        // The orchestrator should use contextRef ($video_highlights) to access highlights.
        const highlightCount = this.highlightsPhase.result.highlights?.length ?? 0;
        const contextRef = this.highlightsPhase.result.contextRef || '$video_highlights';
        const result = {
          status: 'approved',
          task: this.highlightsPhase.task,
          highlightCount,
          contextRef,
          summary: this.highlightsPhase.result.summary,
          // CRITICAL: Clear instructions to prevent duplicate extraction
          message: `HIGHLIGHTS EXTRACTION COMPLETE. ${highlightCount} highlights approved and stored as ${contextRef}. ` +
            `DO NOT call highlights-extractor again. ` +
            `NEXT STEP: Proceed to Characters & Settings phase - extract characters and settings from $story, using ${contextRef} as visual reference.`,
          toolCallId: this.highlightsPhase.toolCallId,
          nextPhase: 'characters_settings',
          completedPhases: ['transcript', 'highlights'],
        };

        // CRITICAL: OpenAI API requires an assistant message with tool_calls BEFORE the tool result
        // Add the assistant message that "called" the highlights extraction
        const toolCallId = this.highlightsPhase.toolCallId;
        this.messages.push({
          role: 'assistant',
          content: '',
          toolCalls: [{
            id: toolCallId,
            name: 'Task',
            arguments: {
              subagent_type: 'highlights-extractor',
              task: this.highlightsPhase.task,
            },
          }],
        });

        // Add tool result to orchestrator messages with the matching tool call ID
        this.messages.push({
          role: 'tool',
          content: JSON.stringify(result),
          toolCallId: toolCallId,
          name: 'Task',
        });

        this.highlightsPhase = null;

        this.emit({
          type: 'agent_status',
          status: 'thinking',
          agentName: this.name,
        });

        // Continue with the parent run (which will process the tool result)
        return super.run(task, userResponse);
      } else {
        // Retry extraction
        const toolCallId = this.highlightsPhase.toolCallId;
        const transcriptRef = this.highlightsPhase.transcriptRef;
        const prevTask = this.highlightsPhase.task;

        this.highlightsPhase = null;

        const retryResult = await this.handleHighlightsExtraction({
          id: toolCallId,
          name: 'Task',
          arguments: {
            subagent_type: 'highlights-extractor',
            transcript_ref: transcriptRef,
            task: `${prevTask || ''} User feedback: ${userResponse}`.trim(),
          },
        });

        // Return a waiting result since we're back in verification mode
        return {
          status: 'waiting_for_user',
          output: '',
          todos: [],
          ...retryResult as object,
        } as GenericAgentResult;
      }
    }

    // Delegate to parent for non-transcript/highlights cases
    return super.run(task, userResponse);
  }

  /**
   * Check if we're waiting for transcript verification.
   */
  isWaitingForTranscriptVerification(): boolean {
    return this.transcriptPhase?.active === true && this.transcriptPhase?.result !== undefined;
  }

  /**
   * Check if we're waiting for highlights verification.
   */
  isWaitingForHighlightsVerification(): boolean {
    return this.highlightsPhase?.active === true && this.highlightsPhase?.result !== undefined;
  }
}

/**
 * Factory function to create a video agent.
 */
export function createVideoAgent(
  tools: Map<string, ToolDefinition>,
  llm: LLMClient,
  config: VideoAgentConfig = {}
): VideoAgent {
  return new VideoAgent(tools, llm, config);
}
