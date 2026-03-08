/**
 * HTTP and WebSocket routes for kshana-ink server.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { ConversationManager } from './ConversationManager.js';
import { WebSocketHandler } from './WebSocketHandler.js';
import { registerWebUIRoutes } from './webui-routes.js';
import type { LLMClientConfig } from '../core/llm/index.js';
import { getProviderRegistry } from '../services/providers/index.js';

interface ChatRequestBody {
  task: string;
  options?: {
    maxIterations?: number;
    temperature?: number;
  };
}

interface ChatResponse {
  sessionId: string;
  output: string;
  status: string;
  todos?: unknown[];
}

import type { ServerMode } from './WebSocketHandler.js';
import { ApiKeyAuth } from './auth.js';

export interface RouteOptions {
  llmConfig: LLMClientConfig;
  apiPrefix?: string;
  serverMode?: ServerMode;
}

/**
 * Register all routes on the Fastify instance.
 */
export async function registerRoutes(
  app: FastifyInstance,
  options: RouteOptions
): Promise<{ conversationManager: ConversationManager; wsHandler: WebSocketHandler }> {
  const { llmConfig, apiPrefix = '/api/v1', serverMode = 'auto' } = options;

  // Create conversation manager (agent configured lazily per-project)
  const conversationManager = new ConversationManager({
    llmConfig,
    sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
    maxIterations: 50,
  });

  // Set up auth for remote mode
  const auth = serverMode === 'local' ? null : new ApiKeyAuth();

  // Create WebSocket handler with mode and auth
  const wsHandler = new WebSocketHandler(conversationManager, { serverMode, auth: auth ?? undefined });

  // Health check endpoint
  app.get(`${apiPrefix}/health`, async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      status: 'ok',
      timestamp: Date.now(),
      sessions: conversationManager.getActiveSessions().length,
    });
  });

  // Simple stateless chat endpoint (creates session, runs task, returns result)
  app.post<{ Body: ChatRequestBody }>(
    `${apiPrefix}/chat`,
    {
      schema: {
        body: {
          type: 'object',
          required: ['task'],
          properties: {
            task: { type: 'string' },
            options: {
              type: 'object',
              properties: {
                maxIterations: { type: 'number' },
                temperature: { type: 'number' },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: ChatRequestBody }>, reply: FastifyReply) => {
      const { task } = request.body;

      // Create a temporary session
      const session = conversationManager.createSession();

      try {
        const result = await conversationManager.runTask(session.id, task);

        const response: ChatResponse = {
          sessionId: session.id,
          output: result.output,
          status: result.status,
          todos: result.todos,
        };

        // If completed, clean up the session
        if (result.status === 'completed' || result.status === 'error') {
          conversationManager.deleteSession(session.id);
        }

        return reply.send(response);
      } catch (error) {
        // Clean up session on error
        conversationManager.deleteSession(session.id);

        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return reply.status(500).send({
          error: 'Task execution failed',
          message: errorMessage,
        });
      }
    }
  );

  // Get session info
  app.get<{ Params: { sessionId: string } }>(
    `${apiPrefix}/sessions/:sessionId`,
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      const { sessionId } = request.params;
      const session = conversationManager.getSession(sessionId);

      if (!session) {
        return reply.status(404).send({
          error: 'Session not found',
          sessionId,
        });
      }

      return reply.send(session);
    }
  );

  // List all sessions
  app.get(`${apiPrefix}/sessions`, async (_request: FastifyRequest, reply: FastifyReply) => {
    const sessions = conversationManager.getActiveSessions();
    return reply.send({
      sessions,
      count: sessions.length,
    });
  });

  // Delete a session
  app.delete<{ Params: { sessionId: string } }>(
    `${apiPrefix}/sessions/:sessionId`,
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      const { sessionId } = request.params;
      const deleted = conversationManager.deleteSession(sessionId);

      if (!deleted) {
        return reply.status(404).send({
          error: 'Session not found',
          sessionId,
        });
      }

      return reply.send({
        status: 'deleted',
        sessionId,
      });
    }
  );

  // Provider listing endpoint
  app.get(`${apiPrefix}/providers`, async (_request: FastifyRequest, reply: FastifyReply) => {
    const registry = getProviderRegistry();
    const providers = registry.listProviders();
    const config = registry.getConfig();

    // Group providers by capability
    const byCapability = {
      imageGeneration: providers
        .filter(p => p.capabilities.includes('image_generation'))
        .map(p => ({ id: p.id, name: p.displayName, available: p.available })),
      imageEditing: providers
        .filter(p => p.capabilities.includes('image_editing'))
        .map(p => ({ id: p.id, name: p.displayName, available: p.available })),
      videoGeneration: providers
        .filter(p => p.capabilities.includes('video_generation'))
        .map(p => ({ id: p.id, name: p.displayName, available: p.available })),
    };

    return reply.send({
      providers: byCapability,
      currentConfig: config,
    });
  });

  // Update provider configuration
  app.post(`${apiPrefix}/providers/config`, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      imageGeneration?: string;
      imageEditing?: string;
      videoGeneration?: string;
    };
    const registry = getProviderRegistry();
    registry.setConfig(body);
    return reply.send({ status: 'ok', config: registry.getConfig() });
  });

  // Register web UI routes (SPA + project/asset endpoints)
  await registerWebUIRoutes(app);

  // WebSocket endpoint for real-time communication
  app.get(
    `${apiPrefix}/ws/chat`,
    { websocket: true },
    (socket: WebSocket, request: FastifyRequest) => {
      // Extract API key and optional sessionId from query string
      const url = new URL(request.url, `http://${request.hostname}`);
      const apiKey = url.searchParams.get('apiKey') ?? undefined;
      const resumeSessionId = url.searchParams.get('sessionId') ?? undefined;
      const remoteAddress = request.ip;
      wsHandler.handleConnection(socket, remoteAddress, apiKey, resumeSessionId);
    }
  );

  return { conversationManager, wsHandler };
}
