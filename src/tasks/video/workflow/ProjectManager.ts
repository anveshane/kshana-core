/**
 * ProjectManager - Handles project file creation, reading, and updating.
 * Manages the .kshana directory structure and project.json index file.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  type ProjectFile,
  type PhaseInfo,
  type PhaseStatus,
  type CharacterData,
  type SettingData,
  type SceneData,
  type AssetInfo,
  WorkflowPhase,
  PlannerStage,
  PHASE_CONFIGS,
  PROJECT_DIR,
  PROJECT_FILE,
  determineNextPhase,
} from './types.js';

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
 * Create the initial project directory structure.
 */
export function createProjectStructure(basePath: string = process.cwd()): void {
  const projectDir = getProjectDir(basePath);

  // Create main directories
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

  // Create empty plan files for each phase
  const planFiles = [
    'plans/plot.md',
    'plans/story.md',
    'plans/scenes.md',
    'plans/images.md',
    'plans/video.md',
  ];

  for (const file of planFiles) {
    const filePath = join(projectDir, file);
    if (!existsSync(filePath)) {
      writeFileSync(filePath, '', 'utf-8');
    }
  }

  // Create empty assets manifest
  const manifestPath = join(projectDir, 'assets', 'manifest.json');
  if (!existsSync(manifestPath)) {
    writeFileSync(manifestPath, JSON.stringify({ assets: [] }, null, 2), 'utf-8');
  }
}

/**
 * Create a new project file with the given input.
 */
export function createProject(originalInput: string, basePath: string = process.cwd()): ProjectFile {
  // Ensure directory structure exists
  createProjectStructure(basePath);

  const now = Date.now();
  const projectId = `proj-${now}-${Math.random().toString(36).slice(2, 8)}`;

  const project: ProjectFile = {
    id: projectId,
    title: '',
    originalInput,
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
      scenes: {
        status: 'pending',
        planFile: 'plans/scenes.md',
        completedAt: null,
      },
      images: {
        status: 'pending',
        planFile: 'plans/images.md',
        completedAt: null,
      },
      video: {
        status: 'pending',
        planFile: 'plans/video.md',
        completedAt: null,
      },
    },
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
 */
export function loadProject(basePath: string = process.cwd()): ProjectFile | null {
  const filePath = getProjectFilePath(basePath);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as ProjectFile;
  } catch {
    return null;
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
 * Save character data to characters/[name].json.
 */
export function saveCharacter(
  character: CharacterData,
  basePath: string = process.cwd()
): void {
  const safeName = character.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const filePath = `characters/${safeName}.json`;
  writeProjectFile(filePath, JSON.stringify(character, null, 2), basePath);

  // Update project file's character list
  const project = loadProject(basePath);
  if (project && !project.characters.includes(character.name)) {
    project.characters.push(character.name);
    saveProject(project, basePath);
  }
}

/**
 * Load character data from characters/[name].json.
 */
export function loadCharacter(name: string, basePath: string = process.cwd()): CharacterData | null {
  const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const content = readProjectFile(`characters/${safeName}.json`, basePath);

  if (!content) {
    return null;
  }

  try {
    return JSON.parse(content) as CharacterData;
  } catch {
    return null;
  }
}

/**
 * Save setting data to settings/[name].json.
 */
export function saveSetting(setting: SettingData, basePath: string = process.cwd()): void {
  const safeName = setting.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const filePath = `settings/${safeName}.json`;
  writeProjectFile(filePath, JSON.stringify(setting, null, 2), basePath);

  // Update project file's setting list
  const project = loadProject(basePath);
  if (project && !project.settings.includes(setting.name)) {
    project.settings.push(setting.name);
    saveProject(project, basePath);
  }
}

/**
 * Load setting data from settings/[name].json.
 */
export function loadSetting(name: string, basePath: string = process.cwd()): SettingData | null {
  const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const content = readProjectFile(`settings/${safeName}.json`, basePath);

  if (!content) {
    return null;
  }

  try {
    return JSON.parse(content) as SettingData;
  } catch {
    return null;
  }
}

/**
 * Add a scene to the project.
 */
export function addScene(scene: SceneData, basePath: string = process.cwd()): void {
  const project = loadProject(basePath);
  if (!project) return;

  // Check if scene already exists
  const existingIndex = project.scenes.findIndex((s) => s.sceneNumber === scene.sceneNumber);
  if (existingIndex >= 0) {
    project.scenes[existingIndex] = scene;
  } else {
    project.scenes.push(scene);
    project.scenes.sort((a, b) => a.sceneNumber - b.sceneNumber);
  }

  saveProject(project, basePath);
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

  return `
Project: ${project.title || '(untitled)'}
ID: ${project.id}
Current Phase: ${phaseConfig.displayName} (${currentPhase})
Planner Stage: ${phaseInfo?.plannerStage ?? 'not started'}
Completed Phases: ${completedPhases.length > 0 ? completedPhases.join(', ') : 'none'}
Characters: ${project.characters.length > 0 ? project.characters.join(', ') : 'none defined'}
Settings: ${project.settings.length > 0 ? project.settings.join(', ') : 'none defined'}
Scenes: ${project.scenes.length}
Assets: ${project.assets.length}
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

  let instruction = `
## Current State
- **Phase**: ${phaseConfig.displayName}
- **Stage**: ${plannerStage}
- **Plan File**: ${phaseConfig.planOutputFile ?? 'N/A'}

## What to Do Next
`;

  switch (plannerStage) {
    case PlannerStage.PLANNING:
      instruction += `
You are in the PLANNING stage. Create a plan for ${phaseConfig.displayName}.
1. Analyze the project context
2. Create a detailed plan
3. Write the plan to ${phaseConfig.planOutputFile}
4. Move to VERIFY stage by updating the planner stage
`;
      break;

    case PlannerStage.VERIFY:
      instruction += `
You are in the VERIFY stage. Present the plan to the user for approval.
1. Read the plan from ${phaseConfig.planOutputFile}
2. Present a summary to the user using ask_user
3. If user approves (or 15 seconds pass with no response), move to COMPLETE
4. If user provides feedback, move to REFINING stage
`;
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
1. Mark the phase as completed
2. Transition to the next phase: ${phaseConfig.nextPhase ? PHASE_CONFIGS[phaseConfig.nextPhase].displayName : 'DONE'}
`;
      break;
  }

  return instruction.trim();
}
