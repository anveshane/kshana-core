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

  // ── Workflow management endpoints ──────────────────────────────────────────

  // List all workflows grouped by pipeline
  app.get(`${apiPrefix}/workflows`, async (_request: FastifyRequest, reply: FastifyReply) => {
    const { getWorkflowModeRegistry } = await import('../services/providers/WorkflowModeRegistry.js');
    const registry = getWorkflowModeRegistry();
    const all = registry.listAll();

    const grouped: Record<string, typeof all> = {};
    for (const mode of all) {
      const key = mode.pipeline;
      if (!grouped[key]) grouped[key] = [];
      grouped[key]!.push(mode);
    }

    // Mark which is active per pipeline
    const active: Record<string, string | null> = {};
    for (const pipeline of ['image_generation', 'image_editing', 'image_processing', 'video_generation'] as const) {
      const activeMode = registry.getActiveForPipeline(pipeline, 'comfyui');
      active[pipeline] = activeMode?.id ?? null;
    }

    return reply.send({ workflows: grouped, active });
  });

  // Upload a workflow JSON — returns parsed nodes + LLM analysis for the integration wizard
  app.post(`${apiPrefix}/workflows/upload`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { parseWorkflow, analyzeWorkflowWithLLM } = await import('../services/comfyui/WorkflowParser.js');
    const body = request.body as { filename: string; content: string };
    if (!body.content) {
      return reply.status(400).send({ error: 'Missing workflow content' });
    }

    try {
      const parsed = parseWorkflow(body.content);

      // Save the workflow JSON to workflows/user/
      const fs = await import('fs');
      const path = await import('path');
      const userDir = path.join(process.cwd(), 'workflows', 'user');
      if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });

      const safeName = (body.filename || 'workflow').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/\.json$/, '');
      const filePath = path.join(userDir, `${safeName}.json`);
      fs.writeFileSync(filePath, body.content);

      // Run LLM analysis for intelligent suggestions
      let analysis = null;
      try {
        const { LLMClient } = await import('../core/llm/index.js');
        const llmClient = new LLMClient(llmConfig);
        analysis = await analyzeWorkflowWithLLM(body.content, parsed, llmClient);

        // Merge LLM suggestions into parsed nodes
        if (analysis.suggestedMappings) {
          for (const suggestion of analysis.suggestedMappings) {
            const node = parsed.inputNodes.find(n => n.nodeId === suggestion.nodeId);
            if (node) {
              node.suggestedInput = suggestion.suggestedInput;
            }
          }
        }

        // Override pipeline detection if LLM is more confident
        if (analysis.pipeline && parsed.detectedPipeline === 'unknown') {
          parsed.detectedPipeline = analysis.pipeline as any;
        }
      } catch (llmErr) {
        // LLM analysis failed — non-fatal, wizard still works with heuristic suggestions
        console.warn('[WorkflowUpload] LLM analysis failed:', llmErr);
      }

      return reply.send({
        status: 'uploaded',
        filename: `${safeName}.json`,
        parsed,
        analysis,
      });
    } catch (err) {
      return reply.status(400).send({ error: `Failed to parse workflow: ${err}` });
    }
  });

  // Save manifest (configure) for an uploaded workflow
  app.post(`${apiPrefix}/workflows/configure`, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, unknown>;
    if (!body['id'] || !body['workflowFile']) {
      return reply.status(400).send({ error: 'Missing id or workflowFile' });
    }

    const fs = await import('fs');
    const path = await import('path');
    const userDir = path.join(process.cwd(), 'workflows', 'user');
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });

    const manifestPath = path.join(userDir, `${body['id']}.manifest.json`);
    fs.writeFileSync(manifestPath, JSON.stringify(body, null, 2));

    // Refresh registry
    const { getWorkflowModeRegistry } = await import('../services/providers/WorkflowModeRegistry.js');
    getWorkflowModeRegistry().refresh();

    return reply.send({ status: 'configured', manifestPath });
  });

  // Set a workflow as the active override for its pipeline
  app.put(`${apiPrefix}/workflows/:id/override`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { getWorkflowModeRegistry } = await import('../services/providers/WorkflowModeRegistry.js');
    const registry = getWorkflowModeRegistry();
    const success = registry.setOverride(id);
    if (!success) return reply.status(404).send({ error: 'Workflow not found or is built-in' });
    return reply.send({ status: 'ok', activeOverride: id });
  });

  // Clear override for a pipeline (revert to built-in)
  app.delete(`${apiPrefix}/workflows/override/:pipeline`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { pipeline } = request.params as { pipeline: string };
    const { getWorkflowModeRegistry } = await import('../services/providers/WorkflowModeRegistry.js');
    getWorkflowModeRegistry().clearOverride(pipeline as any);
    return reply.send({ status: 'ok', reverted: pipeline });
  });

  // Delete a user-uploaded workflow
  app.delete(`${apiPrefix}/workflows/:id`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { getWorkflowModeRegistry } = await import('../services/providers/WorkflowModeRegistry.js');
    const registry = getWorkflowModeRegistry();
    const mode = registry.getMode(id);
    if (!mode) return reply.status(404).send({ error: 'Workflow not found' });
    if (mode.builtIn) return reply.status(403).send({ error: 'Cannot delete built-in workflows' });

    // Remove files
    const fs = await import('fs');
    const path = await import('path');
    const userDir = path.join(process.cwd(), 'workflows', 'user');
    try {
      const manifestPath = path.join(userDir, `${id}.manifest.json`);
      if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
      if (mode.workflowFile) {
        const wfPath = path.join(userDir, mode.workflowFile);
        if (fs.existsSync(wfPath)) fs.unlinkSync(wfPath);
      }
    } catch { /* best effort */ }

    registry.removeMode(id);
    return reply.send({ status: 'deleted', id });
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
      const resumeSessionId =
        url.searchParams.get('sessionId') ??
        url.searchParams.get('session_id') ??
        undefined;
      const remoteAddress = request.ip;
      wsHandler.handleConnection(socket, remoteAddress, apiKey, resumeSessionId);
    }
  );

  return { conversationManager, wsHandler };
}
