/**
 * Context store module for passing large content between agents by reference.
 */
export { ContextStore, contextStore } from './ContextStore.js';
export type { StoredContext } from './ContextStore.js';

export {
  condenseContent,
  condenseUserInput,
  generateContentLabel,
  generateVariableBaseName,
  generateProjectTitle,
  shouldCondense,
  LONG_CONTENT_THRESHOLD,
} from './MessageCondenser.js';
export type { CondenseResult } from './MessageCondenser.js';

export {
  compressMessages,
  MESSAGES_TO_PRESERVE,
  MIN_MESSAGES_FOR_COMPRESSION,
  SUMMARIZER_SYSTEM_PROMPT,
} from './MessageCompressor.js';
export type { CompressionResult } from './MessageCompressor.js';
