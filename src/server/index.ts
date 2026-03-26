/**
 * kshana-ink server entry point.
 * Creates a Fastify server with HTTP and WebSocket support.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import { registerRoutes, type RouteOptions } from './routes.js';
import { resetLLMLogger } from '../core/llm/index.js';
import type { ConversationManager } from './ConversationManager.js';
import type { WebSocketHandler } from './WebSocketHandler.js';

export interface ServerConfig {
  host?: string;
  port?: number;
  cors?: {
    origin?: string | string[] | boolean;
    methods?: string[];
  };
}

export interface KshanaServer {
  app: FastifyInstance;
  conversationManager: ConversationManager;
  wsHandler: WebSocketHandler;
  start: () => Promise<string>;
  stop: () => Promise<void>;
}

/**
 * Create and configure the Fastify server.
 */
export async function createServer(
  routeOptions: RouteOptions,
  serverConfig: ServerConfig = {}
): Promise<KshanaServer> {
  const {
    host = '127.0.0.1',
    port = 3000,
    cors = { origin: true, methods: ['GET', 'POST', 'DELETE'] },
  } = serverConfig;

  // Reset LLM logger (creates fresh log file for this session)
  resetLLMLogger();

  // Create Fastify instance
  const app = Fastify({
    logger: {
      level: 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      },
    },
    bodyLimit: 50 * 1024 * 1024, // 50MB for file uploads
  });

  // Register raw body parser for file uploads
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  // Register plugins
  await app.register(fastifyCors, cors);
  await app.register(fastifyWebsocket);

  // Register routes
  const { conversationManager, wsHandler } = await registerRoutes(app, routeOptions);

  // Graceful shutdown handler
  const shutdown = async (signal?: string): Promise<void> => {
    console.log('\nShutting down...');
    wsHandler.shutdown();
    conversationManager.shutdown();
    await app.close();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };

  // Handle process signals
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return {
    app,
    conversationManager,
    wsHandler,

    async start(): Promise<string> {
      const address = await app.listen({ host, port });
      console.log(`Server listening at ${address}`);
      console.log(`Web UI: ${address}`);
      console.log(`WebSocket: ws://${host}:${port}/api/v1/ws/chat`);
      return address;
    },

    async stop(): Promise<void> {
      await shutdown();
    },
  };
}

// Export types and classes
export { ConversationManager, type ConversationEvents, type ConversationManagerConfig } from './ConversationManager.js';
export { WebSocketHandler } from './WebSocketHandler.js';
export { registerRoutes, type RouteOptions } from './routes.js';
export * from './types.js';
