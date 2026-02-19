/**
 * HTTP and WebSocket routes for kshana-ink server.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { ConversationManager } from './ConversationManager.js';
import { WebSocketHandler } from './WebSocketHandler.js';
import type { LLMClientConfig } from '../core/llm/index.js';
import { projectExists, loadProject, deleteProject } from '../tasks/video/workflow/ProjectManager.js';

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

type TaskType = 'generic' | 'video';

export interface RouteOptions {
  llmConfig: LLMClientConfig;
  apiPrefix?: string;
  taskType?: TaskType;
}

/**
 * Register all routes on the Fastify instance.
 */
export async function registerRoutes(
  app: FastifyInstance,
  options: RouteOptions
): Promise<{ conversationManager: ConversationManager; wsHandler: WebSocketHandler }> {
  const { llmConfig, apiPrefix = '/api/v1', taskType = 'generic' } = options;

  // Create conversation manager with task type
  const conversationManager = new ConversationManager({
    llmConfig,
    sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
    maxIterations: 50,
    taskType,
  });

  // Create WebSocket handler
  const wsHandler = new WebSocketHandler(conversationManager);

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
      const session = await conversationManager.createSession();

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

  // WebSocket endpoint for real-time communication
  app.get(
    `${apiPrefix}/ws/chat`,
    { websocket: true },
    async (socket: WebSocket, request: FastifyRequest) => {
      // Extract query parameters from the request URL
      console.log('[routes] WebSocket connection request:', {
        url: request.url,
        query: request.query,
        queryType: typeof request.query,
      });
      const query = request.query as { project_dir?: string };
      console.log('[routes] Extracted query:', query);
      await wsHandler.handleConnection(socket, { query });
    }
  );

  // Project management endpoints
  // Check if project exists and return its data
  app.get<{ Querystring: { project_dir?: string } }>(
    `${apiPrefix}/project`,
    async (request: FastifyRequest<{ Querystring: { project_dir?: string } }>, reply: FastifyReply) => {
      const { project_dir } = request.query;
      
      if (!project_dir) {
        return reply.status(400).send({
          error: 'project_dir query parameter is required',
        });
      }

      if (!projectExists(project_dir)) {
        return reply.send({ exists: false });
      }

      const project = loadProject(project_dir);
      if (!project) {
        return reply.send({ exists: false });
      }

      return reply.send({ exists: true, project });
    }
  );

  // Delete project
  app.delete<{ Querystring: { project_dir?: string } }>(
    `${apiPrefix}/project`,
    async (request: FastifyRequest<{ Querystring: { project_dir?: string } }>, reply: FastifyReply) => {
      const { project_dir } = request.query;
      
      if (!project_dir) {
        return reply.status(400).send({
          error: 'project_dir query parameter is required',
        });
      }

      const success = deleteProject(project_dir);
      return reply.send({ success });
    }
  );

  return { conversationManager, wsHandler };
}
