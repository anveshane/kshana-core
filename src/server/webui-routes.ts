/**
 * Web UI routes - serves the SPA and project/asset REST endpoints.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'fs';
import { join, extname, basename } from 'path';
import { scanProjects } from '../tasks/video/workflow/ProjectManager.js';
import { getWebUIHtml } from './webui.js';
import { builtInTemplates, initializeTemplates } from '../templates/index.js';

const DURATION_PRESETS: Record<string, { label: string; seconds: number }[]> = {
  short: [
    { label: '15 seconds', seconds: 15 },
    { label: '30 seconds', seconds: 30 },
    { label: '45 seconds', seconds: 45 },
    { label: '60 seconds', seconds: 60 },
  ],
  infomercial: [
    { label: '1 minute', seconds: 60 },
    { label: '1.5 minutes', seconds: 90 },
    { label: '2 minutes', seconds: 120 },
    { label: '3 minutes', seconds: 180 },
  ],
  narrative: [
    { label: '1 minute', seconds: 60 },
    { label: '2 minutes', seconds: 120 },
    { label: '3 minutes', seconds: 180 },
    { label: '5 minutes', seconds: 300 },
  ],
  documentary: [
    { label: '2 minutes', seconds: 120 },
    { label: '3 minutes', seconds: 180 },
    { label: '5 minutes', seconds: 300 },
    { label: '10 minutes', seconds: 600 },
  ],
  graphic_novel: [
    { label: '8 panels', seconds: 8 },
    { label: '16 panels', seconds: 16 },
    { label: '24 panels', seconds: 24 },
    { label: '32 panels', seconds: 32 },
  ],
};

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.json': 'application/json',
};

/**
 * Register web UI routes on the Fastify instance.
 * Serves the React frontend build from frontend/dist/ if available,
 * otherwise falls back to the inline SPA from webui.ts.
 */
export async function registerWebUIRoutes(app: FastifyInstance): Promise<void> {
  // Check for React frontend build
  const reactDistDir = join(process.cwd(), 'frontend', 'dist');
  const reactIndexPath = join(reactDistDir, 'index.html');
  const hasReactBuild = existsSync(reactIndexPath);

  if (hasReactBuild) {
    // Serve React frontend static assets (JS, CSS, etc.)
    const assetsDir = join(reactDistDir, 'assets');
    if (existsSync(assetsDir)) {
      app.get<{ Params: { '*': string } }>(
        '/assets/*',
        async (request: FastifyRequest<{ Params: { '*': string } }>, reply: FastifyReply) => {
          const filePath = request.params['*'];
          if (filePath.includes('..')) return reply.status(400).send({ error: 'Invalid path' });
          const fullPath = join(assetsDir, filePath);
          if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
            return reply.status(404).send({ error: 'Not found' });
          }
          const ext = extname(fullPath).toLowerCase();
          const contentType = MIME_TYPES[ext] ?? (ext === '.js' ? 'application/javascript' : 'application/octet-stream');
          return reply.type(contentType).send(readFileSync(fullPath));
        },
      );
    }

    // Serve favicon and other root-level static files
    app.get('/favicon.svg', async (_request: FastifyRequest, reply: FastifyReply) => {
      const faviconPath = join(reactDistDir, 'favicon.svg');
      if (existsSync(faviconPath)) {
        return reply.type('image/svg+xml').send(readFileSync(faviconPath));
      }
      return reply.status(404).send();
    });
  }

  // SPA fallback: serve React index.html or inline SPA
  const serveSPA = async (_request: FastifyRequest, reply: FastifyReply) => {
    if (hasReactBuild) {
      return reply.type('text/html').send(readFileSync(reactIndexPath, 'utf-8'));
    }
    return reply.type('text/html').send(getWebUIHtml());
  };
  app.get('/', serveSPA);
  app.get('/web', serveSPA);

  // List all projects
  app.get('/api/v1/projects', async (_request: FastifyRequest, reply: FastifyReply) => {
    const projects = scanProjects();
    return reply.send({ projects });
  });

  // Get a specific project's project.json
  app.get<{ Params: { name: string } }>(
    '/api/v1/projects/:name',
    async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
      const { name } = request.params;
      const projectDir = join(process.cwd(), `${name}.kshana`);
      const projectFile = join(projectDir, 'project.json');

      if (!existsSync(projectFile)) {
        return reply.status(404).send({ error: 'Project not found', name });
      }

      try {
        const data = JSON.parse(readFileSync(projectFile, 'utf-8'));
        return reply.send(data);
      } catch {
        return reply.status(500).send({ error: 'Failed to read project file' });
      }
    }
  );

  // List assets for a project
  app.get<{ Params: { name: string } }>(
    '/api/v1/projects/:name/assets',
    async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
      const { name } = request.params;
      const manifestPath = join(process.cwd(), `${name}.kshana`, 'assets', 'manifest.json');

      if (!existsSync(manifestPath)) {
        return reply.send({ assets: [] });
      }

      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        return reply.send({ assets: manifest.assets ?? [] });
      } catch {
        return reply.send({ assets: [] });
      }
    }
  );

  // Serve static asset files from project directories
  app.get<{ Params: { project: string; '*': string } }>(
    '/api/v1/assets/:project/*',
    async (request: FastifyRequest<{ Params: { project: string; '*': string } }>, reply: FastifyReply) => {
      const { project } = request.params;
      const filePath = request.params['*'];

      // Prevent path traversal
      if (filePath.includes('..')) {
        return reply.status(400).send({ error: 'Invalid path' });
      }

      const fullPath = join(process.cwd(), `${project}.kshana`, filePath);

      if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
        return reply.status(404).send({ error: 'Asset not found' });
      }

      const ext = extname(fullPath).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';

      const fileBuffer = readFileSync(fullPath);
      return reply.type(contentType).send(fileBuffer);
    }
  );

  // Upload a file — saves to uploads/ dir, returns the absolute path for the agent
  app.post<{ Querystring: { filename: string } }>(
    '/api/v1/upload',
    {
      config: {},
    },
    async (request: FastifyRequest<{ Querystring: { filename: string } }>, reply: FastifyReply) => {
      const filename = request.query.filename;
      if (!filename) {
        return reply.status(400).send({ error: 'filename query param required' });
      }
      const safeName = basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
      const uploadDir = join(process.cwd(), 'uploads');
      if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });

      const destPath = join(uploadDir, safeName);
      const body = request.body as Buffer;
      writeFileSync(destPath, body);

      return reply.send({
        name: filename,
        path: destPath,
        url: `/api/v1/uploads/${safeName}`,
      });
    }
  );

  // Serve uploaded files
  app.get<{ Params: { '*': string } }>(
    '/api/v1/uploads/*',
    async (request: FastifyRequest<{ Params: { '*': string } }>, reply: FastifyReply) => {
      const filePath = request.params['*'];
      if (filePath.includes('..')) {
        return reply.status(400).send({ error: 'Invalid path' });
      }
      const fullPath = join(process.cwd(), 'uploads', filePath);
      if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
        return reply.status(404).send({ error: 'File not found' });
      }
      const ext = extname(fullPath).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
      return reply.type(contentType).send(readFileSync(fullPath));
    }
  );

  // Get all templates with styles and duration presets
  app.get('/api/v1/templates', async (_request: FastifyRequest, reply: FastifyReply) => {
    initializeTemplates();
    const templates = builtInTemplates.map(t => ({
      id: t.id,
      displayName: t.displayName,
      description: t.description,
      defaultStyle: t.defaultStyle,
      styles: (t.styles || []).map((s: any) => ({
        id: s.id,
        displayName: s.displayName,
        description: s.description,
      })),
    }));
    return reply.send({ templates, durationPresets: DURATION_PRESETS });
  });

  // List image files in a project's assets directory (for browsing without manifest)
  app.get<{ Params: { name: string } }>(
    '/api/v1/projects/:name/images',
    async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
      const { name } = request.params;
      const imagesDir = join(process.cwd(), `${name}.kshana`, 'assets', 'images');

      if (!existsSync(imagesDir)) {
        return reply.send({ images: [] });
      }

      try {
        const files = readdirSync(imagesDir)
          .filter(f => ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extname(f).toLowerCase()))
          .map(f => ({
            name: f,
            url: `/api/v1/assets/${name}/assets/images/${f}`,
          }));
        return reply.send({ images: files });
      } catch {
        return reply.send({ images: [] });
      }
    }
  );
}
