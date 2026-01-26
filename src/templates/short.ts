/**
 * YouTube Short Video Template
 *
 * Template for creating short-form vertical video content.
 * Optimized for quick, engaging content under 60 seconds.
 *
 * Flow: hook → script → key_visuals → visual_images → visual_videos → final
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

const hookArtifact: ArtifactTypeDefinition = {
  id: 'hook',
  displayName: 'Hook',
  category: 'concept',
  description: 'The attention-grabbing hook that starts the short',
  isCollection: false,
  outputFormat: 'markdown',
  filePattern: 'plans/hook.md',
  agentType: 'planning',
  promptFile: 'short/hook.md',
  isExpensive: false,
  requiresPerItemApproval: false,
  dependencies: [],
  metadataSchema: {
    hookType: { type: 'string', required: false, description: 'Type of hook (question, statement, visual)' },
    targetEmotion: { type: 'string', required: false, description: 'Emotion to evoke' },
  },
};

const scriptArtifact: ArtifactTypeDefinition = {
  id: 'script',
  displayName: 'Script',
  category: 'structure',
  description: 'The complete script for the short with timing and visuals',
  isCollection: false,
  outputFormat: 'markdown',
  filePattern: 'plans/script.md',
  agentType: 'content',
  promptFile: 'short/script.md',
  isExpensive: false,
  requiresPerItemApproval: false,
  dependencies: [
    {
      artifactTypeId: 'hook',
      required: true,
      usage: 'context',
    },
  ],
  metadataSchema: {
    totalDuration: { type: 'number', required: false, description: 'Target duration in seconds' },
    hasVoiceover: { type: 'boolean', required: false, description: 'Whether script includes voiceover' },
  },
};

const keyVisualArtifact: ArtifactTypeDefinition = {
  id: 'key_visual',
  displayName: 'Key Visuals',
  category: 'segment',
  description: 'Key visual moments/shots in the short (max 5 for shorts)',
  isCollection: true,
  itemName: 'visual',
  maxItems: 5,
  outputFormat: 'markdown',
  filePattern: 'visuals/visual_{{index}}.md',
  agentType: 'content',
  promptFile: 'short/key-visual.md',
  isExpensive: false,
  requiresPerItemApproval: true,
  dependencies: [
    {
      artifactTypeId: 'script',
      required: true,
      usage: 'context',
    },
  ],
  metadataSchema: {
    timestamp: { type: 'string', required: true, description: 'When this visual appears (e.g., "0:00-0:05")' },
    visualType: { type: 'string', required: false, description: 'Type of visual (action, text overlay, transition)' },
    textOverlay: { type: 'string', required: false, description: 'Text to overlay if any' },
  },
};

const visualImageArtifact: ArtifactTypeDefinition = {
  id: 'visual_image',
  displayName: 'Visual Images',
  category: 'visual_ref',
  description: 'Generated images for each key visual moment',
  isCollection: true,
  itemName: 'image',
  outputFormat: 'image',
  filePattern: 'assets/images/visuals/visual_{{index}}.png',
  agentType: 'image',
  promptFile: 'short/visual-image.md',
  isExpensive: true,
  requiresPerItemApproval: true,
  dependencies: [
    {
      artifactTypeId: 'key_visual',
      required: true,
      usage: 'context',
      scope: 'matching',
    },
  ],
  metadataSchema: {
    visualId: { type: 'string', required: true, description: 'ID of the key visual' },
    aspectRatio: { type: 'string', required: false, description: 'Aspect ratio (9:16 for shorts)' },
  },
};

const visualVideoArtifact: ArtifactTypeDefinition = {
  id: 'visual_video',
  displayName: 'Visual Clips',
  category: 'clip',
  description: 'Short video clips for each key visual',
  isCollection: true,
  itemName: 'clip',
  outputFormat: 'video',
  filePattern: 'assets/videos/visuals/visual_{{index}}.mp4',
  agentType: 'video',
  promptFile: 'short/visual-video.md',
  isExpensive: true,
  requiresPerItemApproval: true,
  dependencies: [
    {
      artifactTypeId: 'key_visual',
      required: true,
      usage: 'context',
      scope: 'matching',
    },
    {
      artifactTypeId: 'visual_image',
      required: true,
      usage: 'input',
      scope: 'matching',
    },
  ],
  metadataSchema: {
    visualId: { type: 'string', required: true, description: 'ID of the key visual' },
    duration: { type: 'number', required: false, description: 'Clip duration in seconds' },
  },
};

const finalShortArtifact: ArtifactTypeDefinition = {
  id: 'final_short',
  displayName: 'Final Short',
  category: 'final',
  description: 'The assembled final YouTube short',
  isCollection: false,
  outputFormat: 'video',
  filePattern: 'assets/videos/final/{{name}}.mp4',
  agentType: 'video',
  promptFile: 'short/final-short.md',
  isExpensive: true,
  requiresPerItemApproval: false,
  dependencies: [
    {
      artifactTypeId: 'visual_video',
      required: true,
      usage: 'input',
      scope: 'all',
    },
  ],
  metadataSchema: {
    totalDuration: { type: 'number', required: false, description: 'Total duration (max 60s)' },
    resolution: { type: 'object', required: false, description: 'Video resolution (1080x1920 for shorts)' },
  },
};

// =============================================================================
// INPUT TYPE CONFIGURATIONS
// =============================================================================

const hookIdeaInput: InputTypeConfig = {
  id: 'hook_idea',
  displayName: 'Hook/Idea',
  description: 'A quick hook, idea, or concept for a short video',
  examples: [
    'POV: You discover time travel is real',
    '5 things you didn\'t know about coffee',
    'This one trick changed my morning routine',
  ],
  skipsArtifacts: [],
  mapsToArtifact: 'hook',
  detectionPatterns: [
    {
      type: 'length',
      config: { maxLength: 200 },
      weight: 3,
    },
    {
      type: 'keywords',
      config: { keywords: ['pov', 'things you', 'this', 'watch', 'wait for', 'shorts', 'quick'], minMatches: 1 },
      weight: 2,
    },
  ],
};

const scriptInput: InputTypeConfig = {
  id: 'script',
  displayName: 'Full Script',
  description: 'A complete script for the short video',
  examples: [
    'A timed script with visual directions',
    'Shot-by-shot breakdown with text overlays',
  ],
  skipsArtifacts: ['hook', 'script'],
  mapsToArtifact: 'script',
  detectionPatterns: [
    {
      type: 'length',
      config: { minLength: 200, maxLength: 1000 },
      weight: 2,
    },
    {
      type: 'keywords',
      config: { keywords: ['shot', 'cut to', 'text:', 'visual:', 'voiceover', 'seconds'], minMatches: 2 },
      weight: 3,
    },
  ],
};

// =============================================================================
// PHASE DEFINITIONS
// =============================================================================

const phases: PhaseDefinition[] = [
  {
    id: 'concept',
    displayName: 'Hook Development',
    description: 'Create the attention-grabbing hook',
    order: 1,
    artifactTypes: ['hook'],
    requiresConfirmation: false,
    promptFile: 'short/phases/concept.md',
  },
  {
    id: 'scripting',
    displayName: 'Script Writing',
    description: 'Write the complete short script',
    order: 2,
    artifactTypes: ['script'],
    requiresConfirmation: false,
    promptFile: 'short/phases/scripting.md',
  },
  {
    id: 'visuals',
    displayName: 'Visual Planning',
    description: 'Plan the key visual moments',
    order: 3,
    artifactTypes: ['key_visual'],
    requiresConfirmation: false,
    promptFile: 'short/phases/visuals.md',
  },
  {
    id: 'images',
    displayName: 'Image Generation',
    description: 'Generate images for each visual',
    order: 4,
    artifactTypes: ['visual_image'],
    requiresConfirmation: true,
    promptFile: 'short/phases/images.md',
  },
  {
    id: 'clips',
    displayName: 'Clip Generation',
    description: 'Generate video clips',
    order: 5,
    artifactTypes: ['visual_video'],
    requiresConfirmation: true,
    promptFile: 'short/phases/clips.md',
  },
  {
    id: 'assembly',
    displayName: 'Final Assembly',
    description: 'Assemble the final short',
    order: 6,
    artifactTypes: ['final_short'],
    requiresConfirmation: true,
    promptFile: 'short/phases/assembly.md',
  },
];

// =============================================================================
// STYLE CONFIGURATIONS
// =============================================================================

const styles: StyleConfig[] = [
  {
    id: 'viral_aesthetic',
    displayName: 'Viral Aesthetic',
    description: 'High-contrast, attention-grabbing style popular on social media',
    promptModifiers: [
      'viral aesthetic',
      'high contrast',
      'vibrant colors',
      'eye-catching',
      'social media style',
      'trending',
      'vertical format',
    ],
    negativePrompt: [
      'boring',
      'muted colors',
      'low contrast',
      'blurry',
      'horizontal format',
    ],
    comfySettings: {
      sampler: 'dpmpp_2m_sde',
      scheduler: 'karras',
      steps: 25,
      cfg: 8,
    },
  },
  {
    id: 'cinematic_short',
    displayName: 'Cinematic Short',
    description: 'Film-quality look adapted for vertical format',
    promptModifiers: [
      'cinematic',
      'film quality',
      'dramatic',
      'vertical format',
      'high quality',
      'professional',
    ],
    negativePrompt: [
      'amateur',
      'low quality',
      'blurry',
      'horizontal',
    ],
    comfySettings: {
      sampler: 'dpmpp_2m_sde',
      scheduler: 'karras',
      steps: 30,
      cfg: 7.5,
    },
  },
  {
    id: 'lo_fi',
    displayName: 'Lo-Fi Aesthetic',
    description: 'Retro, nostalgic lo-fi visual style',
    promptModifiers: [
      'lo-fi aesthetic',
      'retro',
      'film grain',
      'nostalgic',
      'warm tones',
      'vintage',
    ],
    negativePrompt: [
      'modern',
      'clean',
      'digital',
      'sharp',
      'clinical',
    ],
    comfySettings: {
      sampler: 'euler',
      scheduler: 'normal',
      steps: 25,
      cfg: 7,
    },
  },
  {
    id: 'minimal_clean',
    displayName: 'Minimal & Clean',
    description: 'Clean, minimalist style with focus on content',
    promptModifiers: [
      'minimal',
      'clean',
      'simple',
      'modern',
      'professional',
      'white space',
    ],
    negativePrompt: [
      'cluttered',
      'busy',
      'noisy',
      'chaotic',
      'low quality',
    ],
    comfySettings: {
      sampler: 'dpmpp_2m',
      scheduler: 'normal',
      steps: 25,
      cfg: 7,
    },
  },
];

// =============================================================================
// SHORT TEMPLATE
// =============================================================================

export const shortTemplate: VideoTemplate = {
  id: 'short',
  displayName: 'YouTube Short',
  description: 'Create a vertical short-form video optimized for YouTube Shorts, TikTok, and Instagram Reels. Maximum 60 seconds with punchy visuals.',
  version: '3.0.0',
  defaultStyle: 'viral_aesthetic',
  styles,
  inputTypes: [hookIdeaInput, scriptInput],
  artifactTypes: {
    hook: hookArtifact,
    script: scriptArtifact,
    key_visual: keyVisualArtifact,
    visual_image: visualImageArtifact,
    visual_video: visualVideoArtifact,
    final_short: finalShortArtifact,
  },
  phases,
  constraints: {
    maxSegments: 5, // Keep shorts punchy
    maxDuration: 60, // YouTube Shorts limit
    minDuration: 15, // Minimum for engagement
  },
  contextVariables: {
    $original_input: 'hook',
    $hook: 'hook',
    $script: 'script',
    $visuals: 'key_visual',
  },
  orchestratorPrompt: 'short/orchestrator.md',
};

export default shortTemplate;
