/**
 * DAG Builder.
 *
 * Constructs the initial DAG from a template definition.
 * Registers all handlers, prompt builders, question builders, and expanders.
 *
 * The initial DAG contains the "static prefix" — nodes that are known upfront
 * (goal setting, asset scanning, plan creation, plot, story).
 * Dynamic nodes (characters, settings, scenes, shots) are added at runtime
 * by expander functions.
 */

import type { DAGNode, DAGNodeDefinition } from './types.js';
import { DAG } from './DAG.js';
import { getDefaultPolicy, ENTITY_EXTRACTION_POLICY } from './errorPolicies.js';
import {
  buildEntityNodes,
  buildEntityExtractionPrompt,
  buildSceneNodes,
  buildShotNodes,
} from './expanders/index.js';
import type { PersistedDAGState } from './types.js';

// =============================================================================
// BUILDER
// =============================================================================

export interface DAGBuilderOptions {
  templateId: string;
  projectDir: string;
  /** Skip the initial planning nodes (set_goal, scan_assets, etc.) if already done */
  skipPlanning?: boolean;
}

/**
 * Build the initial DAG for a narrative video project.
 * Returns a DAG with the static prefix nodes and all registries populated.
 */
export function buildNarrativeDAG(options: DAGBuilderOptions): DAG {
  const { skipPlanning } = options;
  const dag = new DAG();

  // Register all handlers, prompt builders, question builders, and expanders
  registerHandlers(dag);
  registerPromptBuilders(dag);
  registerQuestionBuilders(dag);
  registerExpanders(dag);

  // Build the static prefix
  const staticNodes = buildStaticPrefix(skipPlanning);
  for (const def of staticNodes) {
    dag.addNodeFromDefinition(def);
  }

  // Compute initial ready nodes
  dag.updateReadyNodes();

  return dag;
}

/**
 * Rebuild a DAG from persisted state.
 * Restores node structure and re-attaches handlers from registries.
 */
export function rebuildDAGFromState(state: PersistedDAGState): DAG {
  const dag = new DAG();

  // Register all handlers first
  registerHandlers(dag);
  registerPromptBuilders(dag);
  registerQuestionBuilders(dag);
  registerExpanders(dag);

  // Reconstruct nodes from persisted state
  for (const [_id, nodeState] of Object.entries(state.nodes)) {
    const node: DAGNode = {
      id: nodeState.id,
      type: nodeState.type,
      dependsOn: [...nodeState.dependsOn],
      status: nodeState.status,
      description: nodeState.description,
      metadata: nodeState.metadata,
      result: nodeState.result,
      startedAt: nodeState.startedAt,
      completedAt: nodeState.completedAt,
      attempts: nodeState.attempts,
      recoveryDecisions: nodeState.recoveryDecisions,
      errorPolicy: getDefaultPolicy(nodeState.type),
    };

    // Re-attach handlers from registries using handlerKey
    if (nodeState.handlerKey) {
      const registries = dag.getHandlerRegistries();
      if (nodeState.type === 'D') {
        node.handler = registries.handlers.get(nodeState.handlerKey);
      } else if (nodeState.type === 'S') {
        node.promptBuilder = registries.promptBuilders.get(nodeState.handlerKey);
      } else if (nodeState.type === 'U') {
        node.questionBuilder = registries.questionBuilders.get(nodeState.handlerKey);
      }
    }

    // Re-attach expander
    if (nodeState.expanderKey) {
      node.expander = dag.getHandlerRegistries().expanders.get(nodeState.expanderKey);
    }

    dag.addNode(node);
  }

  // Recompute ready nodes
  dag.updateReadyNodes();

  return dag;
}

// =============================================================================
// STATIC PREFIX
// =============================================================================

/**
 * Build the static prefix nodes known upfront.
 *
 * Flow:
 * set_goal [D] → scan_assets [D] → register_content [D] → create_plan [D]
 *   → present_plan [U]
 *   → generate_plot [S] → approve_plot [U]
 *   → generate_story [S] → approve_story [U]
 *   → extract_entities [S] (with expander)
 */
function buildStaticPrefix(skipPlanning?: boolean): DAGNodeDefinition[] {
  if (skipPlanning) {
    // Start directly from story generation
    return [
      {
        id: 'generate_plot',
        type: 'S',
        dependsOn: [],
        description: 'Generate plot outline',
        handlerKey: 'plot_generate',
      },
      {
        id: 'approve_plot',
        type: 'U',
        dependsOn: ['generate_plot'],
        description: 'Approve plot outline',
        handlerKey: 'plot_approve',
      },
      {
        id: 'generate_story',
        type: 'S',
        dependsOn: ['approve_plot'],
        description: 'Generate full story from plot',
        handlerKey: 'story_generate',
      },
      {
        id: 'approve_story',
        type: 'U',
        dependsOn: ['generate_story'],
        description: 'Approve generated story',
        handlerKey: 'story_approve',
      },
      {
        id: 'extract_entities',
        type: 'S',
        dependsOn: ['approve_story'],
        description: 'Extract characters, settings, and scenes from story',
        handlerKey: 'extract_entities',
        expanderKey: 'entity_expander',
        errorPolicy: { ...ENTITY_EXTRACTION_POLICY },
      },
    ];
  }

  return [
    {
      id: 'set_goal',
      type: 'D',
      dependsOn: [],
      description: 'Set project goal and parameters',
      handlerKey: 'set_goal',
    },
    {
      id: 'scan_assets',
      type: 'D',
      dependsOn: ['set_goal'],
      description: 'Scan for existing project assets',
      handlerKey: 'scan_assets',
    },
    {
      id: 'register_content',
      type: 'D',
      dependsOn: ['scan_assets'],
      description: 'Register user-provided content as assets',
      handlerKey: 'register_content',
    },
    {
      id: 'create_plan',
      type: 'D',
      dependsOn: ['register_content'],
      description: 'Create backward execution plan',
      handlerKey: 'create_plan',
    },
    {
      id: 'present_plan',
      type: 'U',
      dependsOn: ['create_plan'],
      description: 'Present execution plan for user approval',
      handlerKey: 'present_plan',
    },
    {
      id: 'generate_plot',
      type: 'S',
      dependsOn: ['present_plan'],
      description: 'Generate plot outline',
      handlerKey: 'plot_generate',
    },
    {
      id: 'approve_plot',
      type: 'U',
      dependsOn: ['generate_plot'],
      description: 'Approve plot outline',
      handlerKey: 'plot_approve',
    },
    {
      id: 'generate_story',
      type: 'S',
      dependsOn: ['approve_plot'],
      description: 'Generate full story from plot',
      handlerKey: 'story_generate',
    },
    {
      id: 'approve_story',
      type: 'U',
      dependsOn: ['generate_story'],
      description: 'Approve generated story',
      handlerKey: 'story_approve',
    },
    {
      id: 'extract_entities',
      type: 'S',
      dependsOn: ['approve_story'],
      description: 'Extract characters, settings, and scenes from story',
      handlerKey: 'extract_entities',
      expanderKey: 'entity_expander',
      errorPolicy: { ...ENTITY_EXTRACTION_POLICY },
    },
  ];
}

// =============================================================================
// HANDLER REGISTRATION
// =============================================================================

/**
 * Register D-node handlers.
 * These are placeholder implementations — real handlers will be injected
 * by the video task module with access to actual project state and tools.
 */
function registerHandlers(dag: DAG): void {
  // Planning handlers — these will be overridden by the video task wiring
  dag.registerHandler('set_goal', async (ctx) => {
    return { content: 'Goal set', metadata: { projectDir: ctx.projectDir } };
  });

  dag.registerHandler('scan_assets', async (_ctx) => {
    return { content: 'Assets scanned' };
  });

  dag.registerHandler('register_content', async (_ctx) => {
    return { content: 'Content registered' };
  });

  dag.registerHandler('create_plan', async (_ctx) => {
    return { content: 'Plan created' };
  });

  // Timeline handlers
  dag.registerHandler('create_timeline', async (_ctx) => {
    return { content: 'Timeline created' };
  });

  dag.registerHandler('split_timeline', async (ctx) => {
    return { content: `Timeline split for scene ${ctx.metadata['sceneNumber']}` };
  });

  dag.registerHandler('shot_timeline_update', async (ctx) => {
    return { content: `Timeline updated for scene ${ctx.metadata['sceneNumber']} shot ${ctx.metadata['shotNumber']}` };
  });

  dag.registerHandler('scene_complete', async (ctx) => {
    return { content: `Scene ${ctx.metadata['sceneNumber']} complete`, metadata: { sceneNumber: ctx.metadata['sceneNumber'] } };
  });

  dag.registerHandler('validate_timeline', async (_ctx) => {
    return { content: 'Timeline validated' };
  });

  dag.registerHandler('assemble_video', async (_ctx) => {
    return { content: 'Video assembled' };
  });

  // Expansion trigger handlers (D nodes that just trigger their expander)
  dag.registerHandler('expand_scenes_handler', async (_ctx) => {
    return { content: 'Scenes expanded' };
  });

  dag.registerHandler('expand_shots_handler', async (ctx) => {
    // Pass through the shot breakdown JSON from the upstream S node
    // so that the buildShotNodes expander can parse it
    const sceneNum = ctx.metadata['sceneNumber'];
    const shotBreakdown = ctx.getResult(`scene_${sceneNum}_shot_breakdown`);
    return { content: shotBreakdown.content, data: shotBreakdown.data };
  });
}

/**
 * Register S-node prompt builders.
 */
function registerPromptBuilders(dag: DAG): void {
  dag.registerPromptBuilder('extract_entities', buildEntityExtractionPrompt);

  dag.registerPromptBuilder('plot_generate', (ctx) => {
    const goal = ctx.metadata['userGoal'] as string ?? 'Create a narrative video';
    return `You are a creative writer. Generate a compelling plot outline for the following project goal:\n\n${goal}\n\nReturn a structured plot outline with beginning, middle, and end.`;
  });

  dag.registerPromptBuilder('story_generate', (ctx) => {
    const plotResult = ctx.getResult('approve_plot');
    const plot = plotResult.userResponse ?? plotResult.content ?? '';
    return `You are a creative writer. Expand the following plot outline into a full story with vivid descriptions, dialogue, and clear scene breaks.\n\n<plot>\n${plot}\n</plot>\n\nWrite the complete story.`;
  });

  dag.registerPromptBuilder('character_generate', (ctx) => {
    const charName = ctx.metadata['characterName'] as string;
    const role = ctx.metadata['role'] as string;
    const desc = ctx.metadata['description'] as string;
    const storyResult = ctx.getResult('generate_story');
    return `Create a detailed character description for "${charName}" (${role}) from the story.\n\nBrief: ${desc}\n\n<story>\n${storyResult.content}\n</story>\n\nInclude: physical appearance, clothing, personality, key traits, and any unique visual features. Be specific enough to generate a consistent reference image.`;
  });

  dag.registerPromptBuilder('setting_generate', (ctx) => {
    const settingName = ctx.metadata['settingName'] as string;
    const desc = ctx.metadata['description'] as string;
    const storyResult = ctx.getResult('generate_story');
    return `Create a detailed setting description for "${settingName}" from the story.\n\nBrief: ${desc}\n\n<story>\n${storyResult.content}\n</story>\n\nInclude: atmosphere, time of day, lighting, key visual elements, mood, and color palette.`;
  });

  dag.registerPromptBuilder('character_img_prompt', (ctx) => {
    const charName = ctx.metadata['characterName'] as string;
    const charResult = ctx.getResult(`char_${charName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_approve`);
    return `Create a detailed image generation prompt for the character "${charName}".\n\n<character_description>\n${charResult.userResponse ?? charResult.content}\n</character_description>\n\nReturn a single, detailed image generation prompt suitable for AI image generation. Focus on visual details only.`;
  });

  dag.registerPromptBuilder('setting_img_prompt', (ctx) => {
    const settingName = ctx.metadata['settingName'] as string;
    const settingResult = ctx.getResult(`setting_${settingName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_approve`);
    return `Create a detailed image generation prompt for the setting "${settingName}".\n\n<setting_description>\n${settingResult.userResponse ?? settingResult.content}\n</setting_description>\n\nReturn a single, detailed image generation prompt suitable for AI image generation. Focus on environment, lighting, and atmosphere.`;
  });

  // Image/video generation prompt builders are placeholders — overridden by video task
  dag.registerPromptBuilder('character_img_generate', (ctx) => {
    const promptResult = ctx.getResult(`char_${(ctx.metadata['characterName'] as string).toLowerCase().replace(/[^a-z0-9]+/g, '_')}_img_prompt`);
    return promptResult.content ?? '';
  });

  dag.registerPromptBuilder('setting_img_generate', (ctx) => {
    const promptResult = ctx.getResult(`setting_${(ctx.metadata['settingName'] as string).toLowerCase().replace(/[^a-z0-9]+/g, '_')}_img_prompt`);
    return promptResult.content ?? '';
  });

  dag.registerPromptBuilder('scenes_generate', (ctx) => {
    const storyResult = ctx.getResult('generate_story');
    const sceneStructure = ctx.metadata['sceneStructure'] as Array<{ number: number; title: string; summary: string }>;
    const hints = sceneStructure
      ? sceneStructure.map(s => `Scene ${s.number}: "${s.title}" — ${s.summary}`).join('\n')
      : '';
    return `Write detailed scene descriptions for each scene in the story.\n\n<story>\n${storyResult.content}\n</story>\n\n${hints ? `Scene structure hints:\n${hints}\n\n` : ''}For each scene, provide: scene number, title, characters present, setting, detailed action, dialogue, and visual direction.`;
  });

  dag.registerPromptBuilder('shot_breakdown', (ctx) => {
    const sceneNum = ctx.metadata['sceneNumber'] as number;
    const scenesResult = ctx.getResult('generate_scenes');
    return `Break scene ${sceneNum} into individual camera shots for video production.\n\n<scenes>\n${scenesResult.content}\n</scenes>\n\nReturn JSON: { "shots": [{ "shotNumber": 1, "type": "wide|medium|close|detail", "description": "what happens", "prompt": "visual description for image generation" }] }`;
  });

  dag.registerPromptBuilder('shot_img_prompt', (ctx) => {
    const sceneNum = ctx.metadata['sceneNumber'] as number;
    const shotNum = ctx.metadata['shotNumber'] as number;
    const shotDesc = ctx.metadata['shotDescription'] as string ?? '';
    return `Create a detailed image generation prompt for scene ${sceneNum}, shot ${shotNum}.\n\nShot description: ${shotDesc}\n\nReturn a single, detailed image generation prompt. Include character appearances, setting details, lighting, camera angle, and composition.`;
  });

  dag.registerPromptBuilder('shot_img_generate', (ctx) => {
    const prefix = `scene_${ctx.metadata['sceneNumber']}_shot_${ctx.metadata['shotNumber']}`;
    const promptResult = ctx.getResult(`${prefix}_img_prompt`);
    return promptResult.content ?? '';
  });

  dag.registerPromptBuilder('shot_video_generate', (ctx) => {
    const prefix = `scene_${ctx.metadata['sceneNumber']}_shot_${ctx.metadata['shotNumber']}`;
    const imgResult = ctx.getResult(`${prefix}_img`);
    return `Generate a video clip from this image.\n\nImage: ${imgResult.artifactPath ?? 'generated'}\n\nAdd subtle motion appropriate for the scene.`;
  });
}

/**
 * Register U-node question builders.
 */
function registerQuestionBuilders(dag: DAG): void {
  dag.registerQuestionBuilder('present_plan', (ctx) => {
    const planResult = ctx.getResult('create_plan');
    return {
      question: 'Here is the execution plan. Would you like to proceed?',
      isConfirmation: true,
      context: planResult.content,
    };
  });

  dag.registerQuestionBuilder('plot_approve', (ctx) => {
    const plotResult = ctx.getResult('generate_plot');
    return {
      question: 'Here is the plot outline. Do you approve?',
      isConfirmation: false,
      options: [
        { label: 'Approve', description: 'Proceed with this plot' },
        { label: 'Regenerate', description: 'Generate a new plot' },
        { label: 'Edit', description: 'Provide feedback for revision' },
      ],
      context: plotResult.content,
    };
  });

  dag.registerQuestionBuilder('story_approve', (ctx) => {
    const storyResult = ctx.getResult('generate_story');
    return {
      question: 'Here is the full story. Do you approve?',
      isConfirmation: false,
      options: [
        { label: 'Approve', description: 'Proceed with this story' },
        { label: 'Regenerate', description: 'Generate a new story' },
        { label: 'Edit', description: 'Provide feedback for revision' },
      ],
      context: storyResult.content,
    };
  });

  dag.registerQuestionBuilder('character_approve', (ctx) => {
    const charName = ctx.metadata['characterName'] as string;
    const safeName = charName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const charResult = ctx.getResult(`char_${safeName}_generate`);
    return {
      question: `Approve character: ${charName}?`,
      isConfirmation: true,
      context: charResult.content,
      autoApproveTimeoutMs: 30000,
    };
  });

  dag.registerQuestionBuilder('setting_approve', (ctx) => {
    const settingName = ctx.metadata['settingName'] as string;
    const safeName = settingName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const settingResult = ctx.getResult(`setting_${safeName}_generate`);
    return {
      question: `Approve setting: ${settingName}?`,
      isConfirmation: true,
      context: settingResult.content,
      autoApproveTimeoutMs: 30000,
    };
  });

  dag.registerQuestionBuilder('scenes_approve', (ctx) => {
    const scenesResult = ctx.getResult('generate_scenes');
    return {
      question: 'Here are the detailed scenes. Do you approve?',
      isConfirmation: false,
      options: [
        { label: 'Approve', description: 'Proceed with these scenes' },
        { label: 'Regenerate', description: 'Generate new scenes' },
        { label: 'Edit', description: 'Provide feedback for revision' },
      ],
      context: scenesResult.content,
    };
  });

  dag.registerQuestionBuilder('shots_approve', (ctx) => {
    const sceneNum = ctx.metadata['sceneNumber'] as number;
    const shotsResult = ctx.getResult(`scene_${sceneNum}_shot_breakdown`);
    return {
      question: `Approve shot breakdown for scene ${sceneNum}?`,
      isConfirmation: true,
      context: shotsResult.content,
      autoApproveTimeoutMs: 30000,
    };
  });
}

/**
 * Register expander functions.
 */
function registerExpanders(dag: DAG): void {
  dag.registerExpander('entity_expander', buildEntityNodes);
  dag.registerExpander('scene_expander', buildSceneNodes);
  dag.registerExpander('shot_expander', buildShotNodes);
}
