/**
 * ProjectManager - Handles project file creation, reading, and updating.
 * Manages the .kshana directory structure and project.json index file.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'fs';
import { CONTENT_TYPE_OUTPUT_FILES } from '../../../core/tools/builtin/generateContentTool.js';
import { join } from 'path';
import {
  type ProjectFile,
  type PhaseInfo,
  type PhaseStatus,
  type CharacterData,
  type SettingData,
  type SceneRef,
  type AssetInfo,
  type ContentRegistry,
  type ContentEntry,
  type ContentTypeName,
  type ContentStatus,
  type ItemApprovalStatus,
  type ItemApprovalEntry,
  type PhaseConfig,
  type ProjectStyle,
  type StyleConfig,
  type InputType,
  type ProjectIndex,
  type SceneRoutingEntry,
  type EntityRoutingEntry,
  type ExecutionContext,
  type TranscriptEntry,
  type ImagePlacement,
  WorkflowPhase,
  PlannerStage,
  PHASE_CONFIGS,
  STYLE_CONFIGS,
  INPUT_TYPE_CONFIGS,
  PROJECT_DIR,
  AGENT_DIR,
  INDEX_DIR,
  PROJECT_FILE,
  MANIFEST_FILE,
  PROJECT_INDEX_FILE,
  PROJECT_VERSION,
  determineNextPhase,
  getPhaseItems,
  getNextUnapprovedItem,
  areAllItemsApproved,
  countApprovedItems,
  createDefaultCharacterData,
  createDefaultSettingData,
  createDefaultSceneRef,
} from './types.js';
import { generateProjectTitle, contextStore } from '../../../core/context/index.js';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

/**
 * Detect the execution context (CLI or Desktop).
 * CLI: Running in kshana-ink project directory (Node.js process)
 * Desktop: Running in Electron renderer process (has window.electron)
 */
export function getExecutionContext(): ExecutionContext {
  // Check if we're in Electron/Desktop environment
  // In Node.js, window is not defined, so we check for it safely
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (globalThis as any).window !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = (globalThis as any).window;
      if (win && win.electron) {
        return 'desktop';
      }
    }
  } catch {
    // window not available - we're in Node.js CLI context
  }
  // Default to CLI context (Node.js)
  return 'cli';
}

/**
 * Get the CLI's own project base path (where kshana-ink is installed).
 * This is used when CLI manages its own .kshana/agent/* workspace.
 */
export function getCLIProjectBasePath(): string {
  // Try to find the kshana-ink project root by looking for package.json
  let currentPath = process.cwd();
  const maxDepth = 10;
  let depth = 0;

  while (depth < maxDepth) {
    const packageJsonPath = join(currentPath, 'package.json');
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
        if (packageJson.name === 'kshana-ink') {
          return currentPath;
        }
      } catch {
        // Continue searching
      }
    }

    const parentPath = join(currentPath, '..');
    if (parentPath === currentPath) {
      break; // Reached filesystem root
    }
    currentPath = parentPath;
    depth++;
  }

  // Fallback to current working directory
  return process.cwd();
}

/**
 * Get the project directory path (root .kshana directory).
 * 
 * Execution Context:
 * - CLI: Uses basePath (defaults to CLI's own project directory)
 * - Desktop: Uses basePath (user-selected project workspace)
 * 
 * @param basePath - Base path for the project. In CLI context, defaults to CLI's own directory.
 *                   In Desktop context, should be the user's project workspace.
 */
export function getProjectDir(basePath: string = process.cwd()): string {
  return join(basePath, PROJECT_DIR);
}

/**
 * Get the agent directory path (.kshana/agent).
 * 
 * Execution Context:
 * - CLI: Returns agent directory in CLI's own project (for CLI's agent workspace)
 * - Desktop: Returns agent directory in user project workspace (for user's agent files)
 * 
 * @param basePath - Base path for the project. In CLI context, defaults to CLI's own directory.
 *                   In Desktop context, should be the user's project workspace.
 */
export function getAgentDir(basePath: string = process.cwd()): string {
  return join(getProjectDir(basePath), AGENT_DIR);
}

/**
 * Get the CLI's own agent directory path.
 * This is used when CLI manages its own .kshana/agent/* workspace.
 * 
 * CLI Context Only: Returns agent directory in kshana-ink project directory.
 */
export function getCLIAgentDir(): string {
  return getAgentDir(getCLIProjectBasePath());
}

/**
 * Get the agent directory path for a user project workspace.
 * This is used by Desktop to access agent files in user project space.
 * 
 * Desktop Context: Returns agent directory in user's project workspace.
 * 
 * @param userProjectPath - Path to the user's project workspace
 */
export function getUserProjectAgentDir(userProjectPath: string): string {
  return getAgentDir(userProjectPath);
}

/**
 * Get the index directory path (.kshana/index).
 * 
 * Execution Context:
 * - CLI: Returns index directory in CLI's own project
 * - Desktop: Returns index directory in user project workspace
 * 
 * @param basePath - Base path for the project
 */
export function getIndexDir(basePath: string = process.cwd()): string {
  return join(getProjectDir(basePath), INDEX_DIR);
}

/**
 * Get the project file path (.kshana/agent/project.json).
 * 
 * Execution Context:
 * - CLI: Returns project.json in CLI's own agent directory
 * - Desktop: Returns project.json in user project's agent directory
 * 
 * @param basePath - Base path for the project
 */
export function getProjectFilePath(basePath: string = process.cwd()): string {
  return join(getAgentDir(basePath), PROJECT_FILE);
}

/**
 * Get the manifest file path (.kshana/agent/manifest.json).
 * 
 * Execution Context:
 * - CLI: Returns manifest.json in CLI's own agent directory
 * - Desktop: Returns manifest.json in user project's agent directory
 * 
 * @param basePath - Base path for the project
 */
export function getManifestFilePath(basePath: string = process.cwd()): string {
  return join(getAgentDir(basePath), MANIFEST_FILE);
}

/**
 * Get the consolidated project index file path (.kshana/context/index.json).
 * 
 * This uses the new consolidated indexing architecture where the index is stored
 * in the context directory. The project_id is stored inside index.json, not in the folder structure.
 * 
 * Execution Context:
 * - CLI: Returns index.json in CLI's context directory
 * - Desktop: Returns index.json in user project's context directory
 * 
 * @param basePath - Base path for the project
 */
export function getProjectIndexPath(basePath: string = process.cwd()): string {
  // Use consolidated index location: context/index.json (project_id is inside the file)
  return join(getProjectDir(basePath), 'context', 'index.json');
}

/**
 * Check if a project exists in the current directory.
 */
export function projectExists(basePath: string = process.cwd()): boolean {
  return existsSync(getProjectFilePath(basePath));
}

/**
 * Delete an existing project and all its files.
 * Use with caution - this permanently removes all project data.
 */
export function deleteProject(basePath: string = process.cwd()): boolean {
  const projectDir = getProjectDir(basePath);

  if (!existsSync(projectDir)) {
    return false;
  }

  try {
    rmSync(projectDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create the initial project directory structure.
 * Only creates directories - plan files are created on first write.
 */
export function createProjectStructure(basePath: string = process.cwd()): void {
  const projectDir = getProjectDir(basePath);
  const agentDir = getAgentDir(basePath);

  // Create main directories
  const dirs = [
    projectDir,
    agentDir,
    join(agentDir, 'plans'),
    join(agentDir, 'content'),
    join(agentDir, 'script'), // Unified directory for plot, story, and narration
    join(agentDir, 'characters'),
    join(agentDir, 'settings'),
    join(agentDir, 'scenes'),
    join(projectDir, 'context'), // Context directory (index will be in context/index.json)
    // Note: ui/ folder is only created by desktop app, not CLI
    // Note: index/ folder is deprecated - using context/index.json instead
  ];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  // Create empty manifest in agent/ directory
  const manifestPath = getManifestFilePath(basePath);
  if (!existsSync(manifestPath)) {
    writeFileSync(manifestPath, JSON.stringify({ schema_version: '1', assets: [] }, null, 2), 'utf-8');
  }

  // Initialize empty project index (will be populated on first project save)
  const indexPath = getProjectIndexPath(basePath);
  // Index will be generated automatically when project is created/saved

  // NOTE: Plan files (plot.md, story.md, etc.) are created on first write
  // via writeProjectFile(), not here. This avoids empty files cluttering the project.
}

/**
 * Create the default content registry with all content marked as missing.
 */
export function createDefaultContentRegistry(): ContentRegistry {
  return {
    plot: { status: 'missing', file: 'agent/script/plot.md' },
    story: { status: 'missing', file: 'agent/script/story.md' },
    characters: { status: 'missing', file: 'agent/plans/characters.md', items: [], itemFiles: {} },
    settings: { status: 'missing', file: 'agent/plans/settings.md', items: [], itemFiles: {} },
    scenes: { status: 'missing', file: 'agent/plans/scenes.md', items: [] },
    images: { status: 'missing', file: 'agent/plans/images.md', items: [] },
    videos: { status: 'missing', file: 'agent/plans/video.md', items: [] },
  };
}

/**
 * Strip XML-like tags from content (e.g., <user_task>, [STORED CONTENT:], etc.)
 */
function stripWrapperTags(content: string): string {
  return content
    // Remove <user_task>...</user_task> tags
    .replace(/<user_task>\s*/gi, '')
    .replace(/\s*<\/user_task>/gi, '')
    // Remove [user_task]... prefix
    .replace(/^\[user_task\]\s*/i, '')
    // Remove [STORED CONTENT: ...] blocks
    .replace(/\[STORED CONTENT:[^\]]*\]\s*context_ref:[^\n]*\n[^\n]*\n\nPreview:[^\n]*\n\n[^\n]*\n[^\n]*/gi, '')
    .trim();
}

function looksLikeSrt(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return false;
  }
  
  // Check for proper SRT format (numbered entries with "00:00:00,000 --> 00:00:00,000" timestamps)
  const srtTimestampPattern = /\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/;
  if (srtTimestampPattern.test(trimmed)) {
    const firstLine = trimmed.split(/\r?\n/, 1)[0] || '';
    if (/^\d+$/.test(firstLine.trim())) {
      return true; // Proper SRT format
    }
  }
  
  // Check for raw transcript format (timestamps embedded in text like "3:53", "4:00", "0:17")
  // Patterns to match:
  // - "Transcript 0:00" or "0:17" at start
  // - Timestamps like "1:23", "12:34" anywhere in text
  // - Multiple timestamps indicate it's a transcript
  const rawTranscriptPattern = /\d{1,2}:\d{2}(?:\s|$)/;
  const timestampMatches = trimmed.match(rawTranscriptPattern);
  // If we find 3+ timestamps, it's likely a transcript
  if (timestampMatches && timestampMatches.length >= 3) {
    return true; // Raw transcript format - treat as YouTube SRT workflow
  }
  
  // Also check for common transcript prefixes
  if (/^(Transcript|transcript)\s*\d{1,2}:\d{2}/i.test(trimmed)) {
    return true;
  }
  
  return false;
}

function isYouTubeInputType(inputType: InputType): boolean {
  return inputType === 'youtube_srt' || inputType === 'script';
}

const LEGACY_PHASES = new Set<WorkflowPhase>([
  WorkflowPhase.PLOT,
  WorkflowPhase.STORY,
  WorkflowPhase.CHARACTERS_SETTINGS,
  WorkflowPhase.SCENES,
  WorkflowPhase.CHARACTER_SETTING_IMAGES,
  WorkflowPhase.SCENE_IMAGES,
  WorkflowPhase.VIDEO,
]);

function normalizeCurrentPhaseForInputType(project: ProjectFile): { phase: WorkflowPhase; changed: boolean } {
  const inputTypeConfig = INPUT_TYPE_CONFIGS[project.inputType] ?? INPUT_TYPE_CONFIGS.idea;
  const currentPhase = project.currentPhase;
  const invalidPhase = !PHASE_CONFIGS[currentPhase];
  const legacyPhase = LEGACY_PHASES.has(currentPhase);

  if (isYouTubeInputType(project.inputType) && (legacyPhase || invalidPhase)) {
    return { phase: inputTypeConfig.startPhase, changed: true };
  }

  if (invalidPhase) {
    return { phase: inputTypeConfig.startPhase, changed: true };
  }

  return { phase: currentPhase, changed: false };
}

/**
 * Create a new project file with the given input.
 * Stores originalInput in a separate file, only reference in project.json.
 * @param originalInput - The original story/prompt input
 * @param style - The visual style for the project (cinematic_realism or anime)
 * @param basePath - Base path for the project
 */
export function createProject(
  originalInput: string,
  styleOrBasePath: ProjectStyle | string = 'cinematic_realism',
  basePathMaybe: string = process.cwd()
): ProjectFile {
  // Back-compat:
  // - Old signature: createProject(originalInput, basePath)
  // - New signature: createProject(originalInput, style, basePath?)
  const style: ProjectStyle =
    styleOrBasePath === 'cinematic_realism' || styleOrBasePath === 'anime'
      ? styleOrBasePath
      : 'cinematic_realism';
  const basePath: string =
    styleOrBasePath === 'cinematic_realism' || styleOrBasePath === 'anime'
      ? basePathMaybe
      : String(styleOrBasePath);

  // Ensure directory structure exists
  createProjectStructure(basePath);

  // Clean the input - remove any XML tags or wrapper formats
  const cleanInput = stripWrapperTags(originalInput);

  const now = Date.now();
  const projectId = `proj-${now}-${Math.random().toString(36).slice(2, 8)}`;

  // Save original input to a separate file
  const inputFilePath = 'agent/original_input.md';
  const fullInputPath = join(getProjectDir(basePath), inputFilePath);

  // Only write if file doesn't exist - preserve existing original input
  // This prevents overwriting the user's original input if createProject is called multiple times
  if (!existsSync(fullInputPath)) {
    writeFileSync(fullInputPath, cleanInput, 'utf-8');
  } else {
    // Log warning if trying to overwrite (shouldn't happen in normal flow)
    console.warn(`[ProjectManager] original_input.md already exists at ${fullInputPath}, preserving existing content.`);
  }

  // Generate plan ID
  const planId = `plan-${now}-${Math.random().toString(36).slice(2, 8)}`;

  const detectedInputType: InputType = looksLikeSrt(cleanInput) ? 'youtube_srt' : 'idea';
  const inputTypeConfig = INPUT_TYPE_CONFIGS[detectedInputType];

  // Default to detected input type; agent may update if it detects a full story/script
  const project: ProjectFile = {
    version: '2.0',
    id: projectId,
    title: generateProjectTitle(cleanInput),
    originalInputFile: inputFilePath,
    style,
    inputType: detectedInputType,
    createdAt: now,
    updatedAt: now,
    currentPhase: inputTypeConfig.startPhase,
    // Project-level master plan - one plan for all phases
    plan: {
      planId,
      planFile: 'agent/plans/master-plan.md',
      stage: PlannerStage.PLANNING,
      refinementCount: 0,
      createdAt: now,
      approvedAt: null,
    },
    phases: {
      transcript_input: {
        status: 'pending',
        completedAt: null,
      },
      planning: {
        status: 'pending',
        completedAt: null,
      },
      image_placement: {
        status: 'pending',
        completedAt: null,
      },
      image_generation: {
        status: 'pending',
        completedAt: null,
      },
      video_replacement: {
        status: 'pending',
        completedAt: null,
      },
      plot: {
        status: 'pending',
        completedAt: null,
      },
      story: {
        status: 'pending',
        completedAt: null,
      },
      characters_settings: {
        status: 'pending',
        completedAt: null,
      },
      scenes: {
        status: 'pending',
        completedAt: null,
      },
      character_setting_images: {
        status: 'pending',
        completedAt: null,
      },
      scene_images: {
        status: 'pending',
        completedAt: null,
      },
      video: {
        status: 'pending',
        completedAt: null,
      },
      video_combine: {
        status: 'pending',
        completedAt: null,
      },
    },
    content: createDefaultContentRegistry(),
    characters: [],
    settings: [],
    scenes: [],
    assets: [],
    transcriptEntries: [] as TranscriptEntry[],
    imagePlacements: [] as ImagePlacement[],
  };

  if (inputTypeConfig.skipPhases.length > 0) {
    for (const skipPhase of inputTypeConfig.skipPhases) {
      const phaseKey = skipPhase as keyof typeof project.phases;
      if (project.phases[phaseKey]) {
        project.phases[phaseKey].status = 'skipped';
        project.phases[phaseKey].completedAt = now;
      }
    }
  }

  // Save project file
  saveProject(project, basePath);

  return project;
}

/**
 * Set the input type for a project and handle phase skipping.
 * Called by the agent after analyzing the user's input.
 * @param inputType - The detected input type (idea or story)
 * @param basePath - Base path for the project
 */
export function setProjectInputType(
  inputType: InputType,
  basePath: string = process.cwd()
): ProjectFile | null {
  const project = loadProject(basePath);
  if (!project) return null;

  const now = Date.now();
  const inputTypeConfig = INPUT_TYPE_CONFIGS[inputType];

  // Update the input type
  project.inputType = inputType;

  // If it's a full story, skip plot and story phases
  if (inputType === 'story') {
    // Mark skipped phases
    for (const skipPhase of inputTypeConfig.skipPhases) {
      const phaseKey = skipPhase as keyof typeof project.phases;
      if (project.phases[phaseKey]) {
        project.phases[phaseKey].status = 'skipped';
        project.phases[phaseKey].completedAt = now;
      }
    }

    // Update current phase to the start phase for this input type
    project.currentPhase = inputTypeConfig.startPhase;

    // Read the original input and save it as the story
    const originalInput = getOriginalInput(project, basePath);
    if (originalInput) {
      const storyDir = join(getAgentDir(basePath), 'script');
      if (!existsSync(storyDir)) {
        mkdirSync(storyDir, { recursive: true });
      }
      const storyPath = join(storyDir, 'story.md');
      writeFileSync(storyPath, `# Story\n\n${originalInput}`, 'utf-8');

      // Update content registry
      project.content.story.status = 'available';
    }
  }

  if (inputType === 'youtube_srt' || inputType === 'script') {
    for (const skipPhase of inputTypeConfig.skipPhases) {
      const phaseKey = skipPhase as keyof typeof project.phases;
      if (project.phases[phaseKey]) {
        project.phases[phaseKey].status = 'skipped';
        project.phases[phaseKey].completedAt = now;
      }
    }
    project.currentPhase = inputTypeConfig.startPhase;
  }

  saveProject(project, basePath);
  return project;
}

/**
 * Sync the content registry to match actual project content.
 * This ensures existing projects that were created before content tracking
 * have their content registry properly populated.
 */
function syncContentRegistry(project: ProjectFile, basePath: string): boolean {
  let needsSave = false;

  // Ensure content registry exists
  if (!project.content) {
    project.content = createDefaultContentRegistry();
    needsSave = true;
  }

  const agentDir = getAgentDir(basePath);

  // Sync plot content (now in script/ directory)
  const plotFile = join(agentDir, 'script', 'plot.md');
  if (existsSync(plotFile) && project.content.plot.status === 'missing') {
    project.content.plot.status = 'available';
    needsSave = true;
  }

  // Sync story content (now in script/ directory)
  const storyFile = join(agentDir, 'script', 'story.md');
  if (existsSync(storyFile) && project.content.story.status === 'missing') {
    project.content.story.status = 'available';
    needsSave = true;
  }

  // Sync characters from project.characters
  for (const char of project.characters) {
    if (!project.content.characters.items?.includes(char.name)) {
      if (!project.content.characters.items) {
        project.content.characters.items = [];
      }
      project.content.characters.items.push(char.name);
      needsSave = true;
    }
    // Also track file path
    const safeName = char.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const charFile = `agent/characters/${safeName}.md`;
    if (!project.content.characters.itemFiles) {
      project.content.characters.itemFiles = {};
    }
    if (!project.content.characters.itemFiles[char.name]) {
      project.content.characters.itemFiles[char.name] = charFile;
      needsSave = true;
    }
  }

  // Sync characters from disk - scan characters/ directory for .md files
  const charactersDir = join(agentDir, 'characters');
  if (existsSync(charactersDir)) {
    const charFiles = readdirSync(charactersDir).filter(f => f.endsWith('.md'));

    for (const charFile of charFiles) {
      try {
        const charContent = readFileSync(join(charactersDir, charFile), 'utf-8');
        // Extract name from first heading or filename
        const nameMatch = charContent.match(/^#\s*(?:Character[:\-–—\s]*)?(.+)/m);
        const charName = nameMatch && nameMatch[1]
          ? nameMatch[1].trim()
          : charFile.replace(/\.md$/, '').replace(/[-_]/g, ' ');

        // Check if character is already registered
        const existingChar = project.characters.find(
          c => c.name.toLowerCase() === charName.toLowerCase()
        );
        if (!existingChar) {
          const character = createDefaultCharacterData(charName);

          // If characters_settings phase is complete, mark as approved
          const charactersSettingsPhase = project.phases.characters_settings;
          if (charactersSettingsPhase?.status === 'completed') {
            character.approvalStatus = 'approved';
            character.approvedAt = Date.now();
          }

          project.characters.push(character);
          needsSave = true;
        }
      } catch {
        /* ignore read errors */
      }
    }
  }

  if ((project.content.characters.items?.length ?? 0) > 0 && project.content.characters.status === 'missing') {
    project.content.characters.status = 'partial';
    needsSave = true;
  }

  // Sync settings from project.settings
  for (const setting of project.settings) {
    if (!project.content.settings.items?.includes(setting.name)) {
      if (!project.content.settings.items) {
        project.content.settings.items = [];
      }
      project.content.settings.items.push(setting.name);
      needsSave = true;
    }
    // Also track file path
    const safeName = setting.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const settingFile = `agent/settings/${safeName}.md`;
    if (!project.content.settings.itemFiles) {
      project.content.settings.itemFiles = {};
    }
    if (!project.content.settings.itemFiles[setting.name]) {
      project.content.settings.itemFiles[setting.name] = settingFile;
      needsSave = true;
    }
  }

  // Sync settings from disk - scan settings/ directory for .md files
  const settingsDir = join(agentDir, 'settings');
  if (existsSync(settingsDir)) {
    const settingFiles = readdirSync(settingsDir).filter(f => f.endsWith('.md'));

    for (const settingFile of settingFiles) {
      try {
        const settingContent = readFileSync(join(settingsDir, settingFile), 'utf-8');
        // Extract name from first heading or filename
        const nameMatch = settingContent.match(/^#\s*(?:Setting[:\-–—\s]*)?(.+)/m);
        const settingName = nameMatch && nameMatch[1]
          ? nameMatch[1].trim()
          : settingFile.replace(/\.md$/, '').replace(/[-_]/g, ' ');

        // Check if setting is already registered
        const existingSetting = project.settings.find(
          s => s.name.toLowerCase() === settingName.toLowerCase()
        );
        if (!existingSetting) {
          const setting = createDefaultSettingData(settingName);

          // If characters_settings phase is complete, mark as approved
          const charactersSettingsPhase = project.phases.characters_settings;
          if (charactersSettingsPhase?.status === 'completed') {
            setting.approvalStatus = 'approved';
            setting.approvedAt = Date.now();
          }

          project.settings.push(setting);
          needsSave = true;
        }
      } catch {
        /* ignore read errors */
      }
    }
  }

  if ((project.content.settings.items?.length ?? 0) > 0 && project.content.settings.status === 'missing') {
    project.content.settings.status = 'partial';
    needsSave = true;
  }

  // Sync scenes from project.scenes
  for (const scene of project.scenes) {
    const sceneName = scene.title || `Scene ${scene.sceneNumber}`;
    if (!project.content.scenes.items?.includes(sceneName)) {
      if (!project.content.scenes.items) {
        project.content.scenes.items = [];
      }
      project.content.scenes.items.push(sceneName);
      needsSave = true;
    }
  }
  if ((project.content.scenes.items?.length ?? 0) > 0 && project.content.scenes.status === 'missing') {
    project.content.scenes.status = 'partial';
    needsSave = true;
  }

  // Sync scenes from disk - scan scenes/ directory for scene-XXX/ folders
  // This catches scenes that were created but never registered in project.scenes
  const scenesDir = join(agentDir, 'scenes');
  if (existsSync(scenesDir)) {
    const sceneFolders = readdirSync(scenesDir)
      .filter(f => {
        const fullPath = join(scenesDir, f);
        return existsSync(fullPath) && /^scene-\d+$/.test(f);
      })
      .sort();

    for (const sceneFolder of sceneFolders) {
      const match = sceneFolder.match(/^scene-(\d+)$/);
      if (match && match[1]) {
        const sceneNumber = parseInt(match[1], 10);

        // Check if scene is already registered
        const existingScene = project.scenes.find(s => s.sceneNumber === sceneNumber);
        if (!existingScene) {
          // Create new scene ref
          const sceneRef = createDefaultSceneRef(sceneNumber);
          sceneRef.folder = `agent/scenes/${sceneFolder}`;
          sceneRef.file = `agent/scenes/${sceneFolder}/scene.md`;

          // Extract title from scene.md file content
          try {
            const sceneFilePath = join(scenesDir, sceneFolder, 'scene.md');
            if (existsSync(sceneFilePath)) {
              const sceneContent = readFileSync(sceneFilePath, 'utf-8');
              const titleMatch = sceneContent.match(/^#\s*(?:Scene\s*\d+[:\-–—\s]*)?(.+)/m);
              if (titleMatch && titleMatch[1]) {
                sceneRef.title = titleMatch[1].trim();
              }
            }
          } catch {
            /* ignore read errors */
          }

          // If scenes phase is complete, mark scene as approved
          if (project.phases.scenes?.status === 'completed') {
            sceneRef.contentApprovalStatus = 'approved';
            sceneRef.contentApprovedAt = Date.now();
          }

          project.scenes.push(sceneRef);
          needsSave = true;
        }
      }
    }

    // Sort scenes by number
    if (project.scenes.length > 0) {
      project.scenes.sort((a, b) => a.sceneNumber - b.sceneNumber);
    }

    // Update content registry with newly discovered scenes
    for (const scene of project.scenes) {
      const sceneName = scene.title || `Scene ${scene.sceneNumber}`;
      if (!project.content.scenes.items?.includes(sceneName)) {
        if (!project.content.scenes.items) {
          project.content.scenes.items = [];
        }
        project.content.scenes.items.push(sceneName);
        needsSave = true;
      }
    }
    if ((project.content.scenes.items?.length ?? 0) > 0 && project.content.scenes.status === 'missing') {
      project.content.scenes.status = 'partial';
      needsSave = true;
    }
  }

  return needsSave;
}

/**
 * Load an existing project file.
 * Returns null if project doesn't exist or is incompatible (old version).
 */
export function loadProject(basePath: string = process.cwd()): ProjectFile | null {
  const filePath = getProjectFilePath(basePath);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const project = JSON.parse(content);

    // Check version - must be 2.0 for 8-phase workflow
    if (!project.version || project.version !== '2.0') {
      console.warn(`[ProjectManager] Incompatible project version: ${project.version ?? 'unknown'}. Expected: 2.0`);
      console.warn('[ProjectManager] Please delete the .kshana directory and start a new project.');
      return null;
    }

    // Validate project_id exists and is a valid string for isolation
    if (!project.id || typeof project.id !== 'string' || project.id.trim().length === 0) {
      console.warn('[ProjectManager] Invalid project: missing or invalid project ID. Project isolation cannot be guaranteed.');
      console.warn('[ProjectManager] Please delete the .kshana directory and start a new project.');
      return null;
    }

    const { phase: normalizedPhase, changed } = normalizeCurrentPhaseForInputType(project);
    if (changed) {
      project.currentPhase = normalizedPhase;
    }

    // Sync content registry for backward compatibility
    const syncChanged = syncContentRegistry(project, basePath);

    if (changed || syncChanged) {
      saveProject(project, basePath);
    }

    return project as ProjectFile;
  } catch {
    return null;
  }
}

/**
 * Check if an existing project is compatible with the current workflow.
 */
export function isProjectCompatible(basePath: string = process.cwd()): { compatible: boolean; version?: string; reason?: string } {
  const filePath = getProjectFilePath(basePath);

  if (!existsSync(filePath)) {
    return { compatible: true, reason: 'No existing project' };
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const project = JSON.parse(content);

    if (!project.version) {
      return { compatible: false, version: 'unknown', reason: 'Old project without version (pre-2.0). Delete .kshana directory to start fresh.' };
    }

    if (project.version !== '2.0') {
      return { compatible: false, version: project.version, reason: `Incompatible version ${project.version}. Expected 2.0. Delete .kshana directory to start fresh.` };
    }

    return { compatible: true, version: project.version };
  } catch {
    return { compatible: false, reason: 'Failed to parse project file' };
  }
}

/**
 * Generate the project index from project.json and manifest.json.
 * The index contains state and pointers only, no content.
 * Follows Kshana Indexing Architecture invariants:
 * - Rule 1: Derivable from agent/project.json and agent/manifest.json
 * - Rule 2: No content in the index (only pointers, versions, state)
 * - Rule 3: Atomic updates (called after every project state change)
 * - Rule 4: Files win (filesystem is authoritative, index can be rebuilt)
 */
export function generateProjectIndex(basePath: string = process.cwd()): void {
  const project = loadProject(basePath);
  if (!project) {
    return;
  }

  const manifest = getAssets(basePath);
  const agentDir = getAgentDir(basePath);

  // Determine completed phases
  const completedPhases: WorkflowPhase[] = [];
  for (const [phaseKey, phaseInfo] of Object.entries(project.phases)) {
    if (phaseInfo.status === 'completed' || phaseInfo.status === 'skipped') {
      completedPhases.push(phaseKey as WorkflowPhase);
    }
  }

  // Detect blocking reasons
  const blockingReasons: string[] = [];
  const currentPhase = project.currentPhase;
  const phaseConfig = PHASE_CONFIGS[currentPhase];

  // Check for missing required content based on phase
  if (currentPhase === WorkflowPhase.VIDEO) {
    // Check if all scenes have approved images
    for (const scene of project.scenes) {
      if (scene.imageApprovalStatus !== 'approved') {
        blockingReasons.push(`scene-${String(scene.sceneNumber).padStart(3, '0')}:image_not_approved`);
      }
    }
  }

  if (currentPhase === WorkflowPhase.VIDEO_COMBINE) {
    // Check if all scenes have approved videos
    for (const scene of project.scenes) {
      if (scene.videoApprovalStatus !== 'approved') {
        blockingReasons.push(`scene-${String(scene.sceneNumber).padStart(3, '0')}:video_not_approved`);
      }
    }
  }

  // Build scene routing
  const sceneRouting: Record<string, SceneRoutingEntry> = {};
  let totalDuration = 0;

  for (const scene of project.scenes) {
    const sceneId = `scene-${String(scene.sceneNumber).padStart(3, '0')}`;
    const sceneFolder = scene.folder || `agent/scenes/${sceneId}`;

    // Find active versions from manifest
    const sceneVideos = manifest.filter(
      a => a.type === 'scene_video' && a.metadata && 'sceneNumber' in a.metadata && a.metadata['sceneNumber'] === scene.sceneNumber
    );
    const sceneImages = manifest.filter(
      a => (a.type === 'scene_image' || a.type === 'character_ref' || a.type === 'setting_ref') &&
        a.metadata && 'sceneNumber' in a.metadata && a.metadata['sceneNumber'] === scene.sceneNumber
    );

    // Determine active video version
    let activeVideoVersion: number | undefined;
    if (sceneVideos.length > 0) {
      activeVideoVersion = Math.max(...sceneVideos.map(v => {
        const version = v.metadata && 'version' in v.metadata ? v.metadata['version'] : undefined;
        return (typeof version === 'number' ? version : 1);
      }));
    }

    // Determine active image version
    let activeImageVersion: number | undefined;
    if (sceneImages.length > 0) {
      activeImageVersion = Math.max(...sceneImages.map(i => {
        const version = i.metadata && 'version' in i.metadata ? i.metadata['version'] : undefined;
        return (typeof version === 'number' ? version : 1);
      }));
    }

    // Check for audio files (scene-specific audio mix)
    let activeAudio: string | undefined;
    const sceneAudioPath = join(agentDir, sceneFolder.replace('agent/', ''), 'audio', 'mix.mp3');
    if (existsSync(sceneAudioPath)) {
      activeAudio = 'mix.mp3';
    }

    // Estimate duration (could be enhanced to read actual video duration)
    const estimatedDuration = 5; // Default 5 seconds per scene
    totalDuration += estimatedDuration;

    sceneRouting[String(scene.sceneNumber).padStart(3, '0')] = {
      id: sceneId,
      folder: sceneFolder,
      active: {
        video: activeVideoVersion,
        audio: activeAudio,
        image: activeImageVersion,
      },
      status: {
        content: scene.contentApprovalStatus || 'pending',
        image: scene.imageApprovalStatus || 'pending',
        video: scene.videoApprovalStatus || 'pending',
        // Audio approval status is not yet in SceneRef, will be added when audio phase is implemented
        // audio: scene.audioApprovalStatus,
      },
      duration: estimatedDuration,
    };
  }

  // Build entity routing (characters and settings)
  const characterRouting: Record<string, EntityRoutingEntry> = {};
  for (const char of project.characters) {
    const safeName = char.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const charPath = `agent/characters/${safeName}`;
    characterRouting[safeName] = {
      path: charPath,
      ready: char.approvalStatus === 'approved',
      has_ref_image: !!char.referenceImageId && char.referenceImageApprovalStatus === 'approved',
    };
  }

  const settingRouting: Record<string, EntityRoutingEntry> = {};
  for (const setting of project.settings) {
    const safeName = setting.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const settingPath = `agent/settings/${safeName}`;
    settingRouting[safeName] = {
      path: settingPath,
      ready: setting.approvalStatus === 'approved',
      has_ref_image: !!setting.referenceImageId && setting.referenceImageApprovalStatus === 'approved',
    };
  }

  // Calculate asset counts
  const assetCounts = {
    video: manifest.filter(a => a.type === 'scene_video' || a.type === 'final_video').length,
    audio: 0, // Audio files are not in manifest, they're in scene folders
    image: manifest.filter(a => a.type === 'scene_image' || a.type === 'character_ref' || a.type === 'setting_ref').length,
  };

  // Count audio files from scene folders
  for (const scene of project.scenes) {
    const sceneFolder = scene.folder || `agent/scenes/scene-${String(scene.sceneNumber).padStart(3, '0')}`;
    const audioDir = join(agentDir, sceneFolder.replace('agent/', ''), 'audio');
    if (existsSync(audioDir)) {
      const audioFiles = readdirSync(audioDir).filter(f => f.endsWith('.mp3') || f.endsWith('.wav'));
      assetCounts.audio += audioFiles.length;
    }
  }

  // Load context variables from ContextStore to merge into consolidated index
  const contextVariables: Record<string, import('../../../core/context/index.js').StoredContextMeta> = {};
  try {
    const activeVars = contextStore.getActiveVariables();
    for (const v of activeVars) {
      const meta = contextStore.getMeta(v.variableName);
      if (meta) {
        contextVariables[v.variableName] = meta;
      }
    }
  } catch {
    // If ContextStore is not available, use empty object
  }

  // Create consolidated index with context variables merged
  const index = {
    index_version: '1.0' as const,
    project_id: project.id,
    last_modified: project.updatedAt,

    // Merge context variables from ContextStore
    context: {
      variables: contextVariables,
    },

    workflow: {
      current_phase: project.currentPhase,
      completed_phases: completedPhases,
      is_blocked: blockingReasons.length > 0,
      blocking_reasons: blockingReasons,
    },

    routing: {
      scenes: sceneRouting,
      entities: {
        characters: characterRouting,
        settings: settingRouting,
      },
    },

    stats: {
      total_scenes: project.scenes.length,
      total_duration: totalDuration,
      asset_counts: assetCounts,
    },
  };

  // Save to consolidated index location: context/index.json (project_id is inside the file)
  const indexPath = getProjectIndexPath(basePath);
  const contextDir = join(getProjectDir(basePath), 'context');
  if (!existsSync(contextDir)) {
    mkdirSync(contextDir, { recursive: true });
  }
  writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
}

/**
 * Read the project index.
 * Returns null if index doesn't exist or is invalid.
 * 
 * Reads from consolidated location (context/index.json).
 * Falls back to old locations for migration:
 * 1. context/{project_id}/index.json (old subfolder structure)
 * 2. index/project_index.json (very old location)
 */
export function readProjectIndex(basePath: string = process.cwd()): ProjectIndex | null {
  const project = loadProject(basePath);
  if (!project) {
    return null;
  }

  // Try new consolidated location first: context/index.json
  const consolidatedPath = getProjectIndexPath(basePath);
  if (existsSync(consolidatedPath)) {
    try {
      const data = JSON.parse(readFileSync(consolidatedPath, 'utf-8')) as ProjectIndex;
      // Validate index version
      if (data.index_version !== '1.0') {
        console.warn(`[ProjectManager] Incompatible index version: ${data.index_version}. Expected: 1.0`);
        return null;
      }
      // Validate project_id matches
      if (data.project_id !== project.id) {
        console.warn(`[ProjectManager] Index project_id (${data.project_id}) doesn't match project.id (${project.id})`);
        // Still return it, but log the mismatch
      }
      return data;
    } catch (err) {
      console.warn(`[ProjectManager] Failed to parse consolidated index: ${err}`);
      // Try fallback locations
    }
  }

  // Fallback 1: Old subfolder structure context/{project_id}/index.json
  const oldSubfolderPath = join(getProjectDir(basePath), 'context', project.id, 'index.json');
  if (existsSync(oldSubfolderPath)) {
    try {
      const data = JSON.parse(readFileSync(oldSubfolderPath, 'utf-8')) as ProjectIndex;
      // Migrate to new location
      const contextDir = join(getProjectDir(basePath), 'context');
      if (!existsSync(contextDir)) {
        mkdirSync(contextDir, { recursive: true });
      }
      writeFileSync(consolidatedPath, JSON.stringify(data, null, 2), 'utf-8');
      return data;
    } catch {
      // Continue to next fallback
    }
  }

  // Fallback 2: Very old location index/project_index.json
  const oldIndexPath = join(getIndexDir(basePath), PROJECT_INDEX_FILE);
  if (existsSync(oldIndexPath)) {
    try {
      const data = JSON.parse(readFileSync(oldIndexPath, 'utf-8')) as ProjectIndex;
      // Migrate to new location
      const contextDir = join(getProjectDir(basePath), 'context');
      if (!existsSync(contextDir)) {
        mkdirSync(contextDir, { recursive: true });
      }
      writeFileSync(consolidatedPath, JSON.stringify(data, null, 2), 'utf-8');
      return data;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Rebuild the project index from project.json and manifest.json.
 * This enforces Rule 4: Files Win - if index is out of sync, rebuild it.
 * Should be called when index is missing or when filesystem changes are detected.
 */
export function rebuildProjectIndex(basePath: string = process.cwd()): void {
  generateProjectIndex(basePath);
}

/**
 * Save the project file and regenerate the project index.
 */
export function saveProject(project: ProjectFile, basePath: string = process.cwd()): void {
  const filePath = getProjectFilePath(basePath);
  project.updatedAt = Date.now();
  writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf-8');

  // Regenerate project index after every save
  generateProjectIndex(basePath);
}

/**
 * Read the original user input from its file.
 */
export function getOriginalInput(project: ProjectFile, basePath: string = process.cwd()): string {
  // Handle both old format (original_input.md) and new format (agent/original_input.md)
  const inputFile = project.originalInputFile.startsWith('agent/')
    ? project.originalInputFile
    : `agent/${project.originalInputFile}`;
  const inputPath = join(getProjectDir(basePath), inputFile);
  if (existsSync(inputPath)) {
    return readFileSync(inputPath, 'utf-8');
  }
  return '';
}

/**
 * Get or create a project.
 */
export function getOrCreateProject(
  originalInput: string,
  style: ProjectStyle = 'cinematic_realism',
  basePath: string = process.cwd()
): ProjectFile {
  const existing = loadProject(basePath);
  if (existing) {
    // CRITICAL: If originalInput looks like a transcript but project has wrong inputType, fix it
    if (originalInput && looksLikeSrt(originalInput) && existing.inputType !== 'youtube_srt' && existing.inputType !== 'script') {
      // Update input type to youtube_srt and normalize phase
      const updated = setProjectInputType('youtube_srt', basePath);
      if (updated) {
        return updated;
      }
    }
    // Normalize phase for existing project (handles legacy phases)
    const normalized = normalizeCurrentPhaseForInputType(existing);
    if (normalized.changed) {
      existing.currentPhase = normalized.phase;
      saveProject(existing, basePath);
    }
    return existing;
  }
  return createProject(originalInput, style, basePath);
}

/**
 * Get the current workflow phase from the project.
 */
export function getCurrentPhase(project: ProjectFile): WorkflowPhase {
  return normalizeCurrentPhaseForInputType(project).phase;
}

/**
 * Get the project style.
 */
export function getProjectStyle(basePath: string = process.cwd()): ProjectStyle {
  const project = loadProject(basePath);
  return project?.style ?? 'cinematic_realism';
}

/**
 * Get the style configuration for the current project.
 */
export function getProjectStyleConfig(basePath: string = process.cwd()): StyleConfig {
  const style = getProjectStyle(basePath);
  return STYLE_CONFIGS[style];
}

/**
 * Update a phase's status.
 * Note: Planning is done at project level, not per-phase.
 */
export function updatePhaseStatus(
  project: ProjectFile,
  phase: keyof ProjectFile['phases'],
  status: PhaseStatus,
  basePath: string = process.cwd()
): ProjectFile {
  const phaseInfo = project.phases[phase];
  phaseInfo.status = status;

  if (status === 'completed') {
    phaseInfo.completedAt = Date.now();
  }

  saveProject(project, basePath);
  return project;
}

/**
 * Update the project-level master plan stage.
 * This is the single plan that governs all phases.
 */
export function updatePlanStage(
  project: ProjectFile,
  stage: PlannerStage,
  basePath: string = process.cwd()
): ProjectFile {
  project.plan.stage = stage;

  if (stage === PlannerStage.REFINING) {
    project.plan.refinementCount += 1;
  }

  if (stage === PlannerStage.COMPLETE) {
    project.plan.approvedAt = Date.now();
    // When master plan is approved, mark the first phase as in_progress
    const firstPhaseKey = project.currentPhase as keyof typeof project.phases;
    if (project.phases[firstPhaseKey] && project.phases[firstPhaseKey].status === 'pending') {
      project.phases[firstPhaseKey].status = 'in_progress';
    }
  }

  saveProject(project, basePath);
  return project;
}

/**
 * @deprecated Use updatePlanStage instead. Planning is now at project level.
 */
export function updatePlannerStage(
  project: ProjectFile,
  _phase: keyof ProjectFile['phases'],
  stage: PlannerStage,
  basePath: string = process.cwd()
): ProjectFile {
  // Redirect to project-level plan stage update
  return updatePlanStage(project, stage, basePath);
}

/**
 * Transition to the next phase based on current state.
 * Requires project-level plan to be approved before phases can progress.
 */
export function transitionToNextPhase(
  project: ProjectFile,
  basePath: string = process.cwd()
): { project: ProjectFile; transitioned: boolean; reason: string } {
  const isYouTubeWorkflow = isYouTubeInputType(project.inputType);

  // Check if master plan is approved (legacy workflow only)
  if (!isYouTubeWorkflow && project.plan.stage !== PlannerStage.COMPLETE) {
    return {
      project,
      transitioned: false,
      reason: 'Master plan must be approved before transitioning phases. Current stage: ' + project.plan.stage
    };
  }

  const result = determineNextPhase(project);

  if (result.nextPhase !== project.currentPhase) {
    project.currentPhase = result.nextPhase;

    // Mark new phase as in_progress (no per-phase planning)
    const phaseKey = result.nextPhase as keyof typeof project.phases;
    if (project.phases[phaseKey]) {
      project.phases[phaseKey].status = 'in_progress';
    }

    saveProject(project, basePath);
    return { project, transitioned: true, reason: result.reason };
  }

  return { project, transitioned: false, reason: result.reason };
}

/**
 * Check if a plan file has content.
 */
export function planFileHasContent(planFile: string, basePath: string = process.cwd()): boolean {
  // Handle both old format (plans/...) and new format (agent/plans/...)
  const normalizedFile = planFile.startsWith('agent/') ? planFile : `agent/${planFile}`;
  const filePath = join(getProjectDir(basePath), normalizedFile);

  if (!existsSync(filePath)) {
    return false;
  }

  const content = readFileSync(filePath, 'utf-8').trim();
  return content.length > 0;
}

/**
 * Read a file from the project directory.
 * Paths should be relative to .kshana/ (e.g., "agent/plans/plot.md" or "context/index.json").
 */
export function readProjectFile(relativePath: string, basePath: string = process.cwd()): string | null {
  // If path doesn't start with agent/, context/, or index/, assume it's an agent file
  const normalizedPath = relativePath.startsWith('agent/') || relativePath.startsWith('context/') || relativePath.startsWith('index/')
    ? relativePath
    : `agent/${relativePath}`;
  const filePath = join(getProjectDir(basePath), normalizedPath);

  if (!existsSync(filePath)) {
    return null;
  }

  return readFileSync(filePath, 'utf-8');
}

/**
 * Write a file to the project directory.
 * Paths should be relative to .kshana/ (e.g., "agent/plans/plot.md" or "context/index.json").
 */
export function writeProjectFile(
  relativePath: string,
  content: string,
  basePath: string = process.cwd()
): void {
  // If path doesn't start with agent/, context/, or index/, assume it's an agent file
  const normalizedPath = relativePath.startsWith('agent/') || relativePath.startsWith('context/') || relativePath.startsWith('index/')
    ? relativePath
    : `agent/${relativePath}`;
  const projectDir = getProjectDir(basePath);
  const filePath = join(projectDir, normalizedPath);

  // Ensure parent directory exists
  const parentDir = join(filePath, '..');
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  writeFileSync(filePath, content, 'utf-8');
}

/**
 * Format character data as markdown.
 */
function formatCharacterMarkdown(character: CharacterData): string {
  let md = `# ${character.name}\n\n`;
  md += `## Description\n\n${character.description}\n\n`;
  md += `## Visual Description\n\n${character.visualDescription}\n`;
  if (character.referenceImageId) {
    md += `\n## Reference Image\n\n- Image ID: ${character.referenceImageId}\n`;
    if (character.referenceImagePath) {
      md += `- Path: ${character.referenceImagePath}\n`;
    }
  }
  return md;
}

/**
 * Save character data to characters/[name].md and update project.
 */
export function saveCharacter(
  character: CharacterData,
  basePath: string = process.cwd()
): void {
  const safeName = character.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const filePath = `agent/characters/${safeName}.md`;
  writeProjectFile(filePath, formatCharacterMarkdown(character), basePath);

  // Update project file's character list (now CharacterData[])
  const project = loadProject(basePath);
  if (project) {
    const existingIndex = project.characters.findIndex(c => c.name === character.name);
    if (existingIndex >= 0) {
      project.characters[existingIndex] = character;
    } else {
      project.characters.push(character);
    }
    // Also track in content registry for persistence across restarts
    addContentItem(project, 'characters', character.name, filePath, basePath);
    // Note: addContentItem calls saveProject internally
  }
}

/**
 * Add a character to the project (creates default entry if only name provided).
 */
export function addCharacter(
  name: string,
  basePath: string = process.cwd()
): CharacterData {
  const project = loadProject(basePath);
  if (!project) {
    throw new Error('No project found');
  }

  // Check if character already exists
  const existing = project.characters.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    return existing;
  }

  // Create new character with default values
  const character = createDefaultCharacterData(name);
  project.characters.push(character);
  saveProject(project, basePath);

  return character;
}

/**
 * Update a character's data.
 */
export function updateCharacter(
  name: string,
  updates: Partial<CharacterData>,
  basePath: string = process.cwd()
): CharacterData | null {
  const project = loadProject(basePath);
  if (!project) return null;

  const index = project.characters.findIndex(c => c.name.toLowerCase() === name.toLowerCase());
  if (index < 0) return null;

  const existing = project.characters[index];
  if (!existing) return null;

  const updated: CharacterData = { ...existing, ...updates };
  project.characters[index] = updated;
  saveProject(project, basePath);

  // Only save to markdown file if:
  // 1. Description or visual description was updated, AND
  // 2. The update contains actual content (not variable references or empty), AND
  // 3. Either the file doesn't exist, or we're explicitly updating with full content
  if (updates.description || updates.visualDescription) {
    // Check if the file already exists with content
    const existingContent = loadCharacterMarkdown(name, basePath);
    const fileAlreadyExists = existingContent !== null && existingContent.trim().length > 0;

    // Check if the update is a variable reference (starts with $)
    const isVariableRef = (updates.description?.startsWith('$') || updates.visualDescription?.startsWith('$'));

    // Only save if:
    // - File doesn't exist, OR
    // - File exists but update has actual non-variable-ref content
    const hasActualContent = (updated.description && !updated.description.startsWith('$')) ||
      (updated.visualDescription && !updated.visualDescription.startsWith('$'));

    if (!fileAlreadyExists || (hasActualContent && !isVariableRef)) {
      saveCharacter(updated, basePath);
    }
    // Otherwise, just update project.json registry without overwriting the file
  }

  return updated;
}

/**
 * Update a character's approval status.
 * @param approvalType - 'content' for description approval (CHARACTERS_SETTINGS phase), 'image' for reference image approval (CHARACTER_SETTING_IMAGES phase)
 */
export function updateCharacterApproval(
  name: string,
  status: ItemApprovalStatus,
  approvalType: 'content' | 'image' = 'content',
  feedback?: string,
  basePath: string = process.cwd()
): CharacterData | null {
  const project = loadProject(basePath);
  if (!project) return null;

  const index = project.characters.findIndex(c => c.name.toLowerCase() === name.toLowerCase());
  if (index < 0) return null;

  const character = project.characters[index];
  if (!character) return null;

  if (approvalType === 'image') {
    // Update reference image approval status
    character.referenceImageApprovalStatus = status;
    if (status === 'approved') {
      character.referenceImageApprovedAt = Date.now();
    }
  } else {
    // Update content approval status
    character.approvalStatus = status;
    if (status === 'approved') {
      character.approvedAt = Date.now();
    }
  }

  if (status === 'regenerating') {
    character.regenerationCount++;
  }

  saveProject(project, basePath);
  return character;
}

/**
 * Load character markdown from characters/[name].md.
 * Returns the raw markdown content (parsing not needed for index-only approach).
 */
export function loadCharacterMarkdown(name: string, basePath: string = process.cwd()): string | null {
  const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return readProjectFile(`agent/characters/${safeName}.md`, basePath);
}

/**
 * Format setting data as markdown.
 */
function formatSettingMarkdown(setting: SettingData): string {
  let md = `# ${setting.name}\n\n`;
  md += `## Description\n\n${setting.description}\n\n`;
  md += `## Visual Description\n\n${setting.visualDescription}\n`;
  if (setting.referenceImageId) {
    md += `\n## Reference Image\n\n- Image ID: ${setting.referenceImageId}\n`;
    if (setting.referenceImagePath) {
      md += `- Path: ${setting.referenceImagePath}\n`;
    }
  }
  return md;
}

/**
 * Save setting data to settings/[name].md and update project.
 */
export function saveSetting(setting: SettingData, basePath: string = process.cwd()): void {
  const safeName = setting.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const filePath = `agent/settings/${safeName}.md`;
  writeProjectFile(filePath, formatSettingMarkdown(setting), basePath);

  // Update project file's setting list (now SettingData[])
  const project = loadProject(basePath);
  if (project) {
    const existingIndex = project.settings.findIndex(s => s.name === setting.name);
    if (existingIndex >= 0) {
      project.settings[existingIndex] = setting;
    } else {
      project.settings.push(setting);
    }
    // Also track in content registry for persistence across restarts
    addContentItem(project, 'settings', setting.name, filePath, basePath);
    // Note: addContentItem calls saveProject internally
  }
}

/**
 * Add a setting to the project (creates default entry if only name provided).
 */
export function addSetting(
  name: string,
  basePath: string = process.cwd()
): SettingData {
  const project = loadProject(basePath);
  if (!project) {
    throw new Error('No project found');
  }

  // Check if setting already exists
  const existing = project.settings.find(s => s.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    return existing;
  }

  // Create new setting with default values
  const setting = createDefaultSettingData(name);
  project.settings.push(setting);
  saveProject(project, basePath);

  return setting;
}

/**
 * Update a setting's data.
 */
export function updateSetting(
  name: string,
  updates: Partial<SettingData>,
  basePath: string = process.cwd()
): SettingData | null {
  const project = loadProject(basePath);
  if (!project) return null;

  const index = project.settings.findIndex(s => s.name.toLowerCase() === name.toLowerCase());
  if (index < 0) return null;

  const existing = project.settings[index];
  if (!existing) return null;

  const updated: SettingData = { ...existing, ...updates };
  project.settings[index] = updated;
  saveProject(project, basePath);

  // Only save to markdown file if:
  // 1. Description or visual description was updated, AND
  // 2. The update contains actual content (not variable references or empty), AND
  // 3. Either the file doesn't exist, or we're explicitly updating with full content
  if (updates.description || updates.visualDescription) {
    // Check if the file already exists with content
    const existingContent = loadSettingMarkdown(name, basePath);
    const fileAlreadyExists = existingContent !== null && existingContent.trim().length > 0;

    // Check if the update is a variable reference (starts with $)
    const isVariableRef = (updates.description?.startsWith('$') || updates.visualDescription?.startsWith('$'));

    // Only save if:
    // - File doesn't exist, OR
    // - File exists but update has actual non-variable-ref content
    const hasActualContent = (updated.description && !updated.description.startsWith('$')) ||
      (updated.visualDescription && !updated.visualDescription.startsWith('$'));

    if (!fileAlreadyExists || (hasActualContent && !isVariableRef)) {
      saveSetting(updated, basePath);
    }
    // Otherwise, just update project.json registry without overwriting the file
  }

  return updated;
}

/**
 * Update a setting's approval status.
 * @param approvalType - 'content' for description approval (CHARACTERS_SETTINGS phase), 'image' for reference image approval (CHARACTER_SETTING_IMAGES phase)
 */
export function updateSettingApproval(
  name: string,
  status: ItemApprovalStatus,
  approvalType: 'content' | 'image' = 'content',
  feedback?: string,
  basePath: string = process.cwd()
): SettingData | null {
  const project = loadProject(basePath);
  if (!project) return null;

  const index = project.settings.findIndex(s => s.name.toLowerCase() === name.toLowerCase());
  if (index < 0) return null;

  const setting = project.settings[index];
  if (!setting) return null;

  if (approvalType === 'image') {
    // Update reference image approval status
    setting.referenceImageApprovalStatus = status;
    if (status === 'approved') {
      setting.referenceImageApprovedAt = Date.now();
    }
  } else {
    // Update content approval status
    setting.approvalStatus = status;
    if (status === 'approved') {
      setting.approvedAt = Date.now();
    }
  }

  if (status === 'regenerating') {
    setting.regenerationCount++;
  }

  saveProject(project, basePath);
  return setting;
}

/**
 * Load setting markdown from settings/[name].md.
 * Returns the raw markdown content.
 */
export function loadSettingMarkdown(name: string, basePath: string = process.cwd()): string | null {
  const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return readProjectFile(`agent/settings/${safeName}.md`, basePath);
}

/**
 * Add a scene reference to the project.
 * Scene content is stored in agent/scenes/scene-XXX/scene.md files.
 */
export function addScene(sceneRef: SceneRef, basePath: string = process.cwd()): void {
  const project = loadProject(basePath);
  if (!project) return;

  // Ensure scene has folder and file paths
  if (!sceneRef.folder) {
    sceneRef.folder = `agent/scenes/scene-${String(sceneRef.sceneNumber).padStart(3, '0')}`;
  }
  if (!sceneRef.file) {
    sceneRef.file = `${sceneRef.folder}/scene.md`;
  }

  // Create scene directory if it doesn't exist
  const sceneFolderPath = join(getProjectDir(basePath), sceneRef.folder);
  if (!existsSync(sceneFolderPath)) {
    mkdirSync(sceneFolderPath, { recursive: true });
  }

  // Check if scene already exists
  const existingIndex = project.scenes.findIndex((s) => s.sceneNumber === sceneRef.sceneNumber);
  if (existingIndex >= 0) {
    project.scenes[existingIndex] = sceneRef;
  } else {
    project.scenes.push(sceneRef);
    project.scenes.sort((a, b) => a.sceneNumber - b.sceneNumber);
  }

  // Also track in content registry for persistence across restarts
  const sceneName = sceneRef.title || `Scene ${sceneRef.sceneNumber}`;
  addContentItem(project, 'scenes', sceneName, sceneRef.file, basePath);
  // Note: addContentItem calls saveProject internally
}

/**
 * Maximum number of scenes allowed per project.
 * This is a hard limit to prevent infinite loops.
 */
export const MAX_SCENES = 12;

/**
 * Add a new scene to the project (creates default entry).
 * Throws an error if the scene limit is exceeded.
 */
export function addNewScene(
  sceneNumber: number,
  title?: string,
  basePath: string = process.cwd()
): SceneRef {
  const project = loadProject(basePath);
  if (!project) {
    throw new Error('No project found');
  }

  // HARD LIMIT: Prevent infinite scene creation
  if (sceneNumber > MAX_SCENES) {
    throw new Error(`⛔ SCENE LIMIT EXCEEDED: Maximum ${MAX_SCENES} scenes allowed. Scene ${sceneNumber} cannot be created.`);
  }

  // Check if scene already exists
  const existing = project.scenes.find(s => s.sceneNumber === sceneNumber);
  if (existing) {
    return existing;
  }

  // Create new scene with default values
  const scene = createDefaultSceneRef(sceneNumber, title);

  // Create scene directory
  const sceneFolderPath = join(getProjectDir(basePath), scene.folder!);
  if (!existsSync(sceneFolderPath)) {
    mkdirSync(sceneFolderPath, { recursive: true });
  }

  project.scenes.push(scene);
  project.scenes.sort((a, b) => a.sceneNumber - b.sceneNumber);
  saveProject(project, basePath);

  return scene;
}

/**
 * Update a scene's data.
 */
export function updateScene(
  sceneNumber: number,
  updates: Partial<SceneRef>,
  basePath: string = process.cwd()
): SceneRef | null {
  const project = loadProject(basePath);
  if (!project) return null;

  const index = project.scenes.findIndex(s => s.sceneNumber === sceneNumber);
  if (index < 0) return null;

  const existing = project.scenes[index];
  if (!existing) return null;

  const updated: SceneRef = { ...existing, ...updates };
  project.scenes[index] = updated;
  saveProject(project, basePath);

  return updated;
}

/**
 * Update a scene's approval status for a specific phase.
 */
export function updateSceneApproval(
  sceneNumber: number,
  phase: 'content' | 'image' | 'video',
  status: ItemApprovalStatus,
  feedback?: string,
  basePath: string = process.cwd()
): SceneRef | null {
  const project = loadProject(basePath);
  if (!project) return null;

  const index = project.scenes.findIndex(s => s.sceneNumber === sceneNumber);
  if (index < 0) return null;

  const scene = project.scenes[index];
  if (!scene) return null;

  switch (phase) {
    case 'content':
      scene.contentApprovalStatus = status;
      if (status === 'approved') {
        scene.contentApprovedAt = Date.now();
      }
      break;
    case 'image':
      scene.imageApprovalStatus = status;
      if (status === 'approved') {
        scene.imageApprovedAt = Date.now();
      }
      break;
    case 'video':
      scene.videoApprovalStatus = status;
      if (status === 'approved') {
        scene.videoApprovedAt = Date.now();
      }
      break;
  }

  if (status === 'regenerating') {
    scene.regenerationCount++;
  }
  if (feedback) {
    scene.feedback = feedback;
  }

  saveProject(project, basePath);
  return scene;
}

/**
 * Add an asset to the manifest.
 */
export function addAsset(asset: AssetInfo, basePath: string = process.cwd()): void {
  const manifestPath = getManifestFilePath(basePath);

  let manifest: { schema_version?: string; assets: AssetInfo[] } = { assets: [] };
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    } catch {
      // Use empty manifest on parse error
    }
  }

  // Ensure schema_version is set
  if (!manifest.schema_version) {
    manifest.schema_version = '1';
  }

  // Check if asset already exists
  const existingIndex = manifest.assets.findIndex((a) => a.id === asset.id);
  if (existingIndex >= 0) {
    manifest.assets[existingIndex] = asset;
  } else {
    manifest.assets.push(asset);
  }

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  // Update project file's asset list
  const project = loadProject(basePath);
  if (project && !project.assets.includes(asset.id)) {
    project.assets.push(asset.id);

    // Also track in content registry for persistence across restarts
    // Map asset types to content types
    const contentType: ContentTypeName | null =
      asset.type === 'scene_image' || asset.type === 'character_ref' || asset.type === 'setting_ref'
        ? 'images'
        : asset.type === 'scene_video' || asset.type === 'final_video'
          ? 'videos'
          : null;

    if (contentType) {
      addContentItem(project, contentType, asset.id, asset.path, basePath);
    } else {
      saveProject(project, basePath);
    }
  }
}

/**
 * Get all assets from the manifest.
 */
export function getAssets(basePath: string = process.cwd()): AssetInfo[] {
  const manifestPath = getManifestFilePath(basePath);

  if (!existsSync(manifestPath)) {
    return [];
  }

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    return manifest.assets || [];
  } catch {
    return [];
  }
}

/**
 * Get the project summary for the main agent.
 */
export function getProjectSummary(basePath: string = process.cwd()): string {
  const project = loadProject(basePath);

  if (!project) {
    return 'No project found. A new project will be created.';
  }

  const currentPhase = project.currentPhase;
  const phaseConfig = PHASE_CONFIGS[currentPhase];
  const phaseInfo = project.phases[currentPhase as keyof typeof project.phases];

  const completedPhases = Object.entries(project.phases)
    .filter(([, info]) => info.status === 'completed')
    .map(([key]) => key);

  // Get character and setting names from the data arrays
  const characterNames = project.characters.map(c => c.name);
  const settingNames = project.settings.map(s => s.name);

  // Get per-item approval status for current phase if applicable
  const phaseConfig2 = PHASE_CONFIGS[currentPhase];
  let itemProgress = '';
  if (phaseConfig2.requiresPerItemApproval) {
    const { approved, total } = countApprovedItems(project, currentPhase);
    itemProgress = `\nItem Progress: ${approved}/${total} approved`;
  }

  // Get style display name
  const styleConfig = STYLE_CONFIGS[project.style];
  const styleDisplay = styleConfig ? styleConfig.displayName : project.style;

  // Get input type display name
  const inputTypeConfig = INPUT_TYPE_CONFIGS[project.inputType];
  const inputTypeDisplay = inputTypeConfig ? inputTypeConfig.displayName : project.inputType;

  // Get skipped phases
  const skippedPhases = Object.entries(project.phases)
    .filter(([, info]) => info.status === 'skipped')
    .map(([key]) => key);

  // Scene limit warning
  let sceneLimitWarning = '';
  if (currentPhase === 'scenes') {
    const sceneCount = project.scenes.length;
    if (sceneCount >= MAX_SCENES) {
      sceneLimitWarning = `\n⛔ SCENE LIMIT REACHED: You have ${sceneCount} scenes. Maximum is ${MAX_SCENES}. STOP creating scenes and transition to the next phase NOW.`;
    } else if (sceneCount >= MAX_SCENES - 2) {
      sceneLimitWarning = `\n⚠️ APPROACHING SCENE LIMIT: ${sceneCount}/${MAX_SCENES} scenes. Finish up soon.`;
    }
  }

  // Plan status
  const planStatus = project.plan.stage === PlannerStage.COMPLETE
    ? `✅ Approved (ID: ${project.plan.planId})`
    : `⏳ ${project.plan.stage} (ID: ${project.plan.planId})`;

  return `
Project: ${project.title || '(untitled)'}
ID: ${project.id}
Version: ${project.version}
Style: ${styleDisplay}
Input Type: ${inputTypeDisplay}
Master Plan: ${planStatus}
Current Phase: ${phaseConfig.displayName} (${currentPhase})
Phase Status: ${phaseInfo?.status ?? 'not started'}
Completed Phases: ${completedPhases.length > 0 ? completedPhases.join(', ') : 'none'}
Skipped Phases: ${skippedPhases.length > 0 ? skippedPhases.join(', ') : 'none'}
Characters: ${characterNames.length > 0 ? characterNames.join(', ') : 'none defined'}
Settings: ${settingNames.length > 0 ? settingNames.join(', ') : 'none defined'}
Scenes: ${project.scenes.length}/${MAX_SCENES} (max)
Assets: ${project.assets.length}${itemProgress}${sceneLimitWarning}
`.trim();
}

/**
 * Get the state transition prompt for the main agent.
 * This tells the agent what phase it's in and what to do next.
 * Planning is done at project level - all phases execute based on the approved master plan.
 */
export function getStateTransitionPrompt(basePath: string = process.cwd()): string {
  const project = loadProject(basePath);

  if (!project) {
    return 'No project exists. Create a new project first.';
  }

  const currentPhase = project.currentPhase;
  const phaseConfig = PHASE_CONFIGS[currentPhase];
  const phaseInfo = project.phases[currentPhase as keyof typeof project.phases];
  const isYouTubeWorkflow = isYouTubeInputType(project.inputType);
  const masterPlanStage = project.plan.stage;
  const masterPlanExists = planFileHasContent(project.plan.planFile, basePath);

  // For YouTube workflow, skip all master plan logic
  if (isYouTubeWorkflow) {
    let instruction = `
## Current State
- **Phase**: ${phaseConfig.displayName}
- **Phase Status**: ${phaseInfo?.status ?? 'pending'}
- **Per-Item Approval Required**: ${phaseConfig.requiresPerItemApproval ? 'YES' : 'NO'}

## What to Do Next
`;

    // For YouTube workflow, transcript_input should transition to planning immediately
    if (currentPhase === WorkflowPhase.TRANSCRIPT_INPUT) {
      if (phaseInfo?.status === 'completed' || phaseInfo?.status === 'skipped') {
        instruction += `
Transcript parsing is complete. Transition to planning phase.
1. Call update_project with action "transition_phase" to move to "planning"
`;
        return instruction.trim();
      }
    }

    // Proceed with phase execution for YouTube workflow
    instruction += `
✅ **Phase ready** - Executing phase: ${phaseConfig.displayName}

Follow the phase-specific instructions. Each phase should:
1. Call the appropriate subagent via Task()
2. Extract result.output and save to the correct file
3. Mark phase as completed
4. Transition to next phase
`;

    // For phases requiring per-item approval, provide specific instructions
    if (phaseConfig.requiresPerItemApproval) {
      instruction += getPerItemPhaseInstructions(project, phaseConfig, basePath);
    } else {
      // Standard single-item phase flow
      const phaseStatus = phaseInfo?.status ?? 'pending';

      if (phaseStatus === 'completed') {
        instruction += `
The ${phaseConfig.displayName} phase is complete.
1. Use transition_phase to move to the next phase: ${phaseConfig.nextPhase && PHASE_CONFIGS[phaseConfig.nextPhase] ? PHASE_CONFIGS[phaseConfig.nextPhase].displayName : 'DONE'}
`;
      } else {
        // For YouTube workflow phases, they use Task() with subagents
        instruction += `
Execute the ${phaseConfig.displayName} phase.
1. Follow the phase-specific instructions below
2. Call the appropriate subagent via Task()
3. Save the result to the correct file
4. Mark phase as complete and transition to next phase
`;
      }
    }

    return instruction.trim();
  }

  // Legacy workflow (non-YouTube) - includes master plan logic
  let instruction = `
## Current State
- **Phase**: ${phaseConfig.displayName}
- **Phase Status**: ${phaseInfo?.status ?? 'pending'}
- **Master Plan**: ${project.plan.planFile}
- **Master Plan ID**: ${project.plan.planId}
- **Master Plan Stage**: ${masterPlanStage}
- **Master Plan Has Content**: ${masterPlanExists ? 'YES' : 'NO'}
- **Per-Item Approval Required**: ${phaseConfig.requiresPerItemApproval ? 'YES' : 'NO'}

## What to Do Next
`;

  // Check if master plan needs to be created/approved first (legacy workflow only)
  if (masterPlanStage !== PlannerStage.COMPLETE) {
    switch (masterPlanStage) {
      case PlannerStage.PLANNING:
        if (masterPlanExists) {
          instruction += `
The master plan exists. Present it to the user for approval.
1. Use ask_user to present a summary and ask for approval
2. If approved, call update_project with action "update_plan_stage" and stage "complete"
3. If feedback is given, call update_project with action "update_plan_stage" and stage "refining"
`;
        } else {
          instruction += `
**CREATE MASTER PLAN FIRST**

Before executing any phase, you must create a master plan that covers the entire video generation workflow.

1. Read the user's original input from agent/original_input.md
2. Create a comprehensive master plan that outlines:
   - Plot summary and key story beats
   - Main characters to be visualized
   - Key settings/locations
   - Estimated number of scenes
   - Visual style approach
3. Write the plan to ${project.plan.planFile}
4. Present the plan to the user for approval
`;
        }
        break;

      case PlannerStage.VERIFY:
        instruction += `
The master plan is ready for verification. Present it to the user for approval.
1. Read the plan from ${project.plan.planFile}
2. Use ask_user to present a summary and ask for approval
3. If approved, call update_project with action "update_plan_stage" and stage "complete"
4. If feedback is given, call update_project with action "update_plan_stage" and stage "refining"
`;
        break;

      case PlannerStage.REFINING:
        instruction += `
Refine the master plan based on user feedback.
1. Read the current plan from ${project.plan.planFile}
2. Apply user feedback
3. Update the plan in ${project.plan.planFile}
4. Call update_project with action "update_plan_stage" and stage "verify"
`;
        break;
    }

    return instruction.trim();
  }

  // Proceed with phase execution for legacy workflow
  instruction += `
✅ **Master plan approved** - Executing phase: ${phaseConfig.displayName}

`;

  // For phases requiring per-item approval, provide specific instructions
  if (phaseConfig.requiresPerItemApproval) {
    instruction += getPerItemPhaseInstructions(project, phaseConfig, basePath);
  } else {
    // Standard single-item phase flow (plot, story, video_combine)
    const phaseStatus = phaseInfo?.status ?? 'pending';

    if (phaseStatus === 'completed') {
      instruction += `
The ${phaseConfig.displayName} phase is complete.
1. Use transition_phase to move to the next phase: ${phaseConfig.nextPhase && PHASE_CONFIGS[phaseConfig.nextPhase] ? PHASE_CONFIGS[phaseConfig.nextPhase].displayName : 'DONE'}
`;
    } else {
      // Check if content exists for content phases
      if (phaseConfig.agentType === 'content' && phaseConfig.contentType) {
        const contentFile = CONTENT_TYPE_OUTPUT_FILES[phaseConfig.contentType];
        if (contentFile) {
          const contentFilePath = join(basePath, '.kshana', 'agent', contentFile);
          const contentExists = existsSync(contentFilePath) && readFileSync(contentFilePath, 'utf-8').trim().length > 0;

          if (contentExists) {
            instruction += `
The ${phaseConfig.contentType} content already exists. Mark phase as complete and transition.
1. Call update_project with action "update_phase" to mark "${currentPhase}" as "completed"
2. Call update_project with action "transition_phase" to move to the next phase
`;
          } else {
            instruction += `
Generate the ${phaseConfig.contentType} content for this phase.
1. Use generate_content(content_type: "${phaseConfig.contentType}") to create the content
2. The tool will handle user approval automatically
3. After content is approved, mark phase as complete and transition to next phase
`;
          }
        }
      } else {
        instruction += `
Execute the ${phaseConfig.displayName} phase.
1. Follow the phase-specific instructions from the master plan
2. When complete, call update_project with action "update_phase" to mark "${currentPhase}" as "completed"
3. Then transition to the next phase
`;
      }
    }
  }

  return instruction.trim();
}

/**
 * Get per-item phase instructions for phases that require individual item approval.
 */
function getPerItemPhaseInstructions(
  project: ProjectFile,
  phaseConfig: PhaseConfig,
  _basePath: string
): string {
  const nextItem = getNextUnapprovedItem(project, phaseConfig.phase);
  const { approved: approvedCount, total: totalItems } = countApprovedItems(project, phaseConfig.phase);

  // Get full item list for TODO reconstruction
  const allItems = getPhaseItems(project, phaseConfig.phase);

  let instruction = `
**IMPORTANT: This phase requires PER-ITEM approval.**

## Progress
- Total items: ${totalItems}
- Approved: ${approvedCount}
- Remaining: ${totalItems - approvedCount}
`;

  // Add item list with statuses so orchestrator can recreate TODO list
  if (totalItems > 0) {
    instruction += `
## Current Item Statuses
`;
    for (const item of allItems) {
      const statusIcon = item.status === 'approved' ? '✓' : item.status === 'pending' ? '○' : '●';
      instruction += `${statusIcon} ${item.name}: ${item.status}\n`;
    }
    instruction += '\n';
  }

  // Add instructions for resuming mid-phase
  if (approvedCount > 0 && approvedCount < totalItems) {
    instruction += `
## ⚠️ RESUMING MID-PHASE: Recreate Todo List

You are resuming this phase with ${approvedCount} of ${totalItems} items already approved.

**Create the todo list to match the current state:**
\`\`\`
TodoWrite(merge: false, todos: [
${allItems
        .map((item, idx) => {
          const status = item.status === 'approved' ? 'completed' : idx === allItems.findIndex(i => i.status !== 'approved') ? 'in_progress' : 'pending';
          return `  { id: "${item.id}", content: "Process ${item.name}", activeForm: "Processing ${item.name}", status: "${status}" },`;
        })
        .join('\n')}
])
\`\`\`

Then continue with the next item: **${nextItem?.name}**
`;
  }

  // Add fresh todo creation instructions at phase start
  if (approvedCount === 0 && totalItems > 0) {
    instruction += `
## ⚠️ PHASE START: Create Fresh Todo List

**FIRST THING when entering this phase**: Create a NEW todo list with \`merge: false\` to replace old todos from the previous phase.

\`\`\`
TodoWrite(merge: false, todos: [
  { id: "item-1", content: "Process first item", activeForm: "Processing first item", status: "in_progress" },
  { id: "item-2", content: "Process second item", activeForm: "Processing second item", status: "pending" },
  ...
])
\`\`\`

**CRITICAL**: Use \`merge: false\` to REPLACE the old todos. This clears the todo list from the previous phase.
`;
  }

  if (totalItems === 0) {
    instruction += `
## No Items Registered Yet

`;
    switch (phaseConfig.phase) {
      case WorkflowPhase.CHARACTERS_SETTINGS:
        instruction += `**CRITICAL: Use $story context directly - DO NOT create tasks to read the story!**

1. Use fetch_context(context_ref: "$story") to get the story content
2. Identify all characters and settings mentioned in the story
3. Check read_project() to see which characters/settings already exist
4. Register each NEW character/setting before creating their profiles

**DO NOT create story_content.md or any temporary story files. Use $story context directly.**
`;
        break;
      case WorkflowPhase.CHARACTER_SETTING_IMAGES:
        instruction += `No characters or settings are registered yet. Read the story, identify all characters and settings, and register each one with their descriptions before generating reference images.
`;
        break;
      case WorkflowPhase.SCENES:
        instruction += `Read the story and break it into individual scenes. Register each scene before creating detailed scene descriptions.
`;
        break;
      case WorkflowPhase.SCENE_IMAGES:
        instruction += `No scenes are registered yet. Read the scene breakdown and register each scene before generating images.
`;
        break;
      default:
        instruction += `Identify the items to process for this phase and register them before proceeding.
`;
    }
  } else if (nextItem) {
    instruction += `
## Next Item to Process
- **Type**: ${nextItem.type}
- **Name**: ${nextItem.name}
- **Status**: ${nextItem.status}

## What to Do

`;
    // Add phase-specific instructions (task-focused, no tool names)
    switch (phaseConfig.phase) {
      case WorkflowPhase.SCENE_IMAGES:
        instruction += `Generate the scene image for **Scene ${nextItem.name}**.

The scene description already exists from the SCENES phase. Use reference images from characters and settings that appear in this scene to maintain visual consistency.

After generating, get user approval before moving to the next scene.

**CRITICAL - After User Approval:**
1. Update scene with update_project(action: 'update_scene_approval', ...)
2. **MUST** call TodoWrite(merge: true, todos: [...]) to mark the current scene as 'completed' and the next as 'in_progress'
3. Then generate the next scene image

**DO NOT skip the TodoWrite call!**
`;
        break;

      case WorkflowPhase.CHARACTER_SETTING_IMAGES:
        instruction += `Generate a reference image for **${nextItem.name}** (${nextItem.type}).

Read the ${nextItem.type} description to understand the visual requirements, then generate an appropriate reference image.

After generating, get user approval before moving to the next item.

**CRITICAL - After User Approval:**
1. Update with update_project(action: 'update_${nextItem.type}_approval', ...)
2. **MUST** call TodoWrite(merge: true, todos: [...]) to mark the current item as 'completed' and the next as 'in_progress'
3. Then generate the next reference image

**DO NOT skip the TodoWrite call!**
`;
        break;

      case WorkflowPhase.VIDEO:
        instruction += `Generate video for **Scene ${nextItem.name}**.

Use the scene's image artifact to create an animated video clip with appropriate motion.

After generating, get user approval before moving to the next scene.

**CRITICAL - After User Approval:**
1. Update scene with update_project(action: 'update_scene_approval', ...)
2. **MUST** call TodoWrite(merge: true, todos: [...]) to mark the current scene as 'completed' and the next as 'in_progress'
3. Then generate the next video

**DO NOT skip the TodoWrite call!**
`;
        break;

      case WorkflowPhase.SCENES:
        instruction += `Create **Scene ${nextItem.name}**.

Generate a detailed scene description including characters, setting, action, emotional tone, camera angles, and motion.

After creating, get user approval before moving to the next scene.

**CRITICAL - After User Approval:**
1. Register the scene with update_project(action: 'add_scene', data: { scene_number: ${nextItem.name}, title: '...' })
2. **MUST** call TodoWrite(merge: true, todos: [{ id: 'scene-${nextItem.name}', status: 'completed' }, { id: 'scene-NEXT', status: 'in_progress' }])
3. Then create the next scene

**DO NOT skip the TodoWrite call! The todo list MUST be updated after each scene approval.**
`;
        break;

      default:
        // Default for content creation phases (CHARACTERS_SETTINGS, SCENES)
        instruction += `Create the ${nextItem.type} profile for **${nextItem.name}**.

**BEFORE creating, check if this ${nextItem.type} already exists:**
- Call read_project() and check if "${nextItem.name}" is already in project.${nextItem.type === 'character' ? 'characters' : 'settings'}
- If it already exists, skip it and move to the next item

Generate detailed content including description and visual characteristics suitable for image generation.

**Use $story context directly - DO NOT create tasks to read story files!**

After creating, get user approval before moving to the next item.

**CRITICAL - After User Approval:**
1. Register the item with update_project(action: 'add_${nextItem.type}', ...)
2. **MUST** call TodoWrite(merge: true, todos: [...]) to mark the current item as 'completed' and the next as 'in_progress'
3. Then create the next item

**DO NOT skip the TodoWrite call! DO NOT create duplicates!**
`;
        break;
    }
  } else if (areAllItemsApproved(project, phaseConfig.phase)) {
    instruction += `
## All Items Approved!

All ${totalItems} items have been approved.

**CRITICAL: Mark all items as COMPLETED in your todo list before transitioning.**

\`\`\`
TodoWrite(merge: false, todos: [
${allItems
        .map((item) => {
          // Generate IDs consistent with how they are created in the loop
          // For scenes, IDs are typically 'scene-N'. For others, it's 'item-ID' or just ID if used directly.
          return `  { id: "${item.id}", content: "Process ${item.name}", status: "completed" },`;
        })
        .join('\n')}
])
\`\`\`

Then mark this phase as complete and move to the next phase: **${phaseConfig.nextPhase && PHASE_CONFIGS[phaseConfig.nextPhase] ? PHASE_CONFIGS[phaseConfig.nextPhase].displayName : 'DONE'}**
`;
  }

  return instruction;
}

// ============================================================================
// Content Registry Functions
// ============================================================================

/**
 * Update the status of a content type in the registry.
 */
export function updateContentStatus(
  project: ProjectFile,
  contentType: ContentTypeName,
  status: ContentStatus,
  basePath: string = process.cwd()
): ProjectFile {
  // Ensure content registry exists (for backwards compatibility)
  if (!project.content) {
    project.content = createDefaultContentRegistry();
  }

  project.content[contentType].status = status;
  saveProject(project, basePath);
  return project;
}

/**
 * Add an item to an itemized content type (characters, settings, scenes, images, videos).
 */
export function addContentItem(
  project: ProjectFile,
  contentType: ContentTypeName,
  itemName: string,
  itemFile?: string,
  basePath: string = process.cwd()
): ProjectFile {
  // Ensure content registry exists
  if (!project.content) {
    project.content = createDefaultContentRegistry();
  }

  const entry = project.content[contentType];

  // Initialize items array if needed
  if (!entry.items) {
    entry.items = [];
  }

  // Add item if not already present
  if (!entry.items.includes(itemName)) {
    entry.items.push(itemName);
  }

  // Add item file path if provided
  if (itemFile) {
    if (!entry.itemFiles) {
      entry.itemFiles = {};
    }
    entry.itemFiles[itemName] = itemFile;
  }

  // Update status: at least partial if we have items
  if (entry.status === 'missing' && entry.items.length > 0) {
    entry.status = 'partial';
  }

  saveProject(project, basePath);
  return project;
}

/**
 * Get the content context string for use in prompts.
 * This generates a summary of what content is available/missing.
 */
export function getContentContext(project: ProjectFile): string {
  // Ensure content registry exists
  if (!project.content) {
    return `
Content Status:
- All content types are missing (no content registry initialized)

You should start from the beginning and create all content.
`.trim();
  }

  const available: string[] = [];
  const partial: string[] = [];
  const missing: string[] = [];

  for (const [type, entry] of Object.entries(project.content)) {
    const info = entry as ContentEntry;
    if (info.status === 'available') {
      available.push(type);
    } else if (info.status === 'partial') {
      const itemCount = info.items?.length ?? 0;
      partial.push(`${type} (${itemCount} items)`);
    } else {
      missing.push(type);
    }
  }

  let context = `
## Content Registry Status

**Available**: ${available.length > 0 ? available.join(', ') : 'none'}
**Partial**: ${partial.length > 0 ? partial.join(', ') : 'none'}
**Missing**: ${missing.length > 0 ? missing.join(', ') : 'none'}

## Content Files

`;

  // Add file paths for available/partial content
  for (const [type, entry] of Object.entries(project.content)) {
    const info = entry as ContentEntry;
    if (info.status !== 'missing') {
      context += `- **${type}**: \`${info.file}\`\n`;
      if (info.items && info.items.length > 0) {
        context += `  - Items: ${info.items.join(', ')}\n`;
      }
    }
  }

  context += `
## Reading Content

You can read available content using read_file with the paths listed above.
All paths are relative to the .kshana/ directory.
`;

  return context.trim();
}

/**
 * Get the content registry JSON for embedding in prompts.
 */
export function getContentRegistryJson(project: ProjectFile): string {
  if (!project.content) {
    return JSON.stringify(createDefaultContentRegistry(), null, 2);
  }
  return JSON.stringify(project.content, null, 2);
}

/**
 * Check if all required content for a phase is available.
 */
export function hasRequiredContent(
  project: ProjectFile,
  requiredTypes: ContentTypeName[]
): { complete: boolean; missing: ContentTypeName[] } {
  const missing: ContentTypeName[] = [];

  for (const type of requiredTypes) {
    const entry = project.content?.[type];
    if (!entry || entry.status === 'missing') {
      missing.push(type);
    }
  }

  return {
    complete: missing.length === 0,
    missing,
  };
}

/**
 * Mark content as available after successful creation.
 * This also syncs item lists for itemized content types.
 */
export function markContentAvailable(
  project: ProjectFile,
  contentType: ContentTypeName,
  basePath: string = process.cwd()
): ProjectFile {
  // Ensure content registry exists
  if (!project.content) {
    project.content = createDefaultContentRegistry();
  }

  const entry = project.content[contentType];

  // For itemized content, check if we have items
  if (['characters', 'settings', 'scenes', 'images', 'videos'].includes(contentType)) {
    // Sync with project arrays
    if (contentType === 'characters' && project.characters.length > 0) {
      entry.items = project.characters.map(c => c.name);
      entry.status = 'available';
    } else if (contentType === 'settings' && project.settings.length > 0) {
      entry.items = project.settings.map(s => s.name);
      entry.status = 'available';
    } else if (contentType === 'scenes' && project.scenes.length > 0) {
      entry.items = project.scenes.map(s => `Scene ${s.sceneNumber}`);
      entry.status = 'available';
    } else if (entry.items && entry.items.length > 0) {
      entry.status = 'available';
    } else {
      // No items yet, mark as partial
      entry.status = 'partial';
    }
  } else {
    // Non-itemized content (plot, story)
    entry.status = 'available';
  }

  saveProject(project, basePath);
  return project;
}
