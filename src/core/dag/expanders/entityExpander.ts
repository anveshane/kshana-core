/**
 * Entity Extraction Expander.
 *
 * Reads the approved story and extracts characters, settings, and scenes.
 * Then spawns per-entity node pipelines (character gen, approval, image prompt, image).
 *
 * This is the first and most critical expansion point — it determines the shape
 * of the entire downstream DAG.
 */

import type { NodeResult, NodeContext, DAGNodeDefinition, ValidationResult } from '../types.js';

// =============================================================================
// ENTITY TYPES
// =============================================================================

export interface ExtractedCharacter {
  name: string;
  role: 'protagonist' | 'antagonist' | 'supporting';
  description: string;
}

export interface ExtractedSetting {
  name: string;
  description: string;
}

export interface ExtractedScene {
  number: number;
  title: string;
  characters: string[];
  setting: string;
  summary: string;
}

export interface ExtractedEntities {
  characters: ExtractedCharacter[];
  settings: ExtractedSetting[];
  scenes: ExtractedScene[];
}

// =============================================================================
// SLUGIFY
// =============================================================================

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Validate the entity extraction result.
 * Checks for valid JSON, required fields, referential integrity, and limits.
 */
export function validateEntityExtraction(result: NodeResult): ValidationResult {
  if (!result.content) {
    return { valid: false, error: 'No content in result' };
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(result.content);
  } catch {
    return { valid: false, error: 'Not valid JSON' };
  }

  // Required arrays
  if (!Array.isArray(data['characters']) || (data['characters'] as unknown[]).length === 0) {
    return { valid: false, error: 'No characters extracted' };
  }
  if (!Array.isArray(data['settings']) || (data['settings'] as unknown[]).length === 0) {
    return { valid: false, error: 'No settings extracted' };
  }
  if (!Array.isArray(data['scenes']) || (data['scenes'] as unknown[]).length === 0) {
    return { valid: false, error: 'No scenes extracted' };
  }

  const characters = data['characters'] as ExtractedCharacter[];
  const settings = data['settings'] as ExtractedSetting[];
  const scenes = data['scenes'] as ExtractedScene[];

  // Required fields per entity
  for (const char of characters) {
    if (!char.name || !char.role) {
      return { valid: false, error: `Character missing name or role: ${JSON.stringify(char)}` };
    }
  }

  for (const setting of settings) {
    if (!setting.name) {
      return { valid: false, error: `Setting missing name: ${JSON.stringify(setting)}` };
    }
  }

  for (const scene of scenes) {
    if (scene.number === undefined || !scene.title) {
      return { valid: false, error: `Scene missing number or title: ${JSON.stringify(scene)}` };
    }
  }

  // Referential integrity — scene characters must exist in characters array
  const charNames = new Set(characters.map(c => c.name));
  const settingNames = new Set(settings.map(s => s.name));

  for (const scene of scenes) {
    if (scene.characters) {
      for (const charRef of scene.characters) {
        if (!charNames.has(charRef)) {
          return { valid: false, error: `Scene ${scene.number} references unknown character "${charRef}"` };
        }
      }
    }
    if (scene.setting && !settingNames.has(scene.setting)) {
      return { valid: false, error: `Scene ${scene.number} references unknown setting "${scene.setting}"` };
    }
  }

  // Template limits
  if (characters.length > 10) {
    return { valid: false, error: `Too many characters (${characters.length}, max 10)` };
  }
  if (scenes.length > 12) {
    return { valid: false, error: `Too many scenes (${scenes.length}, max 12)` };
  }

  return { valid: true, data: { characters, settings, scenes } };
}

// =============================================================================
// PROMPT BUILDER
// =============================================================================

/**
 * Build the LLM prompt for entity extraction.
 */
export function buildEntityExtractionPrompt(context: NodeContext): string {
  // Get the story content from the approved story result
  const storyResult = context.getResult('approve_story');
  const storyContent = storyResult.userResponse ?? storyResult.content ?? '';

  // Also get the original story generation result for full content
  let fullStory = storyContent;
  try {
    const genResult = context.getResult('generate_story');
    if (genResult.content) {
      fullStory = genResult.content;
    }
  } catch {
    // Use approval result if generation result not available
  }

  return `Read the following approved story and extract all entities.

<story>
${fullStory}
</story>

Return ONLY valid JSON matching this exact schema:
{
  "characters": [
    { "name": "string", "role": "protagonist|antagonist|supporting", "description": "one line" }
  ],
  "settings": [
    { "name": "string", "description": "one line" }
  ],
  "scenes": [
    { "number": 1, "title": "string", "characters": ["names appearing in scene"], "setting": "setting name", "summary": "one line" }
  ]
}

Rules:
- Every character mentioned by name in the story must be listed
- Every distinct location must be a setting
- Scenes should follow the story's natural structure
- Character names in scenes must exactly match names in the characters array
- Setting names in scenes must exactly match names in the settings array
- Do not invent characters or settings not present in the story`;
}

// =============================================================================
// EXPANDER
// =============================================================================

/**
 * Build entity nodes from extraction results.
 * Spawns per-character, per-setting, and scene-level pipelines.
 */
export function buildEntityNodes(result: NodeResult, _context: NodeContext): DAGNodeDefinition[] {
  let data: ExtractedEntities;
  if (result.data) {
    data = result.data as ExtractedEntities;
  } else {
    // Fallback: validate raw content before trusting it
    const validation = validateEntityExtraction(result);
    if (!validation.valid) {
      throw new Error(`buildEntityNodes: entity extraction failed validation — ${validation.error}`);
    }
    data = validation.data as ExtractedEntities;
  }
  const nodes: DAGNodeDefinition[] = [];

  // Per-character pipeline
  for (const char of data.characters) {
    const safeName = slugify(char.name);
    nodes.push(
      {
        id: `char_${safeName}_generate`,
        type: 'S',
        dependsOn: ['extract_entities'],
        description: `Generate character description for ${char.name}`,
        metadata: { characterName: char.name, role: char.role, description: char.description },
        handlerKey: 'character_generate',
      },
      {
        id: `char_${safeName}_approve`,
        type: 'U',
        dependsOn: [`char_${safeName}_generate`],
        description: `Approve character: ${char.name}`,
        handlerKey: 'character_approve',
        metadata: { characterName: char.name },
      },
      {
        id: `char_${safeName}_img_prompt`,
        type: 'S',
        dependsOn: [`char_${safeName}_approve`],
        description: `Generate image prompt for ${char.name}`,
        handlerKey: 'character_img_prompt',
        metadata: { characterName: char.name },
      },
      {
        id: `char_${safeName}_img`,
        type: 'S',
        dependsOn: [`char_${safeName}_img_prompt`],
        description: `Generate reference image for ${char.name}`,
        handlerKey: 'character_img_generate',
        metadata: { characterName: char.name },
        errorPolicy: { maxRetries: 3, retryStrategy: 'same', retryDelayMs: 10000, onExhausted: 'ask_user' },
      },
    );
  }

  // Per-setting pipeline
  for (const setting of data.settings) {
    const safeName = slugify(setting.name);
    nodes.push(
      {
        id: `setting_${safeName}_generate`,
        type: 'S',
        dependsOn: ['extract_entities'],
        description: `Generate setting description for ${setting.name}`,
        metadata: { settingName: setting.name, description: setting.description },
        handlerKey: 'setting_generate',
      },
      {
        id: `setting_${safeName}_approve`,
        type: 'U',
        dependsOn: [`setting_${safeName}_generate`],
        description: `Approve setting: ${setting.name}`,
        handlerKey: 'setting_approve',
        metadata: { settingName: setting.name },
      },
      {
        id: `setting_${safeName}_img_prompt`,
        type: 'S',
        dependsOn: [`setting_${safeName}_approve`],
        description: `Generate image prompt for ${setting.name}`,
        handlerKey: 'setting_img_prompt',
        metadata: { settingName: setting.name },
      },
      {
        id: `setting_${safeName}_img`,
        type: 'S',
        dependsOn: [`setting_${safeName}_img_prompt`],
        description: `Generate reference image for ${setting.name}`,
        handlerKey: 'setting_img_generate',
        metadata: { settingName: setting.name },
        errorPolicy: { maxRetries: 3, retryStrategy: 'same', retryDelayMs: 10000, onExhausted: 'ask_user' },
      },
    );
  }

  // Scene generation depends on ALL character + setting approvals
  const allCharApprovals = data.characters.map(c => `char_${slugify(c.name)}_approve`);
  const allSettingApprovals = data.settings.map(s => `setting_${slugify(s.name)}_approve`);

  nodes.push(
    {
      id: 'generate_scenes',
      type: 'S',
      dependsOn: [...allCharApprovals, ...allSettingApprovals],
      description: 'Generate detailed scenes',
      metadata: { sceneStructure: data.scenes },
      handlerKey: 'scenes_generate',
    },
    {
      id: 'approve_scenes',
      type: 'U',
      dependsOn: ['generate_scenes'],
      description: 'Approve generated scenes',
      handlerKey: 'scenes_approve',
    },
    {
      id: 'create_timeline',
      type: 'D',
      dependsOn: ['approve_scenes'],
      description: 'Create initial timeline structure',
      handlerKey: 'create_timeline',
    },
    {
      id: 'expand_scenes',
      type: 'D',
      dependsOn: ['approve_scenes'],
      description: 'Expand scenes into shot pipelines',
      handlerKey: 'expand_scenes_handler',
      expanderKey: 'scene_expander',
    },
  );

  return nodes;
}
