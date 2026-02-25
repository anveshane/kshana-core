/**
 * Artifact tools - Fine-grained artifact editing and management.
 */

import type { ToolDefinition } from '../../llm/index.js';
import { createTool } from '../ToolRegistry.js';
import { getArtifactManager } from '../../../tasks/video/workflow/ArtifactManager.js';
import { createPromptRefiner } from '../../../tasks/video/workflow/PromptRefiner.js';
import { LLMClient, getLLMConfig } from '../../llm/index.js';
import { existsSync } from 'fs';

function getArtifactIdFromReference(ref: string): string {
  const sceneMatch = ref.match(/^scene[-_]?(\d+)$/i);
  if (sceneMatch && sceneMatch[1]) return `scene-${sceneMatch[1]}`;
  const charMatch = ref.match(/^char(?:acter)?[-_]?(.+)$/i);
  if (charMatch && charMatch[1]) return `char-${charMatch[1].toLowerCase().replace(/\s+/g, '_')}`;
  const settingMatch = ref.match(/^setting[-_]?(.+)$/i);
  if (settingMatch && settingMatch[1])
    return `setting-${settingMatch[1].toLowerCase().replace(/\s+/g, '_')}`;
  return ref;
}

export const regenerateArtifactTool: ToolDefinition = createTool(
  'regenerate_artifact',
  `Regenerate a specific artifact. Use artifact_id like "scene-3", "char-alice", "setting-library".`,
  {
    type: 'object',
    properties: {
      artifact_id: { type: 'string', description: 'ID of artifact to regenerate' },
      instruction: { type: 'string', description: 'Optional refinement instruction' },
    },
    required: ['artifact_id'],
  },
  async (args: Record<string, unknown>) => {
    const basePath = process.cwd();
    const manager = await getArtifactManager(basePath);
    const llm = new LLMClient(getLLMConfig());
    const artifactId = getArtifactIdFromReference(args['artifact_id'] as string);
    const artifact = manager.get(artifactId);

    if (!artifact) {
      const all = manager.getAll();
      if (all.length === 0) return { status: 'error', message: 'No artifacts found.' };
      return { status: 'error', message: `Not found. Available: ${all.map(a => a.id).join(', ')}` };
    }

    if (args['instruction']) {
      const refiner = createPromptRefiner(manager, llm);
      await refiner.refine(artifactId, args['instruction'] as string);
    }

    return { status: 'ready_to_generate', artifact_id: artifactId, prompt: artifact.prompt };
  }
);

export const replaceArtifactTool: ToolDefinition = createTool(
  'replace_artifact',
  `Replace a generated artifact with an external file.`,
  {
    type: 'object',
    properties: {
      artifact_id: { type: 'string' },
      file_path: { type: 'string' },
      asset_type: { type: 'string', enum: ['image', 'video', 'audio', 'overlay'] },
    },
    required: ['artifact_id', 'file_path', 'asset_type'],
  },
  async (args: Record<string, unknown>) => {
    const basePath = process.cwd();
    const manager = await getArtifactManager(basePath);
    const artifactId = getArtifactIdFromReference(args['artifact_id'] as string);
    const artifact = manager.get(artifactId);

    if (!artifact) return { status: 'error', message: `Artifact "${artifactId}" not found.` };
    if (!existsSync(args['file_path'] as string))
      return { status: 'error', message: 'File not found.' };

    try {
      await manager.replaceWithExternal(
        artifactId,
        args['file_path'] as string,
        args['asset_type'] as 'image' | 'video' | 'audio' | 'overlay'
      );
      const updated = manager.get(artifactId);
      return {
        status: 'success',
        artifact_id: artifactId,
        source: 'external',
        asset_path: updated?.assetPath,
      };
    } catch (error) {
      return { status: 'error', message: String(error) };
    }
  }
);

export const editPromptTool: ToolDefinition = createTool(
  'edit_prompt',
  `Edit a prompt conversationally. Provide feedback like "make it more dramatic".`,
  {
    type: 'object',
    properties: {
      artifact_id: { type: 'string' },
      feedback: { type: 'string', description: 'Changes wanted' },
    },
    required: ['artifact_id', 'feedback'],
  },
  async (args: Record<string, unknown>) => {
    const basePath = process.cwd();
    const manager = await getArtifactManager(basePath);
    const llm = new LLMClient(getLLMConfig());
    const artifactId = getArtifactIdFromReference(args['artifact_id'] as string);
    const artifact = manager.get(artifactId);

    if (!artifact) return { status: 'error', message: `Artifact "${artifactId}" not found.` };

    const refiner = createPromptRefiner(manager, llm);
    const refinement = await refiner.refine(artifactId, args['feedback'] as string);
    const currentVersion = manager.getVersion(artifactId, refinement.currentVersion);

    return {
      status: 'comparison_ready',
      artifact_id: artifactId,
      current_version: { version: currentVersion?.version, prompt: currentVersion?.prompt },
      proposed_version: {
        version: refinement.proposedVersion,
        prompt: refinement.proposedPrompt,
        changes: refinement.changes,
      },
    };
  }
);

export const comparePromptsTool: ToolDefinition = createTool(
  'compare_prompts',
  `Compare two prompt versions.`,
  {
    type: 'object',
    properties: {
      artifact_id: { type: 'string' },
      version_a: { type: 'number' },
      version_b: { type: 'number' },
    },
    required: ['artifact_id', 'version_a', 'version_b'],
  },
  async (args: Record<string, unknown>) => {
    const basePath = process.cwd();
    const manager = await getArtifactManager(basePath);
    const artifactId = getArtifactIdFromReference(args['artifact_id'] as string);

    try {
      const refiner = createPromptRefiner(manager, new LLMClient(getLLMConfig()));
      const comparison = refiner.getComparison(
        artifactId,
        args['version_a'] as number,
        args['version_b'] as number
      );
      return {
        status: 'success',
        version_a: {
          version: comparison.versionA.version,
          prompt: comparison.versionA.prompt,
          created_at: new Date(comparison.versionA.createdAt).toLocaleString(),
        },
        version_b: {
          version: comparison.versionB.version,
          prompt: comparison.versionB.prompt,
          created_at: new Date(comparison.versionB.createdAt).toLocaleString(),
        },
        diff: comparison.diff,
      };
    } catch (error) {
      return { status: 'error', message: String(error) };
    }
  }
);

export const restorePromptTool: ToolDefinition = createTool(
  'restore_prompt',
  `Restore a prompt to a previous version.`,
  {
    type: 'object',
    properties: {
      artifact_id: { type: 'string' },
      version: { type: 'number' },
    },
    required: ['artifact_id', 'version'],
  },
  async (args: Record<string, unknown>) => {
    const basePath = process.cwd();
    const manager = await getArtifactManager(basePath);
    const artifactId = getArtifactIdFromReference(args['artifact_id'] as string);

    try {
      manager.restoreVersion(artifactId, args['version'] as number);
      const restored = manager.getVersion(artifactId, args['version'] as number);
      return {
        status: 'success',
        artifact_id: artifactId,
        version: args['version'],
        prompt: restored?.prompt,
      };
    } catch (error) {
      return { status: 'error', message: String(error) };
    }
  }
);

export const jumpToArtifactTool: ToolDefinition = createTool(
  'jump_to',
  `Jump to a specific artifact.`,
  {
    type: 'object',
    properties: { artifact_id: { type: 'string' } },
    required: ['artifact_id'],
  },
  async (args: Record<string, unknown>) => {
    const basePath = process.cwd();
    const manager = await getArtifactManager(basePath);
    const artifactId = getArtifactIdFromReference(args['artifact_id'] as string);
    const artifact = manager.get(artifactId);

    if (!artifact) {
      const all = manager.getAll();
      const matching = all.filter(a => a.id.toLowerCase().includes(artifactId.toLowerCase()));
      if (matching.length > 0) {
        return {
          status: 'not_found',
          suggestions: matching.map(a => a.id),
          message: `Did you mean: ${matching.map(a => a.id).join(', ')}`,
        };
      }
      return { status: 'error', message: `Not found. Available: ${all.map(a => a.id).join(', ')}` };
    }

    const history = manager.getPromptHistory(artifactId);
    return {
      status: 'success',
      artifact: {
        id: artifact.id,
        type: artifact.type,
        status: artifact.status,
        prompt_version: artifact.promptVersion,
        prompt: artifact.prompt,
        history_length: history.length,
      },
      recent_history: history
        .slice(-3)
        .map(v => ({ version: v.version, created_at: new Date(v.createdAt).toLocaleString() })),
    };
  }
);

export const listArtifactsTool: ToolDefinition = createTool(
  'list_artifacts',
  `List all artifacts. Optional filter by type or status.`,
  {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['scene', 'character', 'setting', 'image', 'video', 'audio', 'overlay'],
      },
      status: { type: 'string', enum: ['pending', 'generating', 'complete', 'needs_review'] },
    },
  },
  async (args: Record<string, unknown>) => {
    const basePath = process.cwd();
    const manager = await getArtifactManager(basePath);
    let artifacts = manager.getAll();

    if (args['type']) artifacts = artifacts.filter(a => a.type === args['type']);
    if (args['status']) artifacts = artifacts.filter(a => a.status === args['status']);

    const byType = artifacts.reduce(
      (acc, a) => {
        if (!acc[a.type]) acc[a.type] = [];
        acc[a.type]!.push({
          id: a.id,
          status: a.status,
          source: a.source,
          prompt_version: a.promptVersion,
        });
        return acc;
      },
      {} as Record<
        string,
        Array<{ id: string; status: string; source: string; prompt_version: number }>
      >
    );

    return {
      status: 'success',
      total: artifacts.length,
      by_type: byType,
      needs_review: artifacts.filter(a => a.status === 'needs_review').length,
    };
  }
);

export const getArtifactStatusTool: ToolDefinition = createTool(
  'get_artifact_status',
  `Get detailed status of an artifact.`,
  {
    type: 'object',
    properties: { artifact_id: { type: 'string' } },
    required: ['artifact_id'],
  },
  async (args: Record<string, unknown>) => {
    const basePath = process.cwd();
    const manager = await getArtifactManager(basePath);
    const artifactId = getArtifactIdFromReference(args['artifact_id'] as string);
    const artifact = manager.get(artifactId);

    if (!artifact) return { status: 'not_found', artifact_id: args['artifact_id'] };

    const history = manager.getPromptHistory(artifactId);
    return {
      status: 'success',
      artifact: {
        id: artifact.id,
        type: artifact.type,
        status: artifact.status,
        source: artifact.source,
        prompt_version: artifact.promptVersion,
        prompt: artifact.prompt,
      },
      prompt_history: history.map(v => ({
        version: v.version,
        created_at: new Date(v.createdAt).toLocaleString(),
        feedback: v.feedback,
      })),
    };
  }
);
