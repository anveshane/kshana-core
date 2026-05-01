/**
 * Embed-friendly barrel for the in-process ConversationManager.
 *
 * Used by hosts that want to drive kshana-ink without booting the
 * Fastify HTTP/WebSocket server — e.g. the Electron desktop app
 * imports `ConversationManager` and `ConversationEvents` from
 * `kshana-ink/manager` directly and wires the events into IPC.
 *
 * IMPORTANT: this barrel must not import anything from `./index.ts`,
 * `./routes.ts`, `./WebSocketHandler.ts`, or any `fastify` /
 * `@fastify/*` package. The whole point is to give hosts a Fastify-
 * free entry. The `embedBarrels.test.ts` source-check enforces this.
 */
export { ConversationManager } from './ConversationManager.js';
export type {
  ConversationManagerConfig,
  ConversationEvents,
} from './ConversationManager.js';
export type {
  SessionState,
  ServerMessage,
  ServerMessageType,
  ClientMessage,
} from './types.js';
