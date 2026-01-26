/**
 * Documentary Video Template
 *
 * Template for creating documentary-style videos.
 * Focuses on research, evidence, and informational content.
 *
 * Flow: thesis → outline → sources/locations → segments → visuals → videos → final
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

const thesisArtifact: ArtifactTypeDefinition = {
  id: 'thesis',
  displayName: 'Thesis Statement',
  category: 'concept',
  description: 'Central thesis or question the documentary explores',
  isCollection: false,
  outputFormat: 'markdown',
  filePattern: 'plans/thesis.md',
  agentType: 'planning',
  promptFile: 'documentary/thesis.md',
  isExpensive: false,
  requiresPerItemApproval: false,
  dependencies: [],
};

const outlineArtifact: ArtifactTypeDefinition = {
  id: 'outline',
  displayName: 'Research Outline',
  category: 'structure',
  description: 'Structured outline organizing the documentary content and arguments',
  isCollection: false,
  outputFormat: 'markdown',
  filePattern: 'plans/outline.md',
  agentType: 'content',
  promptFile: 'documentary/outline.md',
  isExpensive: false,
  requiresPerItemApproval: false,
  dependencies: [
    {
      artifactTypeId: 'thesis',
      required: true,
      usage: 'context',
    },
  ],
};

const sourceArtifact: ArtifactTypeDefinition = {
  id: 'source',
  displayName: 'Sources & Experts',
  category: 'entity',
  description: 'Sources, experts, or interviewees referenced in the documentary',
  isCollection: true,
  itemName: 'source',
  maxItems: 8,
  outputFormat: 'markdown',
  filePattern: 'sources/{{name}}.md',
  agentType: 'content',
  promptFile: 'documentary/source.md',
  isExpensive: false,
  requiresPerItemApproval: true,
  dependencies: [
    {
      artifactTypeId: 'outline',
      required: true,
      usage: 'context',
    },
  ],
  metadataSchema: {
    type: { type: 'string', required: true, description: 'Type of source (expert, study, organization)' },
    credibility: { type: 'string', required: false, description: 'Credibility notes' },
    quotable: { type: 'boolean', required: false, description: 'Whether quotes can be attributed' },
  },
};

const locationArtifact: ArtifactTypeDefinition = {
  id: 'location',
  displayName: 'Locations & B-Roll',
  category: 'environment',
  description: 'Locations and b-roll footage concepts for the documentary',
  isCollection: true,
  itemName: 'location',
  maxItems: 10,
  outputFormat: 'markdown',
  filePattern: 'locations/{{name}}.md',
  agentType: 'content',
  promptFile: 'documentary/location.md',
  isExpensive: false,
  requiresPerItemApproval: true,
  dependencies: [
    {
      artifactTypeId: 'outline',
      required: true,
      usage: 'context',
    },
  ],
  metadataSchema: {
    type: { type: 'string', required: true, description: 'Type (interview location, establishing shot, b-roll)' },
    mood: { type: 'string', required: false, description: 'Visual mood or atmosphere' },
  },
};

const segmentArtifact: ArtifactTypeDefinition = {
  id: 'segment',
  displayName: 'Documentary Segments',
  category: 'segment',
  description: 'Individual segments or chapters of the documentary',
  isCollection: true,
  itemName: 'segment',
  maxItems: 10,
  outputFormat: 'markdown',
  filePattern: 'segments/segment_{{index}}.md',
  agentType: 'content',
  promptFile: 'documentary/segment.md',
  isExpensive: false,
  requiresPerItemApproval: true,
  dependencies: [
    {
      artifactTypeId: 'outline',
      required: true,
      usage: 'context',
    },
    {
      artifactTypeId: 'source',
      required: false,
      usage: 'context',
      scope: 'all',
    },
    {
      artifactTypeId: 'location',
      required: false,
      usage: 'context',
      scope: 'all',
    },
  ],
  metadataSchema: {
    title: { type: 'string', required: true, description: 'Segment title' },
    sources: { type: 'array', required: false, description: 'Sources referenced in this segment' },
    locations: { type: 'array', required: false, description: 'Locations featured in this segment' },
    duration: { type: 'number', required: false, description: 'Estimated duration in seconds' },
    narration: { type: 'string', required: false, description: 'Narration script for this segment' },
  },
};

const sourceGraphicArtifact: ArtifactTypeDefinition = {
  id: 'source_graphic',
  displayName: 'Source Graphics',
  category: 'visual_ref',
  description: 'Graphics representing sources, experts, or data visualizations',
  isCollection: true,
  itemName: 'source graphic',
  outputFormat: 'image',
  filePattern: 'assets/images/sources/{{name}}.png',
  agentType: 'image',
  promptFile: 'documentary/source-graphic.md',
  isExpensive: true,
  requiresPerItemApproval: true,
  dependencies: [
    {
      artifactTypeId: 'source',
      required: true,
      usage: 'context',
      scope: 'matching',
    },
  ],
  metadataSchema: {
    sourceId: { type: 'string', required: true, description: 'ID of the source this represents' },
    graphicType: { type: 'string', required: false, description: 'Type of graphic (portrait, chart, infographic)' },
  },
};

const locationImageArtifact: ArtifactTypeDefinition = {
  id: 'location_image',
  displayName: 'Location Images',
  category: 'visual_ref',
  description: 'Images of locations and b-roll visuals',
  isCollection: true,
  itemName: 'location image',
  outputFormat: 'image',
  filePattern: 'assets/images/locations/{{name}}.png',
  agentType: 'image',
  promptFile: 'documentary/location-image.md',
  isExpensive: true,
  requiresPerItemApproval: true,
  dependencies: [
    {
      artifactTypeId: 'location',
      required: true,
      usage: 'context',
      scope: 'matching',
    },
  ],
  metadataSchema: {
    locationId: { type: 'string', required: true, description: 'ID of the location this represents' },
  },
};

const segmentImageArtifact: ArtifactTypeDefinition = {
  id: 'segment_image',
  displayName: 'Segment Images',
  category: 'visual_ref',
  description: 'Key images for each documentary segment',
  isCollection: true,
  itemName: 'segment image',
  outputFormat: 'image',
  filePattern: 'assets/images/segments/segment_{{index}}.png',
  agentType: 'image',
  promptFile: 'documentary/segment-image.md',
  isExpensive: true,
  requiresPerItemApproval: true,
  dependencies: [
    {
      artifactTypeId: 'segment',
      required: true,
      usage: 'context',
      scope: 'matching',
    },
    {
      artifactTypeId: 'source_graphic',
      required: false,
      usage: 'reference',
      scope: 'matching',
    },
    {
      artifactTypeId: 'location_image',
      required: false,
      usage: 'reference',
      scope: 'matching',
    },
  ],
  metadataSchema: {
    segmentId: { type: 'string', required: true, description: 'ID of the source segment' },
  },
};

const segmentVideoArtifact: ArtifactTypeDefinition = {
  id: 'segment_video',
  displayName: 'Segment Videos',
  category: 'clip',
  description: 'Video clips for each documentary segment',
  isCollection: true,
  itemName: 'segment video',
  outputFormat: 'video',
  filePattern: 'assets/videos/segments/segment_{{index}}.mp4',
  agentType: 'video',
  promptFile: 'common/segment-video.md',
  isExpensive: true,
  requiresPerItemApproval: true,
  dependencies: [
    {
      artifactTypeId: 'segment',
      required: true,
      usage: 'context',
      scope: 'matching',
    },
    {
      artifactTypeId: 'segment_image',
      required: true,
      usage: 'input',
      scope: 'matching',
    },
  ],
  metadataSchema: {
    segmentId: { type: 'string', required: true, description: 'ID of the source segment' },
    duration: { type: 'number', required: false, description: 'Video duration in seconds' },
  },
};

const finalVideoArtifact: ArtifactTypeDefinition = {
  id: 'final_video',
  displayName: 'Final Documentary',
  category: 'final',
  description: 'The assembled final documentary video',
  isCollection: false,
  outputFormat: 'video',
  filePattern: 'assets/videos/final/{{name}}.mp4',
  agentType: 'video',
  promptFile: 'common/final-video.md',
  isExpensive: true,
  requiresPerItemApproval: false,
  dependencies: [
    {
      artifactTypeId: 'segment_video',
      required: true,
      usage: 'input',
      scope: 'all',
    },
  ],
  metadataSchema: {
    totalDuration: { type: 'number', required: false, description: 'Total documentary duration' },
  },
};

// =============================================================================
// INPUT TYPE CONFIGURATIONS
// =============================================================================

const topicInput: InputTypeConfig = {
  id: 'topic',
  displayName: 'Documentary Topic',
  description: 'A topic or question to explore in documentary format',
  examples: [
    'How does climate change affect coral reefs?',
    'The history of artificial intelligence',
    'Why do people believe in conspiracy theories?',
  ],
  skipsArtifacts: [],
  mapsToArtifact: 'thesis',
  detectionPatterns: [
    {
      type: 'length',
      config: { maxLength: 300 },
      weight: 2,
    },
    {
      type: 'keywords',
      config: { keywords: ['how', 'why', 'what', 'history of', 'impact of', 'documentary about'], minMatches: 1 },
      weight: 2,
    },
  ],
};

const outlineInput: InputTypeConfig = {
  id: 'outline',
  displayName: 'Research Outline',
  description: 'A pre-written research outline or documentary structure',
  examples: [
    'A detailed documentary outline with segments',
    'Research notes organized by topic',
  ],
  skipsArtifacts: ['thesis', 'outline'],
  mapsToArtifact: 'outline',
  detectionPatterns: [
    {
      type: 'length',
      config: { minLength: 500 },
      weight: 1,
    },
    {
      type: 'structure',
      config: { hasHeadings: true },
      weight: 3,
    },
    {
      type: 'keywords',
      config: { keywords: ['segment', 'chapter', 'section', 'source', 'evidence', 'argument'], minMatches: 2 },
      weight: 2,
    },
  ],
};

// =============================================================================
// PHASE DEFINITIONS
// =============================================================================

const phases: PhaseDefinition[] = [
  {
    id: 'research',
    displayName: 'Research & Thesis',
    description: 'Define the central thesis and research direction',
    order: 1,
    artifactTypes: ['thesis'],
    requiresConfirmation: false,
    promptFile: 'documentary/phases/research.md',
  },
  {
    id: 'structure',
    displayName: 'Structure & Outline',
    description: 'Create the documentary structure and outline',
    order: 2,
    artifactTypes: ['outline'],
    requiresConfirmation: false,
    promptFile: 'documentary/phases/structure.md',
  },
  {
    id: 'elements',
    displayName: 'Sources & Locations',
    description: 'Identify sources, experts, and key locations',
    order: 3,
    artifactTypes: ['source', 'location'],
    requiresConfirmation: false,
    promptFile: 'documentary/phases/elements.md',
  },
  {
    id: 'segments',
    displayName: 'Segment Development',
    description: 'Develop individual documentary segments',
    order: 4,
    artifactTypes: ['segment'],
    requiresConfirmation: false,
    promptFile: 'documentary/phases/segments.md',
  },
  {
    id: 'visuals',
    displayName: 'Visual Assets',
    description: 'Generate graphics and location images',
    order: 5,
    artifactTypes: ['source_graphic', 'location_image', 'segment_image'],
    requiresConfirmation: true,
    promptFile: 'documentary/phases/visuals.md',
  },
  {
    id: 'video',
    displayName: 'Video Generation',
    description: 'Generate video clips for each segment',
    order: 6,
    artifactTypes: ['segment_video'],
    requiresConfirmation: true,
    promptFile: 'documentary/phases/video.md',
  },
  {
    id: 'assembly',
    displayName: 'Final Assembly',
    description: 'Assemble the final documentary',
    order: 7,
    artifactTypes: ['final_video'],
    requiresConfirmation: true,
    promptFile: 'documentary/phases/assembly.md',
  },
];

// =============================================================================
// STYLE CONFIGURATIONS
// =============================================================================

const styles: StyleConfig[] = [
  {
    id: 'cinematic_documentary',
    displayName: 'Cinematic Documentary',
    description: 'High-quality documentary cinematography style',
    promptModifiers: [
      'documentary style',
      'cinematic',
      'professional photography',
      'natural lighting',
      'high quality',
      'editorial',
    ],
    negativePrompt: [
      'cartoon',
      'anime',
      'illustration',
      'low quality',
      'blurry',
      'amateur',
    ],
    comfySettings: {
      sampler: 'dpmpp_2m_sde',
      scheduler: 'karras',
      steps: 30,
      cfg: 7,
    },
  },
  {
    id: 'news_style',
    displayName: 'News Documentary',
    description: 'Clean, informational news documentary style',
    promptModifiers: [
      'news broadcast quality',
      'professional',
      'clean',
      'well-lit',
      'sharp',
      'broadcast quality',
    ],
    negativePrompt: [
      'artistic',
      'stylized',
      'cartoon',
      'low quality',
      'grainy',
    ],
    comfySettings: {
      sampler: 'dpmpp_2m',
      scheduler: 'normal',
      steps: 25,
      cfg: 7.5,
    },
  },
  {
    id: 'nature_documentary',
    displayName: 'Nature Documentary',
    description: 'BBC/National Geographic nature documentary style',
    promptModifiers: [
      'nature documentary',
      'national geographic style',
      'stunning',
      'breathtaking',
      'wildlife photography',
      '4k quality',
    ],
    negativePrompt: [
      'artificial',
      'indoor',
      'urban',
      'low quality',
      'blurry',
    ],
    comfySettings: {
      sampler: 'dpmpp_2m_sde',
      scheduler: 'karras',
      steps: 35,
      cfg: 8,
    },
  },
];

// =============================================================================
// DOCUMENTARY TEMPLATE
// =============================================================================

export const documentaryTemplate: VideoTemplate = {
  id: 'documentary',
  displayName: 'Documentary Video',
  description: 'Create an informational documentary exploring a topic, question, or thesis. Perfect for educational content, explainers, and research presentations.',
  version: '3.0.0',
  defaultStyle: 'cinematic_documentary',
  styles,
  inputTypes: [topicInput, outlineInput],
  artifactTypes: {
    thesis: thesisArtifact,
    outline: outlineArtifact,
    source: sourceArtifact,
    location: locationArtifact,
    segment: segmentArtifact,
    source_graphic: sourceGraphicArtifact,
    location_image: locationImageArtifact,
    segment_image: segmentImageArtifact,
    segment_video: segmentVideoArtifact,
    final_video: finalVideoArtifact,
  },
  phases,
  constraints: {
    maxSegments: 10,
    maxEntities: 8,
    maxDuration: 600, // 10 minutes
  },
  contextVariables: {
    $original_input: 'thesis',
    $thesis: 'thesis',
    $outline: 'outline',
    $sources: 'source',
    $locations: 'location',
    $segments: 'segment',
  },
  orchestratorPrompt: 'documentary/orchestrator.md',
};

export default documentaryTemplate;
