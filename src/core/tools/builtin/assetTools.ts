/**
 * External Asset Tools - Upload and manage external assets.
 */

import type { ToolDefinition } from '../../llm/index.js';
import { createTool } from '../ToolRegistry.js';
import { getArtifactManager } from '../../../tasks/video/workflow/ArtifactManager.js';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { join, extname } from 'path';
import { PROJECT_DIR } from '../../../tasks/video/workflow/types.js';

interface OverlayConfig {
  target_artifact_id: string;
  position: 'top' | 'bottom' | 'fullscreen' | number;
  opacity?: number;
  layer?: number;
}

export const uploadExternalAssetTool: ToolDefinition = createTool(
  'upload_external_asset',
  `Upload an external image, video, audio, or overlay file to the project.

Use this to:
- Import reference images for characters/settings
- Add custom intro/outro videos
- Include background music
- Add overlay graphics/text

The file will be copied to the project's assets/external directory.`,
  {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path to the file to upload' },
      asset_type: {
        type: 'string',
        enum: ['image', 'video', 'audio', 'overlay'],
        description: 'Type of asset',
      },
      replaces_artifact_id: { type: 'string', description: 'Optional: artifact ID to replace' },
      overlay_config: {
        type: 'object',
        description: 'Optional: configuration for overlay placement',
        properties: {
          target_artifact_id: { type: 'string' },
          position: { type: 'string', enum: ['top', 'bottom', 'fullscreen'] },
          opacity: { type: 'number' },
          layer: { type: 'number' },
        },
      },
    },
    required: ['file_path', 'asset_type'],
  },
  async (args: Record<string, unknown>) => {
    const basePath = process.cwd();
    const filePath = args['file_path'] as string;
    const assetType = args['asset_type'] as 'image' | 'video' | 'audio' | 'overlay';

    if (!existsSync(filePath)) {
      return { status: 'error', message: `File not found: ${filePath}` };
    }

    const subdir = assetType === 'overlay' ? 'overlays' : `${assetType}s`;
    const destDir = join(basePath, PROJECT_DIR, 'assets', 'external', subdir);
    mkdirSync(destDir, { recursive: true });

    const ext = extname(filePath);
    const timestamp = Date.now();
    const destPath = join(destDir, `external_${timestamp}${ext}`);

    copyFileSync(filePath, destPath);

    if (args['replaces_artifact_id'] as string) {
      const manager = await getArtifactManager(basePath);
      const artifactId = (args['replaces_artifact_id'] as string).replace(
        /^(scene|char|setting)[-_]?/i,
        ''
      );
      try {
        await manager.replaceWithExternal(artifactId, destPath, assetType);
      } catch {
        return {
          status: 'success',
          asset_id: `external_${timestamp}`,
          path: destPath,
          message: 'Uploaded but artifact replacement failed.',
        };
      }
    }

    return {
      status: 'success',
      asset_id: `external_${timestamp}`,
      path: destPath,
      type: assetType,
      replaces: args['replaces_artifact_id'] || null,
      message: `Uploaded ${assetType} to ${destPath}`,
    };
  }
);

export const listExternalAssetsTool: ToolDefinition = createTool(
  'list_external_assets',
  `List all external assets in the project.`,
  {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['image', 'video', 'audio', 'overlay'] },
    },
  },
  async () => {
    const basePath = process.cwd();
    const { readdirSync, statSync } = await import('fs');
    const { join } = await import('path');

    const ext = join(basePath, PROJECT_DIR, 'assets', 'external');
    if (!existsSync(ext)) {
      return { status: 'success', assets: [], message: 'No external assets yet.' };
    }

    const assets: Array<{ id: string; type: string; path: string; size: number }> = [];

    for (const subdir of ['images', 'videos', 'audio', 'overlays']) {
      const dir = join(ext, subdir);
      if (existsSync(dir)) {
        for (const file of readdirSync(dir)) {
          const filePath = join(dir, file);
          const stats = statSync(filePath);
          assets.push({
            id: file.replace(/\.[^/.]+$/, ''),
            type: subdir.slice(0, -1),
            path: filePath,
            size: stats.size,
          });
        }
      }
    }

    return { status: 'success', total: assets.length, assets };
  }
);

export const deleteExternalAssetTool: ToolDefinition = createTool(
  'delete_external_asset',
  `Delete an external asset from the project.`,
  {
    type: 'object',
    properties: {
      asset_id: { type: 'string', description: 'ID of asset to delete' },
    },
    required: ['asset_id'],
  },
  async (args: Record<string, unknown>) => {
    const basePath = process.cwd();
    const assetId = args['asset_id'] as string;
    const { readdirSync, existsSync, unlinkSync } = await import('fs');
    const { join } = await import('path');

    for (const subdir of ['images', 'videos', 'audio', 'overlays']) {
      const dir = join(basePath, PROJECT_DIR, 'assets', 'external', subdir);
      if (existsSync(dir)) {
        for (const file of readdirSync(dir)) {
          if (file.startsWith(assetId) || file.includes(assetId)) {
            const filePath = join(dir, file);
            unlinkSync(filePath);
            return { status: 'success', asset_id: assetId, message: `Deleted ${filePath}` };
          }
        }
      }
    }

    return { status: 'error', message: `Asset "${assetId}" not found.` };
  }
);
