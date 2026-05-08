/**
 * Embed-friendly barrel for the in-process ConversationManager.
 *
 * Used by hosts that want to drive kshana-core without booting the
 * Fastify HTTP/WebSocket server — e.g. the Electron desktop app
 * imports `ConversationManager` and `ConversationEvents` from
 * `kshana-core/manager` directly and wires the events into IPC.
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
export { loadDevEnv } from './loadDevEnv.js';
export type { LoadDevEnvResult } from './loadDevEnv.js';
export {
  captureAnalyticsEvent,
  captureDesktopAppFirstStarted,
  captureDesktopAppStarted,
  captureDesktopHeartbeat,
  captureDesktopAppQuit,
  captureDesktopAuthStarted,
  configureAnalytics,
  getAnalyticsDistinctId,
  identifyAnalyticsUser,
  isPostHogEnabled,
  registerPostHogShutdownHandlers,
  resetAnalyticsForTests,
  sanitizeAnalyticsProperties,
  setAnalyticsIdentity,
  setCommonProperties,
  shutdownPostHog,
} from './posthog.js';
export type {
  AnalyticsCaptureOptions,
  AnalyticsEventName,
  AnalyticsIdentity,
} from './posthog.js';
