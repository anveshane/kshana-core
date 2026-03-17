/**
 * Singleton Remotion rendering service.
 * Manages session-scoped working directories, bundle caching,
 * concurrency limiting, and child process rendering.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { nanoid } from 'nanoid';
import { registerChildProcess } from '../../utils/processRegistry.js';
import { getPhaseLogger } from '../../utils/phaseLogger.js';
import { getProjectDir } from '../../tasks/video/workflow/ProjectManager.js';
import type {
  RenderRequest,
  RenderJob,
  PlacementResult,
  RenderProgress,
} from './types.js';

const logger = getPhaseLogger();

/** Environment-configurable concurrency limit */
function getMaxConcurrent(): number {
  const raw = process.env['REMOTION_MAX_CONCURRENT'];
  if (!raw) return 3;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) || n < 1 ? 3 : n;
}

function getBuildTimeout(): number {
  const raw = process.env['REMOTION_BUILD_TIMEOUT'];
  if (!raw) return 120_000;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) || n < 1000 ? 120_000 : n;
}

function getRenderTimeout(): number {
  const raw = process.env['REMOTION_RENDER_TIMEOUT'];
  if (!raw) return 600_000;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) || n < 1000 ? 600_000 : n;
}

/**
 * Generate the index.tsx content that registers all compositions.
 */
function generateIndexTsx(placementNumbers: number[]): string {
  const imports = placementNumbers
    .map((n) => `import { Infographic${n} } from './components/Infographic${n}';`)
    .join('\n');

  const compositions = placementNumbers
    .map(
      (n) => `      <Composition
        id="Infographic${n}"
        // @ts-ignore
        component={Infographic${n}}
        durationInFrames={5 * fps}
        fps={fps}
        width={1920}
        height={1080}
        defaultProps={{
          prompt: '',
          infographicType: 'statistic',
          data: {},
        }}
      />`
    )
    .join('\n');

  return `import React from 'react';
import { Composition, registerRoot } from 'remotion';
${imports}

const fps = 24;

const RemotionRoot: React.FC = () => {
  return (
    <>
${compositions}
    </>
  );
};

registerRoot(RemotionRoot);
`;
}

/**
 * Hash a file's content for cache invalidation.
 */
function hashFile(filePath: string): string {
  if (!fs.existsSync(filePath)) return '';
  const content = fs.readFileSync(filePath, 'utf-8');
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export class RemotionRenderer {
  private static instance: RemotionRenderer | null = null;

  private jobs = new Map<string, RenderJob>();
  private activeConcurrent = 0;
  private pendingQueue: Array<() => void> = [];
  private maxConcurrent: number;
  private bundleCacheHash: string | null = null;
  private remotionProjectDir: string;

  private constructor() {
    this.maxConcurrent = getMaxConcurrent();
    this.remotionProjectDir = path.resolve(process.cwd(), 'remotion-infographics');
  }

  static getInstance(): RemotionRenderer {
    if (!RemotionRenderer.instance) {
      RemotionRenderer.instance = new RemotionRenderer();
    }
    return RemotionRenderer.instance;
  }

  /**
   * Get the session working directory for generated components.
   */
  private getSessionDir(sessionId: string): string {
    return path.join(getProjectDir(), 'sessions', sessionId, 'remotion');
  }

  /**
   * Set up the session working directory with generated components.
   * Copies the base project structure and writes session-specific components.
   */
  private setupSessionDir(request: RenderRequest): string {
    const sessionDir = this.getSessionDir(request.sessionId);
    const srcDir = path.join(sessionDir, 'src');
    const componentsDir = path.join(srcDir, 'components');

    // Create directory structure
    fs.mkdirSync(componentsDir, { recursive: true });

    // Copy base project files
    const filesToCopy = ['package.json', 'tsconfig.json', 'render.mts'];
    for (const file of filesToCopy) {
      const src = path.join(this.remotionProjectDir, file);
      const dest = path.join(sessionDir, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
      }
    }

    // Copy shared utilities
    const sharedSrcDir = path.join(this.remotionProjectDir, 'src', 'shared');
    const sharedDestDir = path.join(srcDir, 'shared');
    if (fs.existsSync(sharedSrcDir)) {
      fs.mkdirSync(sharedDestDir, { recursive: true });
      for (const file of fs.readdirSync(sharedSrcDir)) {
        fs.copyFileSync(path.join(sharedSrcDir, file), path.join(sharedDestDir, file));
      }
    }

    // Copy base Infographic.tsx
    const baseInfographic = path.join(this.remotionProjectDir, 'src', 'Infographic.tsx');
    if (fs.existsSync(baseInfographic)) {
      fs.copyFileSync(baseInfographic, path.join(srcDir, 'Infographic.tsx'));
    }

    // Write generated components
    const placementNumbers: number[] = [];
    for (const [placementNumber, code] of request.componentCodes) {
      const componentFile = path.join(componentsDir, `Infographic${placementNumber}.tsx`);
      fs.writeFileSync(componentFile, code, 'utf-8');
      placementNumbers.push(placementNumber);
    }

    // Generate and write index.tsx
    const indexContent = generateIndexTsx(placementNumbers);
    fs.writeFileSync(path.join(srcDir, 'index.tsx'), indexContent, 'utf-8');

    // Symlink node_modules from base project if available
    const baseNodeModules = path.join(this.remotionProjectDir, 'node_modules');
    const sessionNodeModules = path.join(sessionDir, 'node_modules');
    if (fs.existsSync(baseNodeModules) && !fs.existsSync(sessionNodeModules)) {
      try {
        fs.symlinkSync(baseNodeModules, sessionNodeModules, 'dir');
      } catch {
        // Fallback: copy if symlink fails (e.g., cross-device)
        logger.warn('remotion', 'setup', 'Could not symlink node_modules, session will use base project path');
      }
    }

    return sessionDir;
  }

  /**
   * Check if the base bundle is still valid (package.json unchanged).
   */
  private isBundleCacheValid(): boolean {
    const pkgPath = path.join(this.remotionProjectDir, 'package.json');
    const currentHash = hashFile(pkgPath);
    return this.bundleCacheHash !== null && this.bundleCacheHash === currentHash;
  }

  /**
   * Build the Remotion bundle in the session directory.
   */
  private buildBundle(sessionDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = getBuildTimeout();
      logger.info('remotion', 'build', `Building Remotion bundle in ${sessionDir}`, { timeout });

      const buildProcess = spawn('npx', ['remotion', 'bundle', 'src/index.tsx'], {
        cwd: sessionDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout,
      });
      registerChildProcess(buildProcess);

      let stderr = '';
      buildProcess.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      buildProcess.on('close', (code) => {
        if (code === 0) {
          // Update bundle cache hash
          const pkgPath = path.join(this.remotionProjectDir, 'package.json');
          this.bundleCacheHash = hashFile(pkgPath);
          logger.info('remotion', 'build', 'Remotion bundle built successfully');
          resolve();
        } else {
          logger.error('remotion', 'build', `Remotion bundle build failed (exit code ${code})`, { stderr: stderr.slice(0, 500) });
          reject(new Error(`Remotion bundle build failed (exit code ${code}):\n${stderr}`));
        }
      });

      buildProcess.on('error', (err) => {
        reject(new Error(`Failed to start Remotion build: ${err.message}`));
      });
    });
  }

  /**
   * Run the render script in a child process.
   */
  private renderPlacements(
    sessionDir: string,
    request: RenderRequest,
    job: RenderJob,
  ): Promise<PlacementResult[]> {
    return new Promise((resolve, reject) => {
      const timeout = getRenderTimeout();
      const inputPath = path.join(sessionDir, '_render_input.json');
      const outputPath = path.join(sessionDir, '_render_output.json');
      const outDir = request.outputDir;

      // Write render input
      const renderInput = {
        placements: request.placements.map((p) => ({
          ...p,
          componentName: `Infographic${p.placementNumber}`,
        })),
      };
      fs.writeFileSync(inputPath, JSON.stringify(renderInput), 'utf-8');

      logger.info('remotion', 'render', `Rendering ${request.placements.length} placements`, { timeout });

      const renderProcess = spawn(
        'npx',
        ['tsx', 'render.mts', '--input', inputPath, '--outDir', outDir, '--output', outputPath],
        {
          cwd: sessionDir,
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout,
          env: {
            ...process.env,
            REMOTION_RENDER_TIMEOUT: String(timeout),
          },
        },
      );
      registerChildProcess(renderProcess);

      let stderr = '';

      renderProcess.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (line.startsWith('REMOTION_PROGRESS:')) {
            try {
              const progress = JSON.parse(line.slice('REMOTION_PROGRESS:'.length)) as RenderProgress;
              job.progress = Math.round(progress.progress * 100);
              job.placementProgress.set(progress.placementIndex, progress.progress);
              job.updatedAt = Date.now();
            } catch {
              // Ignore malformed progress
            }
          }
        }
      });

      renderProcess.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      renderProcess.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputPath)) {
          try {
            const raw = fs.readFileSync(outputPath, 'utf-8');
            const { outputs } = JSON.parse(raw) as { outputs: string[] };
            const results: PlacementResult[] = request.placements.map((p, i) => ({
              placementNumber: p.placementNumber,
              status: outputs[i] ? 'completed' as const : 'failed' as const,
              outputPath: outputs[i],
            }));
            logger.info('remotion', 'render', `Render completed: ${results.filter((r) => r.status === 'completed').length}/${results.length} succeeded`);
            resolve(results);
          } catch (err) {
            reject(new Error(`Failed to parse render output: ${err}`));
          }
        } else {
          logger.error('remotion', 'render', `Render failed (exit code ${code})`, { stderr: stderr.slice(0, 500) });
          reject(new Error(`Remotion render failed (exit code ${code}):\n${stderr}`));
        }
      });

      renderProcess.on('error', (err) => {
        reject(new Error(`Failed to start Remotion render: ${err.message}`));
      });
    });
  }

  /**
   * Acquire a concurrency slot. Waits if at capacity.
   */
  private async acquireSlot(): Promise<void> {
    if (this.activeConcurrent < this.maxConcurrent) {
      this.activeConcurrent++;
      return;
    }
    return new Promise((resolve) => {
      this.pendingQueue.push(() => {
        this.activeConcurrent++;
        resolve();
      });
    });
  }

  /**
   * Release a concurrency slot.
   */
  private releaseSlot(): void {
    this.activeConcurrent--;
    const next = this.pendingQueue.shift();
    if (next) next();
  }

  /**
   * Submit a render request and return a job ID.
   */
  async render(request: RenderRequest): Promise<string> {
    const jobId = `remotion-${nanoid(8)}`;
    const job: RenderJob = {
      id: jobId,
      sessionId: request.sessionId,
      status: 'pending',
      progress: 0,
      placementProgress: new Map(),
      results: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.jobs.set(jobId, job);

    // Run async — don't block the caller
    this.executeRender(request, job).catch((err) => {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : String(err);
      job.updatedAt = Date.now();
    });

    return jobId;
  }

  /**
   * Execute the full render pipeline for a job.
   */
  private async executeRender(request: RenderRequest, job: RenderJob): Promise<void> {
    await this.acquireSlot();
    try {
      // 1. Set up session directory
      job.status = 'bundling';
      job.updatedAt = Date.now();
      const sessionDir = this.setupSessionDir(request);

      // 2. Build bundle
      await this.buildBundle(sessionDir);

      // 3. Render placements
      job.status = 'rendering';
      job.updatedAt = Date.now();
      const results = await this.renderPlacements(sessionDir, request, job);

      // 4. Finalize
      job.results = results;
      const allSucceeded = results.every((r) => r.status === 'completed');
      job.status = allSucceeded ? 'completed' : 'failed';
      job.progress = 100;
      if (!allSucceeded) {
        const failedPlacements = results.filter((r) => r.status === 'failed');
        job.error = `${failedPlacements.length} placement(s) failed to render`;
      }
      job.updatedAt = Date.now();
    } finally {
      this.releaseSlot();
    }
  }

  /**
   * Get the current status of a render job.
   */
  getJobStatus(jobId: string): RenderJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Clean up all resources for a session.
   */
  cleanupSession(sessionId: string): void {
    // Remove jobs for this session
    for (const [jobId, job] of this.jobs) {
      if (job.sessionId === sessionId) {
        this.jobs.delete(jobId);
      }
    }

    // Remove session directory
    const sessionDir = this.getSessionDir(sessionId);
    if (fs.existsSync(sessionDir)) {
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        logger.info('remotion', 'cleanup', `Cleaned up session directory: ${sessionDir}`);
      } catch (err) {
        logger.warn('remotion', 'cleanup', `Failed to clean up session directory ${sessionDir}: ${err}`);
      }
    }
  }

  /**
   * Check if a job ID belongs to the Remotion renderer.
   */
  static isRemotionJobId(jobId: string): boolean {
    return jobId.startsWith('remotion-');
  }
}
