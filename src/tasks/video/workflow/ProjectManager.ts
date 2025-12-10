/**
 * ProjectManager - Handles project file creation, reading, and updating.
 * Manages the .kshana directory structure and project.json index file.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
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
  WorkflowPhase,
  PlannerStage,
  PHASE_CONFIGS,
  PROJECT_DIR,
  PROJECT_FILE,
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
import { generateProjectTitle } from '../../../core/context/index.js';

/**
 * Get the project directory path for the current working directory.
 */
export function getProjectDir(basePath: string = process.cwd()): string {
  return join(basePath, PROJECT_DIR);
}

/**
 * Get the project file path.
 */
export function getProjectFilePath(basePath: string = process.cwd()): string {
  return join(getProjectDir(basePath), PROJECT_FILE);
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

  // Create main directories only - no empty files
  const dirs = [
    projectDir,
    join(projectDir, 'plans'),
    join(projectDir, 'characters'),
    join(projectDir, 'settings'),
    join(projectDir, 'assets'),
  ];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  // Create empty assets manifest (needed for asset tracking)
  const manifestPath = join(projectDir, 'assets', 'manifest.json');
  if (!existsSync(manifestPath)) {
    writeFileSync(manifestPath, JSON.stringify({ assets: [] }, null, 2), 'utf-8');
  }

  // NOTE: Plan files (plot.md, story.md, etc.) are created on first write
  // via writeProjectFile(), not here. This avoids empty files cluttering the project.
}

/**
 * Create the default content registry with all content marked as missing.
 */
export function createDefaultContentRegistry(): ContentRegistry {
  return {
    plot: { status: 'missing', file: 'plans/plot.md' },
    story: { status: 'missing', file: 'plans/story.md' },
    characters: { status: 'missing', file: 'plans/characters.md', items: [], itemFiles: {} },
    settings: { status: 'missing', file: 'plans/settings.md', items: [], itemFiles: {} },
    scenes: { status: 'missing', file: 'plans/scenes.md', items: [] },
    images: { status: 'missing', file: 'plans/images.md', items: [] },
    videos: { status: 'missing', file: 'plans/video.md', items: [] },
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

/**
 * Create a new project file with the given input.
 * Stores originalInput in a separate file, only reference in project.json.
 */
export function createProject(originalInput: string, basePath: string = process.cwd()): ProjectFile {
  // Ensure directory structure exists
  createProjectStructure(basePath);

  // Clean the input - remove any XML tags or wrapper formats
  const cleanInput = stripWrapperTags(originalInput);

  const now = Date.now();
  const projectId = `proj-${now}-${Math.random().toString(36).slice(2, 8)}`;

  // Save original input to a separate file
  const inputFilePath = 'original_input.md';
  const fullInputPath = join(getProjectDir(basePath), inputFilePath);
  writeFileSync(fullInputPath, cleanInput, 'utf-8');

  const project: ProjectFile = {
    version: '2.0',
    id: projectId,
    title: generateProjectTitle(cleanInput),
    originalInputFile: inputFilePath,
    createdAt: now,
    updatedAt: now,
    currentPhase: WorkflowPhase.PLOT,
    phases: {
      plot: {
        status: 'pending',
        planFile: 'plans/plot.md',
        completedAt: null,
      },
      story: {
        status: 'pending',
        planFile: 'plans/story.md',
        completedAt: null,
      },
      characters_settings: {
        status: 'pending',
        planFile: 'plans/characters-settings.md',
        completedAt: null,
      },
      scenes: {
        status: 'pending',
        planFile: 'plans/scenes.md',
        completedAt: null,
      },
      character_setting_images: {
        status: 'pending',
        planFile: 'plans/ref-images.md',
        completedAt: null,
      },
      scene_images: {
        status: 'pending',
        planFile: 'plans/scene-images.md',
        completedAt: null,
      },
      video: {
        status: 'pending',
        planFile: 'plans/video.md',
        completedAt: null,
      },
      video_combine: {
        status: 'pending',
        planFile: 'plans/final-video.md',
        completedAt: null,
      },
    },
    content: createDefaultContentRegistry(),
    characters: [],
    settings: [],
    scenes: [],
    assets: [],
  };

  // Save project file
  saveProject(project, basePath);

  return project;
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
 * Save the project file.
 */
export function saveProject(project: ProjectFile, basePath: string = process.cwd()): void {
  const filePath = getProjectFilePath(basePath);
  project.updatedAt = Date.now();
  writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf-8');
}

/**
 * Read the original user input from its file.
 */
export function getOriginalInput(project: ProjectFile, basePath: string = process.cwd()): string {
  const inputPath = join(getProjectDir(basePath), project.originalInputFile);
  if (existsSync(inputPath)) {
    return readFileSync(inputPath, 'utf-8');
  }
  return '';
}

/**
 * Get or create a project.
 */
export function getOrCreateProject(originalInput: string, basePath: string = process.cwd()): ProjectFile {
  const existing = loadProject(basePath);
  if (existing) {
    return existing;
  }
  return createProject(originalInput, basePath);
}

/**
 * Get the current workflow phase from the project.
 */
export function getCurrentPhase(project: ProjectFile): WorkflowPhase {
  return project.currentPhase;
}

/**
 * Update a phase's status.
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
    phaseInfo.plannerStage = PlannerStage.COMPLETE;
  } else if (status === 'in_progress' && !phaseInfo.plannerStage) {
    phaseInfo.plannerStage = PlannerStage.PLANNING;
  }

  saveProject(project, basePath);
  return project;
}

/**
 * Update a phase's planner stage.
 */
export function updatePlannerStage(
  project: ProjectFile,
  phase: keyof ProjectFile['phases'],
  stage: PlannerStage,
  basePath: string = process.cwd()
): ProjectFile {
  const phaseInfo = project.phases[phase];
  phaseInfo.plannerStage = stage;

  if (stage === PlannerStage.REFINING) {
    phaseInfo.refinementCount = (phaseInfo.refinementCount ?? 0) + 1;
  }

  // When planner stage reaches COMPLETE, also mark the phase as completed
  if (stage === PlannerStage.COMPLETE) {
    phaseInfo.status = 'completed';
    phaseInfo.completedAt = Date.now();
  }

  saveProject(project, basePath);
  return project;
}

/**
 * Transition to the next phase based on current state.
 */
export function transitionToNextPhase(
  project: ProjectFile,
  basePath: string = process.cwd()
): { project: ProjectFile; transitioned: boolean; reason: string } {
  const result = determineNextPhase(project);

  if (result.nextPhase !== project.currentPhase) {
    project.currentPhase = result.nextPhase;

    // Mark new phase as in_progress with planning stage
    const phaseKey = result.nextPhase as keyof typeof project.phases;
    if (project.phases[phaseKey]) {
      project.phases[phaseKey].status = 'in_progress';
      project.phases[phaseKey].plannerStage = PlannerStage.PLANNING;
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
  const filePath = join(getProjectDir(basePath), planFile);

  if (!existsSync(filePath)) {
    return false;
  }

  const content = readFileSync(filePath, 'utf-8').trim();
  return content.length > 0;
}

/**
 * Read a file from the project directory.
 */
export function readProjectFile(relativePath: string, basePath: string = process.cwd()): string | null {
  const filePath = join(getProjectDir(basePath), relativePath);

  if (!existsSync(filePath)) {
    return null;
  }

  return readFileSync(filePath, 'utf-8');
}

/**
 * Write a file to the project directory.
 */
export function writeProjectFile(
  relativePath: string,
  content: string,
  basePath: string = process.cwd()
): void {
  const projectDir = getProjectDir(basePath);
  const filePath = join(projectDir, relativePath);

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
  const filePath = `characters/${safeName}.md`;
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
    saveProject(project, basePath);
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
  const existing = project.characters.find(c => c.name === name);
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

  const index = project.characters.findIndex(c => c.name === name);
  if (index < 0) return null;

  project.characters[index] = { ...project.characters[index], ...updates };
  saveProject(project, basePath);

  // Also save to markdown file if description changed
  if (updates.description || updates.visualDescription) {
    saveCharacter(project.characters[index], basePath);
  }

  return project.characters[index];
}

/**
 * Update a character's approval status.
 */
export function updateCharacterApproval(
  name: string,
  status: ItemApprovalStatus,
  feedback?: string,
  basePath: string = process.cwd()
): CharacterData | null {
  const project = loadProject(basePath);
  if (!project) return null;

  const index = project.characters.findIndex(c => c.name === name);
  if (index < 0) return null;

  project.characters[index].approvalStatus = status;
  if (status === 'approved') {
    project.characters[index].approvedAt = Date.now();
  } else if (status === 'regenerating') {
    project.characters[index].regenerationCount++;
  }

  saveProject(project, basePath);
  return project.characters[index];
}

/**
 * Load character markdown from characters/[name].md.
 * Returns the raw markdown content (parsing not needed for index-only approach).
 */
export function loadCharacterMarkdown(name: string, basePath: string = process.cwd()): string | null {
  const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return readProjectFile(`characters/${safeName}.md`, basePath);
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
  const filePath = `settings/${safeName}.md`;
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
    saveProject(project, basePath);
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
  const existing = project.settings.find(s => s.name === name);
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

  const index = project.settings.findIndex(s => s.name === name);
  if (index < 0) return null;

  project.settings[index] = { ...project.settings[index], ...updates };
  saveProject(project, basePath);

  // Also save to markdown file if description changed
  if (updates.description || updates.visualDescription) {
    saveSetting(project.settings[index], basePath);
  }

  return project.settings[index];
}

/**
 * Update a setting's approval status.
 */
export function updateSettingApproval(
  name: string,
  status: ItemApprovalStatus,
  feedback?: string,
  basePath: string = process.cwd()
): SettingData | null {
  const project = loadProject(basePath);
  if (!project) return null;

  const index = project.settings.findIndex(s => s.name === name);
  if (index < 0) return null;

  project.settings[index].approvalStatus = status;
  if (status === 'approved') {
    project.settings[index].approvedAt = Date.now();
  } else if (status === 'regenerating') {
    project.settings[index].regenerationCount++;
  }

  saveProject(project, basePath);
  return project.settings[index];
}

/**
 * Load setting markdown from settings/[name].md.
 * Returns the raw markdown content.
 */
export function loadSettingMarkdown(name: string, basePath: string = process.cwd()): string | null {
  const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return readProjectFile(`settings/${safeName}.md`, basePath);
}

/**
 * Add a scene reference to the project.
 * Scene content is stored in plans/scenes.md or individual scene files.
 */
export function addScene(sceneRef: SceneRef, basePath: string = process.cwd()): void {
  const project = loadProject(basePath);
  if (!project) return;

  // Check if scene already exists
  const existingIndex = project.scenes.findIndex((s) => s.sceneNumber === sceneRef.sceneNumber);
  if (existingIndex >= 0) {
    project.scenes[existingIndex] = sceneRef;
  } else {
    project.scenes.push(sceneRef);
    project.scenes.sort((a, b) => a.sceneNumber - b.sceneNumber);
  }

  saveProject(project, basePath);
}

/**
 * Add a new scene to the project (creates default entry).
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

  // Check if scene already exists
  const existing = project.scenes.find(s => s.sceneNumber === sceneNumber);
  if (existing) {
    return existing;
  }

  // Create new scene with default values
  const scene = createDefaultSceneRef(sceneNumber, title);
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

  project.scenes[index] = { ...project.scenes[index], ...updates };
  saveProject(project, basePath);

  return project.scenes[index];
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
  const manifestPath = join(getProjectDir(basePath), 'assets', 'manifest.json');

  let manifest: { assets: AssetInfo[] } = { assets: [] };
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    } catch {
      // Use empty manifest on parse error
    }
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
    saveProject(project, basePath);
  }
}

/**
 * Get all assets from the manifest.
 */
export function getAssets(basePath: string = process.cwd()): AssetInfo[] {
  const manifestPath = join(getProjectDir(basePath), 'assets', 'manifest.json');

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

  return `
Project: ${project.title || '(untitled)'}
ID: ${project.id}
Version: ${project.version}
Current Phase: ${phaseConfig.displayName} (${currentPhase})
Planner Stage: ${phaseInfo?.plannerStage ?? 'not started'}
Completed Phases: ${completedPhases.length > 0 ? completedPhases.join(', ') : 'none'}
Characters: ${characterNames.length > 0 ? characterNames.join(', ') : 'none defined'}
Settings: ${settingNames.length > 0 ? settingNames.join(', ') : 'none defined'}
Scenes: ${project.scenes.length}
Assets: ${project.assets.length}${itemProgress}
`.trim();
}

/**
 * Get the state transition prompt for the main agent.
 * This tells the agent what phase it's in and what to do next.
 */
export function getStateTransitionPrompt(basePath: string = process.cwd()): string {
  const project = loadProject(basePath);

  if (!project) {
    return 'No project exists. Create a new project first.';
  }

  const currentPhase = project.currentPhase;
  const phaseConfig = PHASE_CONFIGS[currentPhase];
  const phaseInfo = project.phases[currentPhase as keyof typeof project.phases];
  const plannerStage = phaseInfo?.plannerStage ?? PlannerStage.PLANNING;

  // Check if plan file already has content
  const planFileExists = phaseConfig.planOutputFile
    ? planFileHasContent(phaseConfig.planOutputFile, basePath)
    : false;

  let instruction = `
## Current State
- **Phase**: ${phaseConfig.displayName}
- **Stage**: ${plannerStage}
- **Plan File**: ${phaseConfig.planOutputFile ?? 'N/A'}
- **Plan File Has Content**: ${planFileExists ? 'YES' : 'NO'}
- **Per-Item Approval Required**: ${phaseConfig.requiresPerItemApproval ? 'YES' : 'NO'}

## What to Do Next
`;

  // For phases requiring per-item approval, provide specific instructions
  if (phaseConfig.requiresPerItemApproval) {
    instruction += getPerItemPhaseInstructions(project, phaseConfig, basePath);
  } else {
    // Standard single-approval phase flow
    switch (plannerStage) {
      case PlannerStage.PLANNING:
        if (planFileExists) {
          instruction += `
You are in the PLANNING stage BUT a plan already exists at ${phaseConfig.planOutputFile}.

**IMPORTANT**: An existing plan means it was ALREADY APPROVED previously. Do NOT ask for approval again.

1. Mark this phase as COMPLETE immediately (update_project with action "update_planner_stage", stage "complete")
2. Then transition to the next phase using transition_phase

DO NOT create a new plan. DO NOT ask for approval - it's already approved.
`;
        } else {
          instruction += `
You are in the PLANNING stage. Create a plan for ${phaseConfig.displayName}.
1. Analyze the project context
2. Create a detailed plan
3. Write the plan to ${phaseConfig.planOutputFile}
4. Move to VERIFY stage by updating the planner stage
`;
        }
        break;

      case PlannerStage.VERIFY:
        if (planFileExists) {
          instruction += `
You are in the VERIFY stage and a plan already exists at ${phaseConfig.planOutputFile}.

**IMPORTANT**: An existing plan means it was ALREADY APPROVED previously. Do NOT ask for approval again.

1. Mark this phase as COMPLETE immediately (update_project with action "update_planner_stage", stage "complete")
2. Then transition to the next phase using transition_phase
`;
        } else {
          instruction += `
You are in the VERIFY stage. Present the plan to the user for approval.
1. Read the plan from ${phaseConfig.planOutputFile}
2. Present a summary to the user using ask_user
3. If user approves (or 15 seconds pass with no response), move to COMPLETE
4. If user provides feedback, move to REFINING stage
`;
        }
        break;

      case PlannerStage.REFINING:
        instruction += `
You are in the REFINING stage. Update the plan based on user feedback.
1. Read the current plan
2. Apply user feedback
3. Update the plan in ${phaseConfig.planOutputFile}
4. Move back to VERIFY stage
`;
        break;

      case PlannerStage.COMPLETE:
        instruction += `
The ${phaseConfig.displayName} phase is complete.
1. Use transition_phase to move to the next phase: ${phaseConfig.nextPhase ? PHASE_CONFIGS[phaseConfig.nextPhase].displayName : 'DONE'}
`;
        break;
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
  const items = getPhaseItems(project, phaseConfig.phase);
  const nextItem = getNextUnapprovedItem(project, phaseConfig.phase);
  const approvedCount = countApprovedItems(project, phaseConfig.phase);
  const totalItems = items.length;

  let instruction = `
**IMPORTANT: This phase requires PER-ITEM approval.**

## Progress
- Total items: ${totalItems}
- Approved: ${approvedCount}
- Remaining: ${totalItems - approvedCount}
`;

  if (totalItems === 0) {
    instruction += `
## No Items Found
No items to process yet. You need to identify the items first:
`;
    switch (phaseConfig.phase) {
      case WorkflowPhase.CHARACTERS_SETTINGS:
        instruction += `
1. Read the story from plans/story.md
2. Identify all characters and settings mentioned
3. Add each character using update_project(action: "add_character", data: {name: "..."})
4. Add each setting using update_project(action: "add_setting", data: {name: "..."})
5. Then start processing each item one by one
`;
        break;
      case WorkflowPhase.SCENES:
        instruction += `
1. Read the story and character/setting profiles
2. Break the story into individual scenes
3. Add each scene using update_project(action: "add_scene", data: {scene_number: N, title: "..."})
4. Then start processing each scene one by one
`;
        break;
      default:
        instruction += `
Identify the items to process for this phase, register them in the project, then process each one.
`;
    }
  } else if (nextItem) {
    instruction += `
## Next Item to Process
- **Type**: ${nextItem.type}
- **Name**: ${nextItem.name}
- **Status**: ${nextItem.status}

## Per-Item Workflow

**CRITICAL: Create a todo for THIS SPECIFIC ITEM before processing it!**

1. Use todo_write to create a todo: "Create ${nextItem.type} profile: ${nextItem.name}"
2. Mark the todo as in_progress
3. Use dispatch_content_agent to generate content for "${nextItem.name}"
4. Present the result to user for approval
5. If approved:
   - Use update_project to update the item's approval status
   - Mark the todo as completed
   - Move to the next item
6. If rejected, regenerate with feedback

**DO NOT** create a single todo for "all characters" or "all settings".
**DO** create individual todos like "Create character profile: Alice", "Create setting profile: Forest".
`;
  } else if (areAllItemsApproved(project, phaseConfig.phase)) {
    instruction += `
## All Items Approved!

All ${totalItems} items have been approved.

1. Mark this phase as complete using update_planner_stage(phase: "${phaseConfig.phase}", stage: "complete")
2. Use transition_phase to move to the next phase: ${phaseConfig.nextPhase ? PHASE_CONFIGS[phaseConfig.nextPhase].displayName : 'DONE'}
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
      entry.items = [...project.characters];
      entry.status = 'available';
    } else if (contentType === 'settings' && project.settings.length > 0) {
      entry.items = [...project.settings];
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
