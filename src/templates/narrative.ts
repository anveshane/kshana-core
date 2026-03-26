/**
 * Narrative Video Template
 *
 * Template for creating narrative/story-based videos.
 * This is a refactoring of the original 8-phase workflow into the generic template system.
 *
 * Flow: plot → story → characters/settings → scenes → ref_images → shot_breakdown → shot_images → shot_videos → final
 */

import type {
  VideoTemplate,
  ArtifactTypeDefinition,
  InputTypeConfig,
  PhaseDefinition,
  StyleConfig,
} from '../core/templates/types.js';

// =============================================================================
// ARTIFACT TYPE DEFINITIONS
// =============================================================================

const plotArtifact: ArtifactTypeDefinition = {
  id: 'plot',
  displayName: 'Plot Outline',
  category: 'concept',
  description: 'High-level plot outline with main story beats and structure',
  scope: 'chapter',
  isCollection: false,
  outputFormat: 'markdown',
  filePattern: 'chapters/{{chapter}}/plans/plot.md',
  agentType: 'planning',
  promptFile: 'narrative/plot.md',
  isExpensive: false,
  requiresPerItemApproval: false,
  dependencies: [],
};

const storyArtifact: ArtifactTypeDefinition = {
  id: 'story',
  displayName: 'Full Story',
  category: 'structure',
  description: 'Complete narrative story with dialogue, descriptions, and emotional beats',
  scope: 'chapter',
  isCollection: false,
  outputFormat: 'markdown',
  filePattern: 'chapters/{{chapter}}/plans/story.md',
  agentType: 'content',
  promptFile: 'narrative/story.md',
  isExpensive: false,
  requiresPerItemApproval: false,
  dependencies: [
    {
      artifactTypeId: 'plot',
      required: true,
      usage: 'context',
    },
  ],
};

const characterArtifact: ArtifactTypeDefinition = {
  id: 'character',
  displayName: 'Characters',
  category: 'entity',
  description: 'Character descriptions including appearance, personality, and visual details',
  scope: 'project',
  isCollection: true,
  itemName: 'character',
  maxItems: 10,
  outputFormat: 'markdown',
  filePattern: 'characters/{{name}}.md',
  agentType: 'content',
  promptFile: 'narrative/character.md',
  isExpensive: false,
  requiresPerItemApproval: true,
  dependencies: [
    {
      artifactTypeId: 'story',
      required: true,
      usage: 'context',
    },
  ],
  metadataSchema: {
    gender: { type: 'string', required: false, description: 'Character gender' },
    age: { type: 'string', required: false, description: 'Character age or age range' },
    role: { type: 'string', required: false, description: 'Role in the story (protagonist, antagonist, etc.)' },
  },
};

const settingArtifact: ArtifactTypeDefinition = {
  id: 'setting',
  displayName: 'Settings',
  category: 'environment',
  description: 'Location/environment descriptions with visual details for image generation',
  scope: 'project',
  isCollection: true,
  itemName: 'setting',
  maxItems: 10,
  outputFormat: 'markdown',
  filePattern: 'settings/{{name}}.md',
  agentType: 'content',
  promptFile: 'narrative/setting.md',
  isExpensive: false,
  requiresPerItemApproval: true,
  dependencies: [
    {
      artifactTypeId: 'story',
      required: true,
      usage: 'context',
    },
  ],
  metadataSchema: {
    timeOfDay: { type: 'string', required: false, description: 'Time of day for the setting' },
    weather: { type: 'string', required: false, description: 'Weather conditions' },
    mood: { type: 'string', required: false, description: 'Emotional mood of the setting' },
  },
};

const sceneArtifact: ArtifactTypeDefinition = {
  id: 'scene',
  displayName: 'Scenes',
  category: 'segment',
  description: 'Individual scene descriptions with action, dialogue, and visual direction',
  scope: 'chapter',
  isCollection: true,
  itemName: 'scene',
  maxItems: 12,
  outputFormat: 'markdown',
  filePattern: 'chapters/{{chapter}}/scenes/scene_{{index}}.md',
  agentType: 'content',
  promptFile: 'narrative/scene.md',
  isExpensive: false,
  requiresPerItemApproval: true,
  dependencies: [
    {
      artifactTypeId: 'story',
      required: true,
      usage: 'context',
    },
    {
      artifactTypeId: 'character',
      required: true,
      usage: 'context',
      scope: 'all',
    },
    {
      artifactTypeId: 'setting',
      required: true,
      usage: 'context',
      scope: 'all',
    },
  ],
  metadataSchema: {
    characters: { type: 'array', required: true, description: 'Characters appearing in this scene' },
    setting: { type: 'string', required: true, description: 'Setting where scene takes place' },
    duration: { type: 'number', required: false, description: 'Estimated duration in seconds' },
  },
};

const characterImageArtifact: ArtifactTypeDefinition = {
  id: 'character_image',
  displayName: 'Character Reference Images',
  category: 'visual_ref',
  description: 'Reference images for characters to ensure visual consistency',
  scope: 'project',
  isCollection: true,
  itemName: 'character image',
  outputFormat: 'image',
  filePattern: 'assets/images/characters/{{name}}.png',
  agentType: 'image',
  promptFile: 'common/character-image.md',
  isExpensive: true,
  requiresPerItemApproval: true,
  dependencies: [
    {
      artifactTypeId: 'character',
      required: true,
      usage: 'context',
      scope: 'matching',
    },
  ],
  metadataSchema: {
    characterId: { type: 'string', required: true, description: 'ID of the source character' },
    seed: { type: 'number', required: false, description: 'Generation seed for reproducibility' },
  },
};

const settingImageArtifact: ArtifactTypeDefinition = {
  id: 'setting_image',
  displayName: 'Setting Reference Images',
  category: 'visual_ref',
  description: 'Reference images for settings/locations to ensure visual consistency',
  scope: 'project',
  isCollection: true,
  itemName: 'setting image',
  outputFormat: 'image',
  filePattern: 'assets/images/settings/{{name}}.png',
  agentType: 'image',
  promptFile: 'common/setting-image.md',
  isExpensive: true,
  requiresPerItemApproval: true,
  dependencies: [
    {
      artifactTypeId: 'setting',
      required: true,
      usage: 'context',
      scope: 'matching',
    },
  ],
  metadataSchema: {
    settingId: { type: 'string', required: true, description: 'ID of the source setting' },
    seed: { type: 'number', required: false, description: 'Generation seed for reproducibility' },
  },
};

const sceneVideoPromptArtifact: ArtifactTypeDefinition = {
  id: 'scene_video_prompt',
  displayName: 'Multi-Shot Motion Prompts',
  category: 'structure',
  description: 'Multi-shot breakdown of each scene into 2-4 cinematic shots with motion/camera direction',
  scope: 'chapter',
  isCollection: true,
  itemName: 'motion prompt',
  outputFormat: 'json',
  filePattern: 'prompts/videos/scenes/scene-{{index}}.motion.json',
  agentType: 'content',
  promptFile: 'narrative/scene-video-prompt.md',
  isExpensive: false,
  requiresPerItemApproval: true,
  dependencies: [
    { artifactTypeId: 'scene', required: true, usage: 'context', scope: 'matching' },
    { artifactTypeId: 'character_image', required: true, usage: 'reference', scope: 'all' },
    { artifactTypeId: 'setting_image', required: true, usage: 'reference', scope: 'all' },
  ],
};

const shotImagePromptArtifact: ArtifactTypeDefinition = {
  id: 'shot_image_prompt',
  displayName: 'Shot Image Prompts',
  category: 'structure',
  description: 'Per-shot image generation prompts with reference image integration for visual consistency',
  scope: 'chapter',
  isCollection: true,
  itemName: 'shot prompt',
  outputFormat: 'markdown',
  filePattern: 'prompts/images/shots/scene-{{index}}-shot-{{subindex}}.json',
  agentType: 'content',
  promptFile: 'narrative/shot-image-prompt.md',
  isExpensive: false,
  requiresPerItemApproval: false,
  dependencies: [
    // Only depends on scene_video_prompt for the shot structure + character/setting IDs.
    // Reference images (character_image, setting_image) are resolved by refId at
    // ComfyUI generation time, NOT at prompt generation time. This allows shot prompts
    // to be generated in parallel with image generation.
    { artifactTypeId: 'scene_video_prompt', required: true, usage: 'context', scope: 'matching' },
  ],
};

// shot_video: generates a video clip from each shot image using the motion prompt
// A scene is an array of shots — each shot starts with a shot image
const shotVideoArtifact: ArtifactTypeDefinition = {
  id: 'shot_video',
  displayName: 'Shot Videos',
  category: 'clip',
  description: 'Video clips for each shot, generated from shot images with motion prompts',
  scope: 'chapter',
  isCollection: true,
  itemName: 'shot video',
  outputFormat: 'video',
  filePattern: 'assets/videos/shots/scene-{{index}}-shot-{{subindex}}.mp4',
  agentType: 'video',
  promptFile: 'common/shot-video.md',
  isExpensive: true,
  requiresPerItemApproval: true,
  dependencies: [
    {
      artifactTypeId: 'shot_image_prompt',
      required: true,
      usage: 'input',
      scope: 'matching',
    },
  ],
  metadataSchema: {
    shotNumber: { type: 'number', required: true, description: 'Shot number within the scene' },
    duration: { type: 'number', required: false, description: 'Shot duration in seconds' },
  },
};

const finalVideoArtifact: ArtifactTypeDefinition = {
  id: 'final_video',
  displayName: 'Final Video',
  category: 'final',
  description: 'The assembled final video combining all scene videos',
  scope: 'chapter',
  isCollection: false,
  outputFormat: 'video',
  filePattern: 'chapters/{{chapter}}/assets/videos/final/{{name}}.mp4',
  agentType: 'video',
  promptFile: 'common/final-video.md',
  isExpensive: true,
  requiresPerItemApproval: false,
  dependencies: [
    {
      artifactTypeId: 'shot_video',
      required: true,
      usage: 'input',
      scope: 'all',
    },
  ],
  metadataSchema: {
    totalDuration: { type: 'number', required: false, description: 'Total video duration' },
    resolution: { type: 'object', required: false, description: 'Video resolution' },
  },
};

// =============================================================================
// INPUT TYPE CONFIGURATIONS
// =============================================================================

const ideaInput: InputTypeConfig = {
  id: 'idea',
  displayName: 'Story Idea',
  description: 'A brief story idea, concept, or premise that will be developed into a full narrative',
  examples: [
    'A robot learns to love',
    'Two strangers meet on a train and discover they share a secret',
    'A chef must save their restaurant from closure',
  ],
  skipsArtifacts: [],
  mapsToArtifact: 'plot',
  detectionPatterns: [
    {
      type: 'length',
      config: { maxLength: 500 },
      weight: 3,
    },
    {
      type: 'keywords',
      config: { keywords: ['about', 'story about', 'idea', 'concept', 'what if', 'create a', 'make a'], minMatches: 1 },
      weight: 1,
    },
  ],
};

const storyInput: InputTypeConfig = {
  id: 'story',
  displayName: 'Complete Story',
  description: 'A fully written story with scenes, dialogue, and descriptions',
  examples: [
    'A complete short story manuscript',
    'A screenplay or script',
    'A detailed narrative with multiple scenes',
  ],
  skipsArtifacts: ['plot', 'story'],
  mapsToArtifact: 'story',
  detectionPatterns: [
    // Long content is likely a story (>800 chars)
    {
      type: 'length',
      config: { minLength: 800 },
      weight: 3,
    },
    // Even longer content is very likely a story (>2000 chars)
    {
      type: 'length',
      config: { minLength: 2000 },
      weight: 2,
    },
    // Has paragraphs (at least 2 paragraph breaks)
    {
      type: 'structure',
      config: { hasParagraphs: true },
      weight: 2,
    },
    // Has dialogue markers
    {
      type: 'structure',
      config: { hasDialogue: true },
      weight: 2,
    },
    // Contains narrative keywords (only need 2 matches)
    {
      type: 'keywords',
      config: {
        keywords: [
          'said', 'asked', 'replied', 'whispered', 'shouted',  // dialogue tags
          'walked', 'looked', 'turned', 'ran', 'sat', 'stood',  // action verbs
          'chapter', 'scene', 'INT.', 'EXT.',  // structure markers
          'she', 'he', 'they', 'her', 'his', 'their',  // pronouns (narrative)
          'morning', 'evening', 'night', 'day',  // time markers
        ],
        minMatches: 2,
      },
      weight: 2,
    },
  ],
};

// =============================================================================
// PHASE DEFINITIONS
// =============================================================================

const phases: PhaseDefinition[] = [
  {
    id: 'concept',
    displayName: 'Concept Development',
    description: 'Develop the core story concept and plot outline',
    order: 1,
    artifactTypes: ['plot'],
    requiresConfirmation: false,
    promptFile: 'narrative/phases/concept.md',
  },
  {
    id: 'narrative',
    displayName: 'Story Writing',
    description: 'Write the full narrative story',
    order: 2,
    artifactTypes: ['story'],
    requiresConfirmation: false,
    promptFile: 'narrative/phases/narrative.md',
  },
  {
    id: 'breakdown',
    displayName: 'Story Breakdown',
    description: 'Break down the story into characters, settings, and scenes',
    order: 3,
    artifactTypes: ['character', 'setting', 'scene'],
    requiresConfirmation: false,
    promptFile: 'narrative/phases/breakdown.md',
  },
  {
    id: 'reference_images',
    displayName: 'Reference Image Generation',
    description: 'Generate reference images for characters and settings',
    order: 4,
    artifactTypes: ['character_image', 'setting_image'],
    requiresConfirmation: true,
    promptFile: 'narrative/phases/reference-images.md',
  },
  {
    id: 'shot_breakdown',
    displayName: 'Shot Breakdown',
    description: 'Break scenes into cinematic shots and generate per-shot image prompts',
    order: 5,
    artifactTypes: ['scene_video_prompt', 'shot_image_prompt'],
    requiresConfirmation: true,
    promptFile: 'narrative/phases/shot-breakdown.md',
  },
  {
    id: 'shot_videos',
    displayName: 'Shot Video Generation',
    description: 'Generate video clips for each shot from shot images',
    order: 6,
    artifactTypes: ['shot_video'],
    requiresConfirmation: true,
    promptFile: 'narrative/phases/shot-videos.md',
  },
  {
    id: 'final_assembly',
    displayName: 'Final Assembly',
    description: 'Assemble all shot videos into the final video',
    order: 7,
    artifactTypes: ['final_video'],
    requiresConfirmation: true,
    promptFile: 'narrative/phases/final-assembly.md',
  },
];

// =============================================================================
// STYLE CONFIGURATIONS
// =============================================================================

const styles: StyleConfig[] = [
  {
    id: 'cinematic_realism',
    displayName: 'Cinematic Realism',
    description: 'Photorealistic cinematic style with dramatic lighting',
    promptModifiers: [
      'cinematic',
      'photorealistic',
      'dramatic lighting',
      'film grain',
      'depth of field',
      '8k resolution',
      'professional photography',
    ],
    negativePrompt: [
      'cartoon',
      'anime',
      'illustration',
      'painting',
      'drawing',
      'sketch',
      'low quality',
      'blurry',
    ],
    comfySettings: {
      sampler: 'dpmpp_2m_sde',
      scheduler: 'karras',
      steps: 30,
      cfg: 7.5,
    },
  },
  {
    id: 'anime',
    displayName: 'Anime',
    description: 'Japanese anime art style',
    promptModifiers: [
      'anime',
      'anime style',
      'high quality anime',
      'detailed anime',
      'vibrant colors',
      'clean lines',
    ],
    negativePrompt: [
      'photorealistic',
      'photograph',
      'realistic',
      '3d render',
      'low quality',
      'blurry',
      'bad anatomy',
    ],
    comfySettings: {
      sampler: 'euler_ancestral',
      scheduler: 'normal',
      steps: 25,
      cfg: 8,
    },
  },
  {
    id: 'stylized_3d',
    displayName: 'Stylized 3D',
    description: 'Pixar/Disney-style 3D animation look',
    promptModifiers: [
      '3d render',
      'pixar style',
      'disney style',
      'stylized',
      'vibrant',
      'detailed',
      'high quality 3d',
    ],
    negativePrompt: [
      'photorealistic',
      'anime',
      '2d',
      'flat',
      'low quality',
      'blurry',
    ],
    comfySettings: {
      sampler: 'dpmpp_2m',
      scheduler: 'karras',
      steps: 28,
      cfg: 7,
    },
  },
  {
    id: 'watercolor',
    displayName: 'Watercolor',
    description: 'Soft watercolor painting style',
    promptModifiers: [
      'watercolor',
      'watercolor painting',
      'soft colors',
      'flowing',
      'artistic',
      'delicate brushstrokes',
    ],
    negativePrompt: [
      'photorealistic',
      'photograph',
      '3d',
      'digital art',
      'sharp edges',
      'low quality',
    ],
    comfySettings: {
      sampler: 'euler',
      scheduler: 'normal',
      steps: 25,
      cfg: 7,
    },
  },
];

// =============================================================================
// NARRATIVE TEMPLATE
// =============================================================================

export const narrativeTemplate: VideoTemplate = {
  id: 'narrative',
  displayName: 'Narrative Story Video',
  description: 'Create a video from a story idea or complete narrative. Perfect for short films, animated stories, and visual storytelling.',
  version: '3.0.0',
  defaultStyle: 'cinematic_realism',
  styles,
  inputTypes: [ideaInput, storyInput],
  artifactTypes: {
    plot: plotArtifact,
    story: storyArtifact,
    character: characterArtifact,
    setting: settingArtifact,
    scene: sceneArtifact,
    character_image: characterImageArtifact,
    setting_image: settingImageArtifact,
    scene_video_prompt: sceneVideoPromptArtifact,
    shot_image_prompt: shotImagePromptArtifact,
    shot_video: shotVideoArtifact,
    final_video: finalVideoArtifact,
  },
  phases,
  constraints: {
    maxSegments: 12,
    maxEntities: 10,
    maxDuration: 300, // 5 minutes
  },
  contextVariables: {
    $original_input: 'plot', // Original input maps to plot processing
    $plot: 'plot',
    $story: 'story',
    $characters: 'character',
    $settings: 'setting',
    $scenes: 'scene',
  },
  orchestratorPrompt: 'narrative/orchestrator.md',
};

export default narrativeTemplate;
