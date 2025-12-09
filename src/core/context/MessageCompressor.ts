/**
 * Message compressor for managing context window limits.
 *
 * When context approaches 80% capacity, compresses old messages by:
 * 1. Preserving system message (first message)
 * 2. Preserving last N exchanges (recent context)
 * 3. Summarizing middle messages via LLM
 */
import type { Message } from '../llm/types.js';

/**
 * Result of compressing messages.
 */
export interface CompressionResult {
  messages: Message[];
  summary: string;
  removedCount: number;
  wasCompressed: boolean;
}

/**
 * Number of message pairs (assistant + user/tool) to preserve at end.
 */
export const MESSAGES_TO_PRESERVE = 5;

/**
 * Minimum messages before compression is worthwhile.
 * Don't compress if we have fewer messages than this.
 */
export const MIN_MESSAGES_FOR_COMPRESSION = 15;

/**
 * Compress conversation messages when context window approaches limit.
 *
 * @param messages - Full message history
 * @param summarizer - Function to summarize content (typically calls LLM)
 * @returns Compressed message array with summary inserted
 */
export async function compressMessages(
  messages: Message[],
  summarizer: (content: string) => Promise<string>
): Promise<CompressionResult> {
  // Don't compress if not enough messages
  if (messages.length < MIN_MESSAGES_FOR_COMPRESSION) {
    return {
      messages,
      summary: '',
      removedCount: 0,
      wasCompressed: false,
    };
  }

  // 1. Separate system message(s) - there may be multiple at start
  const systemMessages: Message[] = [];
  let contentStartIndex = 0;

  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === 'system') {
      systemMessages.push(messages[i] as Message);
      contentStartIndex = i + 1;
    } else {
      break;
    }
  }

  // 2. Calculate how many messages to preserve at the end
  const preserveCount = MESSAGES_TO_PRESERVE * 2; // Roughly pairs
  const toPreserve = messages.slice(-preserveCount);

  // 3. Get messages to summarize (between system and preserved)
  const toSummarize = messages.slice(contentStartIndex, -preserveCount);

  // Not enough to summarize? Skip compression
  if (toSummarize.length < 5) {
    return {
      messages,
      summary: '',
      removedCount: 0,
      wasCompressed: false,
    };
  }

  // 4. Build summary content from messages to compress
  const summaryContent = buildSummaryContent(toSummarize);

  // 5. Call summarizer (typically an LLM call)
  const summary = await summarizer(summaryContent);

  // 6. Build compressed message array
  const summaryMessage: Message = {
    role: 'user',
    content: `## Previous Conversation Summary\n\nThe following is a summary of earlier conversation that was compressed to save context space:\n\n${summary}\n\n---\n\n*Continue from here. The recent messages below are the current state.*`,
  };

  const compressedMessages: Message[] = [
    ...systemMessages,
    summaryMessage,
    ...toPreserve,
  ];

  return {
    messages: compressedMessages,
    summary,
    removedCount: toSummarize.length,
    wasCompressed: true,
  };
}

/**
 * Build content to send to summarizer from messages.
 * Extracts key information while limiting size.
 */
function buildSummaryContent(messages: Message[]): string {
  const parts: string[] = [];

  for (const msg of messages) {
    if (!msg.content) continue;

    const role = msg.role.toUpperCase();
    const content = msg.content;

    // Truncate very long content but preserve structure
    const truncated = content.length > 800
      ? content.slice(0, 800) + '...[truncated]'
      : content;

    // Special handling for tool results
    if (msg.role === 'tool') {
      parts.push(`[TOOL RESULT${msg.name ? ` (${msg.name})` : ''}]: ${truncated}`);
    } else if (msg.toolCalls && msg.toolCalls.length > 0) {
      // Assistant with tool calls
      const toolNames = msg.toolCalls.map(tc => tc.name).join(', ');
      parts.push(`[ASSISTANT called: ${toolNames}]`);
      if (content) {
        parts.push(`[ASSISTANT]: ${truncated}`);
      }
    } else {
      parts.push(`[${role}]: ${truncated}`);
    }
  }

  return parts.join('\n\n');
}

/**
 * System prompt for the summarizer.
 */
export const SUMMARIZER_SYSTEM_PROMPT = `You are summarizing a conversation history to save context space.

Create a concise but comprehensive summary that captures:
1. Key decisions made
2. Important tool results and their outcomes
3. Progress on the task
4. Any errors or issues encountered
5. Current state/context needed to continue

Format as bullet points. Focus on actionable information.
Do NOT include pleasantries or meta-commentary.
Keep the summary under 500 words.`;
