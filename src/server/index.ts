/**
 * kshana-ink server entry point.
 * Creates a Fastify server with HTTP and WebSocket support.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import { registerRoutes, type RouteOptions } from './routes.js';
import { resetLLMLogger } from '../core/llm/index.js';
import { shutdownVideoTools } from '../tasks/video/index.js';
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

  // Configure logger - use pino-pretty in development, standard pino in production
  const isDev = process.env['NODE_ENV'] !== 'production';
  const loggerConfig = isDev
    ? {
        level: 'info',
        transport: {
          target: 'pino-pretty',
          options: {
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname',
          },
        },
      }
    : {
        level: 'info',
      };

  // Create Fastify instance
  const app = Fastify({
    logger: loggerConfig,
  });

  // Register plugins
  await app.register(fastifyCors, cors);
  await app.register(fastifyWebsocket);

  // Register routes
  const { conversationManager, wsHandler } = await registerRoutes(app, routeOptions);

  // Graceful shutdown handler
  const shutdown = async (): Promise<void> => {
    console.log('\nShutting down...');
    wsHandler.shutdown();
    conversationManager.shutdown();
    await shutdownVideoTools();
    await app.close();
  };

  // Handle process signals
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return {
    app,
    conversationManager,
    wsHandler,

    async start(): Promise<string> {
      const address = await app.listen({ host, port });
      console.log(`Server listening at ${address}`);
      console.log(`WebSocket endpoint: ws://${host}:${port}/api/v1/ws/chat`);
      console.log(`HTTP endpoint: ${address}/api/v1/chat`);
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
