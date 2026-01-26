/**
 * Infomercial Video Template
 *
 * Template for creating product-focused promotional videos.
 * Emphasizes product features, benefits, and demonstrations.
 *
 * Flow: value_prop → script → product/features → demos → visuals → videos → final
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

const valuePropArtifact: ArtifactTypeDefinition = {
  id: 'value_proposition',
  displayName: 'Value Proposition',
  category: 'concept',
  description: 'Core value proposition and key selling points of the product',
  isCollection: false,
  outputFormat: 'markdown',
  filePattern: 'plans/value-proposition.md',
  agentType: 'planning',
  promptFile: 'infomercial/value-proposition.md',
  isExpensive: false,
  requiresPerItemApproval: false,
  dependencies: [],
  metadataSchema: {
    targetAudience: { type: 'string', required: false, description: 'Primary target audience' },
    painPoints: { type: 'array', required: false, description: 'Customer pain points addressed' },
    uniqueSellingPoints: { type: 'array', required: false, description: 'Unique selling points' },
  },
};

const scriptArtifact: ArtifactTypeDefinition = {
  id: 'script',
  displayName: 'Infomercial Script',
  category: 'structure',
  description: 'Complete script with product messaging, demonstrations, and calls to action',
  isCollection: false,
  outputFormat: 'markdown',
  filePattern: 'plans/script.md',
  agentType: 'content',
  promptFile: 'infomercial/script.md',
  isExpensive: false,
  requiresPerItemApproval: false,
  dependencies: [
    {
      artifactTypeId: 'value_proposition',
      required: true,
      usage: 'context',
    },
  ],
  metadataSchema: {
    tone: { type: 'string', required: false, description: 'Tone of the script (professional, friendly, urgent)' },
    callToAction: { type: 'string', required: false, description: 'Primary call to action' },
  },
};

const productArtifact: ArtifactTypeDefinition = {
  id: 'product',
  displayName: 'Product Details',
  category: 'entity',
  description: 'Detailed product information and visual specifications',
  isCollection: true,
  itemName: 'product',
  maxItems: 3, // Main product + variants
  outputFormat: 'markdown',
  filePattern: 'products/{{name}}.md',
  agentType: 'content',
  promptFile: 'infomercial/product.md',
  isExpensive: false,
  requiresPerItemApproval: true,
  dependencies: [
    {
      artifactTypeId: 'value_proposition',
      required: true,
      usage: 'context',
    },
  ],
  metadataSchema: {
    category: { type: 'string', required: false, description: 'Product category' },
    price: { type: 'string', required: false, description: 'Product price' },
    variants: { type: 'array', required: false, description: 'Product variants (colors, sizes)' },
  },
};

const featureArtifact: ArtifactTypeDefinition = {
  id: 'feature',
  displayName: 'Features',
  category: 'entity',
  description: 'Individual product features to highlight',
  isCollection: true,
  itemName: 'feature',
  maxItems: 6,
  outputFormat: 'markdown',
  filePattern: 'features/{{name}}.md',
  agentType: 'content',
  promptFile: 'infomercial/feature.md',
  isExpensive: false,
  requiresPerItemApproval: true,
  dependencies: [
    {
      artifactTypeId: 'product',
      required: true,
      usage: 'context',
      scope: 'any',
    },
  ],
  metadataSchema: {
    benefitType: { type: 'string', required: false, description: 'Type of benefit (functional, emotional, social)' },
    demonstrable: { type: 'boolean', required: false, description: 'Can this feature be demonstrated visually?' },
  },
};

const demoSequenceArtifact: ArtifactTypeDefinition = {
  id: 'demo_sequence',
  displayName: 'Demo Sequences',
  category: 'segment',
  description: 'Product demonstration sequences showing features in action',
  isCollection: true,
  itemName: 'demo',
  maxItems: 6,
  outputFormat: 'markdown',
  filePattern: 'demos/demo_{{index}}.md',
  agentType: 'content',
  promptFile: 'infomercial/demo-sequence.md',
  isExpensive: false,
  requiresPerItemApproval: true,
  dependencies: [
    {
      artifactTypeId: 'script',
      required: true,
      usage: 'context',
    },
    {
      artifactTypeId: 'product',
      required: true,
      usage: 'context',
      scope: 'all',
    },
    {
      artifactTypeId: 'feature',
      required: true,
      usage: 'context',
      scope: 'all',
    },
  ],
  metadataSchema: {
    products: { type: 'array', required: true, description: 'Products featured in this demo' },
    features: { type: 'array', required: true, description: 'Features demonstrated' },
    setting: { type: 'string', required: false, description: 'Demo environment/setting' },
    duration: { type: 'number', required: false, description: 'Demo duration in seconds' },
  },
};

const productShotArtifact: ArtifactTypeDefinition = {
  id: 'product_shot',
  displayName: 'Product Shots',
  category: 'visual_ref',
  description: 'High-quality product photography/renders',
  isCollection: true,
  itemName: 'product shot',
  outputFormat: 'image',
  filePattern: 'assets/images/products/{{name}}.png',
  agentType: 'image',
  promptFile: 'infomercial/product-shot.md',
  isExpensive: true,
  requiresPerItemApproval: true,
  dependencies: [
    {
      artifactTypeId: 'product',
      required: true,
      usage: 'context',
      scope: 'matching',
    },
  ],
  metadataSchema: {
    productId: { type: 'string', required: true, description: 'ID of the product' },
    angle: { type: 'string', required: false, description: 'Camera angle (front, side, hero)' },
    lighting: { type: 'string', required: false, description: 'Lighting style' },
  },
};

const demoImageArtifact: ArtifactTypeDefinition = {
  id: 'demo_image',
  displayName: 'Demo Images',
  category: 'visual_ref',
  description: 'Images showing product demonstrations in action',
  isCollection: true,
  itemName: 'demo image',
  outputFormat: 'image',
  filePattern: 'assets/images/demos/demo_{{index}}.png',
  agentType: 'image',
  promptFile: 'infomercial/demo-image.md',
  isExpensive: true,
  requiresPerItemApproval: true,
  dependencies: [
    {
      artifactTypeId: 'demo_sequence',
      required: true,
      usage: 'context',
      scope: 'matching',
    },
    {
      artifactTypeId: 'product_shot',
      required: true,
      usage: 'reference',
      scope: 'matching',
    },
  ],
  metadataSchema: {
    demoId: { type: 'string', required: true, description: 'ID of the demo sequence' },
    productRefs: { type: 'array', required: false, description: 'Product shot IDs used' },
  },
};

const demoVideoArtifact: ArtifactTypeDefinition = {
  id: 'demo_video',
  displayName: 'Demo Videos',
  category: 'clip',
  description: 'Video clips of product demonstrations',
  isCollection: true,
  itemName: 'demo video',
  outputFormat: 'video',
  filePattern: 'assets/videos/demos/demo_{{index}}.mp4',
  agentType: 'video',
  promptFile: 'infomercial/demo-video.md',
  isExpensive: true,
  requiresPerItemApproval: true,
  dependencies: [
    {
      artifactTypeId: 'demo_sequence',
      required: true,
      usage: 'context',
      scope: 'matching',
    },
    {
      artifactTypeId: 'demo_image',
      required: true,
      usage: 'input',
      scope: 'matching',
    },
  ],
  metadataSchema: {
    demoId: { type: 'string', required: true, description: 'ID of the demo sequence' },
    imageId: { type: 'string', required: true, description: 'Source demo image ID' },
    duration: { type: 'number', required: false, description: 'Video duration in seconds' },
  },
};

const finalVideoArtifact: ArtifactTypeDefinition = {
  id: 'final_video',
  displayName: 'Final Infomercial',
  category: 'final',
  description: 'The assembled final infomercial video',
  isCollection: false,
  outputFormat: 'video',
  filePattern: 'assets/videos/final/{{name}}.mp4',
  agentType: 'video',
  promptFile: 'common/final-video.md',
  isExpensive: true,
  requiresPerItemApproval: false,
  dependencies: [
    {
      artifactTypeId: 'demo_video',
      required: true,
      usage: 'input',
      scope: 'all',
    },
  ],
  metadataSchema: {
    totalDuration: { type: 'number', required: false, description: 'Total video duration' },
  },
};

// =============================================================================
// INPUT TYPE CONFIGURATIONS
// =============================================================================

const productInfoInput: InputTypeConfig = {
  id: 'product_info',
  displayName: 'Product Information',
  description: 'Basic product information and key features',
  examples: [
    'A smart water bottle that tracks hydration',
    'Ergonomic keyboard with customizable keys',
    'Solar-powered phone charger for outdoor use',
  ],
  skipsArtifacts: [],
  mapsToArtifact: 'value_proposition',
  detectionPatterns: [
    {
      type: 'length',
      config: { maxLength: 500 },
      weight: 2,
    },
    {
      type: 'keywords',
      config: { keywords: ['product', 'features', 'benefits', 'price', 'buy', 'for sale'], minMatches: 1 },
      weight: 2,
    },
  ],
};

const fullBriefInput: InputTypeConfig = {
  id: 'full_brief',
  displayName: 'Full Product Brief',
  description: 'Comprehensive product brief with features, target audience, and messaging',
  examples: [
    'Complete marketing brief with value propositions',
    'Product spec sheet with selling points',
  ],
  skipsArtifacts: ['value_proposition'],
  mapsToArtifact: 'value_proposition',
  detectionPatterns: [
    {
      type: 'length',
      config: { minLength: 500 },
      weight: 2,
    },
    {
      type: 'structure',
      config: { hasHeadings: true },
      weight: 2,
    },
    {
      type: 'keywords',
      config: { keywords: ['target audience', 'value proposition', 'unique selling', 'competitive advantage', 'features', 'benefits'], minMatches: 3 },
      weight: 3,
    },
  ],
};

// =============================================================================
// PHASE DEFINITIONS
// =============================================================================

const phases: PhaseDefinition[] = [
  {
    id: 'strategy',
    displayName: 'Value Proposition',
    description: 'Define the core value proposition and messaging',
    order: 1,
    artifactTypes: ['value_proposition'],
    requiresConfirmation: false,
    promptFile: 'infomercial/phases/strategy.md',
  },
  {
    id: 'scripting',
    displayName: 'Script Development',
    description: 'Write the infomercial script',
    order: 2,
    artifactTypes: ['script'],
    requiresConfirmation: false,
    promptFile: 'infomercial/phases/scripting.md',
  },
  {
    id: 'product_details',
    displayName: 'Product & Features',
    description: 'Detail products and their key features',
    order: 3,
    artifactTypes: ['product', 'feature'],
    requiresConfirmation: false,
    promptFile: 'infomercial/phases/product-details.md',
  },
  {
    id: 'demos',
    displayName: 'Demo Planning',
    description: 'Plan product demonstration sequences',
    order: 4,
    artifactTypes: ['demo_sequence'],
    requiresConfirmation: false,
    promptFile: 'infomercial/phases/demos.md',
  },
  {
    id: 'product_visuals',
    displayName: 'Product Visuals',
    description: 'Generate product shots and demo images',
    order: 5,
    artifactTypes: ['product_shot', 'demo_image'],
    requiresConfirmation: true,
    promptFile: 'infomercial/phases/product-visuals.md',
  },
  {
    id: 'video',
    displayName: 'Video Generation',
    description: 'Generate demo video clips',
    order: 6,
    artifactTypes: ['demo_video'],
    requiresConfirmation: true,
    promptFile: 'infomercial/phases/video.md',
  },
  {
    id: 'assembly',
    displayName: 'Final Assembly',
    description: 'Assemble the final infomercial',
    order: 7,
    artifactTypes: ['final_video'],
    requiresConfirmation: true,
    promptFile: 'infomercial/phases/assembly.md',
  },
];

// =============================================================================
// STYLE CONFIGURATIONS
// =============================================================================

const styles: StyleConfig[] = [
  {
    id: 'professional_product',
    displayName: 'Professional Product',
    description: 'Clean, professional product photography style',
    promptModifiers: [
      'professional product photography',
      'studio lighting',
      'white background',
      'high quality',
      'commercial',
      'clean',
    ],
    negativePrompt: [
      'amateur',
      'low quality',
      'blurry',
      'cluttered background',
      'dark',
    ],
    comfySettings: {
      sampler: 'dpmpp_2m_sde',
      scheduler: 'karras',
      steps: 30,
      cfg: 7.5,
    },
  },
  {
    id: 'lifestyle',
    displayName: 'Lifestyle',
    description: 'Products shown in lifestyle/use contexts',
    promptModifiers: [
      'lifestyle photography',
      'product in use',
      'natural setting',
      'warm lighting',
      'relatable',
      'authentic',
    ],
    negativePrompt: [
      'studio',
      'white background',
      'sterile',
      'artificial',
      'low quality',
    ],
    comfySettings: {
      sampler: 'dpmpp_2m',
      scheduler: 'karras',
      steps: 28,
      cfg: 7,
    },
  },
  {
    id: 'tech_sleek',
    displayName: 'Tech Sleek',
    description: 'Modern, sleek tech product style',
    promptModifiers: [
      'tech product photography',
      'sleek',
      'modern',
      'dark background',
      'dramatic lighting',
      'premium',
    ],
    negativePrompt: [
      'old',
      'outdated',
      'cheap looking',
      'low quality',
      'blurry',
    ],
    comfySettings: {
      sampler: 'dpmpp_2m_sde',
      scheduler: 'karras',
      steps: 30,
      cfg: 8,
    },
  },
  {
    id: 'infomercial_classic',
    displayName: 'Classic Infomercial',
    description: 'Traditional bright, energetic infomercial style',
    promptModifiers: [
      'infomercial style',
      'bright colors',
      'energetic',
      'before and after',
      'demonstration',
      'convincing',
    ],
    negativePrompt: [
      'dark',
      'moody',
      'artistic',
      'abstract',
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
// INFOMERCIAL TEMPLATE
// =============================================================================

export const infomercialTemplate: VideoTemplate = {
  id: 'infomercial',
  displayName: 'Product Infomercial',
  description: 'Create a product-focused promotional video with demonstrations, features, and calls to action. Perfect for product launches, e-commerce, and advertising.',
  version: '3.0.0',
  defaultStyle: 'professional_product',
  styles,
  inputTypes: [productInfoInput, fullBriefInput],
  artifactTypes: {
    value_proposition: valuePropArtifact,
    script: scriptArtifact,
    product: productArtifact,
    feature: featureArtifact,
    demo_sequence: demoSequenceArtifact,
    product_shot: productShotArtifact,
    demo_image: demoImageArtifact,
    demo_video: demoVideoArtifact,
    final_video: finalVideoArtifact,
  },
  phases,
  constraints: {
    maxSegments: 6, // Demo sequences
    maxEntities: 6, // Products + Features
    maxDuration: 180, // 3 minutes
  },
  contextVariables: {
    $original_input: 'value_proposition',
    $value_proposition: 'value_proposition',
    $script: 'script',
    $products: 'product',
    $features: 'feature',
    $demos: 'demo_sequence',
  },
  orchestratorPrompt: 'infomercial/orchestrator.md',
};

export default infomercialTemplate;
