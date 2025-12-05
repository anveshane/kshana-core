/**
 * Project state management for video creation tasks.
 * Handles persistence of story, characters, settings, storyboard, and assets.
 */
import { createTool } from '../../core/tools/index.js';
import type { ToolDefinition } from '../../core/llm/index.js';

/**
 * Character definition in project state.
 */
export interface Character {
  name: string;
  description: string;
  visualDescription: string;
  personality?: string;
  backstory?: string;
  referenceImageId?: string;
}

/**
 * Setting/environment definition in project state.
 */
export interface Setting {
  name: string;
  description: string;
  visualDescription: string;
  mood?: string;
  referenceImageId?: string;
}

/**
 * Storyboard scene definition.
 */
export interface StoryboardScene {
  sceneNumber: number;
  description: string;
  characters: string[];
  setting: string;
  action: string;
  dialogue?: string;
  imagePrompt: string;
  imageArtifactId?: string;
  duration?: number;
}

/**
 * Complete project state.
 */
export interface ProjectState {
  id: string;
  title?: string;
  plot?: string;
  characters: Map<string, Character>;
  settings: Map<string, Setting>;
  storyboard: StoryboardScene[];
  assets: Map<string, { type: string; path: string; metadata?: Record<string, unknown> }>;
  createdAt: number;
  updatedAt: number;
}

// In-memory project state (would be persisted to DB in production)
const projects = new Map<string, ProjectState>();
let currentProjectId: string | null = null;

/**
 * Get or create the current project.
 */
function getCurrentProject(): ProjectState {
  if (!currentProjectId) {
    currentProjectId = `proj-${Date.now()}`;
  }

  let project = projects.get(currentProjectId);
  if (!project) {
    project = {
      id: currentProjectId,
      characters: new Map(),
      settings: new Map(),
      storyboard: [],
      assets: new Map(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    projects.set(currentProjectId, project);
  }

  return project;
}

/**
 * Read project state tool.
 */
export const readProjectStateTool: ToolDefinition = createTool(
  'read_project_state',
  `Read saved project data to check what has already been created.

Query types:
- "summary": Get overview of all saved data
- "plot": Get the story plot
- "characters": Get all character profiles
- "character:<name>": Get specific character
- "settings": Get all setting descriptions
- "setting:<name>": Get specific setting
- "storyboard": Get all storyboard scenes
- "assets": Get list of generated assets`,
  {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'What to read: summary, plot, characters, settings, storyboard, assets, or specific item',
      },
    },
    required: ['query'],
  },
  async (args) => {
    const query = (args['query'] as string).toLowerCase();
    const project = getCurrentProject();

    if (query === 'summary') {
      return {
        project_id: project.id,
        title: project.title ?? '(untitled)',
        has_plot: !!project.plot,
        character_count: project.characters.size,
        setting_count: project.settings.size,
        scene_count: project.storyboard.length,
        asset_count: project.assets.size,
        created_at: project.createdAt,
        updated_at: project.updatedAt,
      };
    }

    if (query === 'plot') {
      return {
        plot: project.plot ?? '(not yet defined)',
        title: project.title ?? '(untitled)',
      };
    }

    if (query === 'characters') {
      const chars: Record<string, Character> = {};
      project.characters.forEach((v, k) => (chars[k] = v));
      return {
        count: project.characters.size,
        characters: chars,
      };
    }

    if (query.startsWith('character:')) {
      const name = query.slice('character:'.length).trim();
      const char = project.characters.get(name);
      if (!char) {
        return { error: `Character not found: ${name}` };
      }
      return char;
    }

    if (query === 'settings') {
      const sets: Record<string, Setting> = {};
      project.settings.forEach((v, k) => (sets[k] = v));
      return {
        count: project.settings.size,
        settings: sets,
      };
    }

    if (query.startsWith('setting:')) {
      const name = query.slice('setting:'.length).trim();
      const setting = project.settings.get(name);
      if (!setting) {
        return { error: `Setting not found: ${name}` };
      }
      return setting;
    }

    if (query === 'storyboard') {
      return {
        scene_count: project.storyboard.length,
        scenes: project.storyboard,
      };
    }

    if (query === 'assets') {
      const assetList: Array<{ id: string; type: string; path: string }> = [];
      project.assets.forEach((v, k) => assetList.push({ id: k, ...v }));
      return {
        count: project.assets.size,
        assets: assetList,
      };
    }

    return { error: `Unknown query: ${query}` };
  }
);

/**
 * Write project state tool.
 */
export const writeProjectStateTool: ToolDefinition = createTool(
  'write_project_state',
  `Save data to the project state. Use this to persist your work.

Data types:
- "title": Set the project title
- "plot": Save the story plot
- "character": Save a character profile (requires name in data)
- "setting": Save a setting/environment (requires name in data)
- "storyboard_scene": Save or update a storyboard scene (requires sceneNumber)
- "storyboard": Replace entire storyboard (array of scenes)
- "asset": Register a generated asset (requires artifactId)`,
  {
    type: 'object',
    properties: {
      data_type: {
        type: 'string',
        description: 'Type of data to save',
        enum: ['title', 'plot', 'character', 'setting', 'storyboard_scene', 'storyboard', 'asset'],
      },
      data: {
        type: 'object',
        description: 'The data to save (structure depends on data_type)',
      },
    },
    required: ['data_type', 'data'],
  },
  async (args) => {
    const dataType = args['data_type'] as string;
    const data = args['data'] as Record<string, unknown>;
    const project = getCurrentProject();

    try {
      switch (dataType) {
        case 'title':
          project.title = data['title'] as string;
          break;

        case 'plot':
          project.plot = data['plot'] as string;
          break;

        case 'character': {
          const char: Character = {
            name: data['name'] as string,
            description: data['description'] as string,
            visualDescription: data['visual_description'] as string,
            personality: data['personality'] as string | undefined,
            backstory: data['backstory'] as string | undefined,
            referenceImageId: data['reference_image_id'] as string | undefined,
          };
          if (!char.name) {
            return { status: 'error', error: 'Character name is required' };
          }
          project.characters.set(char.name, char);
          break;
        }

        case 'setting': {
          const setting: Setting = {
            name: data['name'] as string,
            description: data['description'] as string,
            visualDescription: data['visual_description'] as string,
            mood: data['mood'] as string | undefined,
            referenceImageId: data['reference_image_id'] as string | undefined,
          };
          if (!setting.name) {
            return { status: 'error', error: 'Setting name is required' };
          }
          project.settings.set(setting.name, setting);
          break;
        }

        case 'storyboard_scene': {
          const scene: StoryboardScene = {
            sceneNumber: data['scene_number'] as number,
            description: data['description'] as string,
            characters: data['characters'] as string[],
            setting: data['setting'] as string,
            action: data['action'] as string,
            dialogue: data['dialogue'] as string | undefined,
            imagePrompt: data['image_prompt'] as string,
            imageArtifactId: data['image_artifact_id'] as string | undefined,
            duration: data['duration'] as number | undefined,
          };
          // Update existing or append
          const existingIdx = project.storyboard.findIndex(
            (s) => s.sceneNumber === scene.sceneNumber
          );
          if (existingIdx >= 0) {
            project.storyboard[existingIdx] = scene;
          } else {
            project.storyboard.push(scene);
            project.storyboard.sort((a, b) => a.sceneNumber - b.sceneNumber);
          }
          break;
        }

        case 'storyboard': {
          const scenes = data['scenes'] as Array<Record<string, unknown>>;
          project.storyboard = scenes.map((s) => ({
            sceneNumber: s['scene_number'] as number,
            description: s['description'] as string,
            characters: s['characters'] as string[],
            setting: s['setting'] as string,
            action: s['action'] as string,
            dialogue: s['dialogue'] as string | undefined,
            imagePrompt: s['image_prompt'] as string,
            imageArtifactId: s['image_artifact_id'] as string | undefined,
            duration: s['duration'] as number | undefined,
          }));
          break;
        }

        case 'asset': {
          const assetId = data['artifact_id'] as string;
          if (!assetId) {
            return { status: 'error', error: 'Artifact ID is required' };
          }
          project.assets.set(assetId, {
            type: data['type'] as string,
            path: data['path'] as string,
            metadata: data['metadata'] as Record<string, unknown> | undefined,
          });
          break;
        }

        default:
          return { status: 'error', error: `Unknown data type: ${dataType}` };
      }

      project.updatedAt = Date.now();

      return {
        status: 'success',
        message: `Saved ${dataType} to project state`,
        project_id: project.id,
        updated_at: project.updatedAt,
      };
    } catch (error) {
      return {
        status: 'error',
        error: String(error),
      };
    }
  }
);

/**
 * Get all project state tools.
 */
export function getProjectStateTools(): ToolDefinition[] {
  return [readProjectStateTool, writeProjectStateTool];
}

/**
 * Reset project state (for testing or starting fresh).
 */
export function resetProjectState(): void {
  currentProjectId = null;
}

/**
 * Set the current project ID (for session management).
 */
export function setCurrentProjectId(id: string): void {
  currentProjectId = id;
}
