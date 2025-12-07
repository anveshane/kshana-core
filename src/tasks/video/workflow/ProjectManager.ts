/**
 * ProjectManager - Handles project file creation, reading, and updating.
 * Manages the .kshana directory structure and project.json index file.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  type ProjectFile,
  type PhaseInfo,
  type ThreeActsPhaseInfo,
  type PhaseStatus,
  type CharacterData,
  type SettingData,
  type AssetInfo,
  WorkflowPhase,
  PHASE_ORDER,
  PROJECT_DIR,
  PROJECT_FILE,
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

  // Create empty plan files
  const planFiles = [
    'plans/story-discovery.md',
    'plans/characters.md',
    'plans/three-acts.md',
    'plans/act-1-scenes.md',
    'plans/act-2-scenes.md',
    'plans/act-3-scenes.md',
    'plans/storyboard.md',
    'plans/video-generation.md',
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
    phases: {
      story_discovery: {
        status: 'pending',
        planFile: 'plans/story-discovery.md',
        completedAt: null,
      },
      character_descriptions: {
        status: 'pending',
        planFile: 'plans/characters.md',
        completedAt: null,
      },
      three_acts: {
        status: 'pending',
        planFile: 'plans/three-acts.md',
        actPlanFiles: {
          intro: 'plans/act-1-scenes.md',
          middle: 'plans/act-2-scenes.md',
          climax: 'plans/act-3-scenes.md',
        },
        completedAt: null,
      },
      storyboard_images: {
        status: 'pending',
        planFile: 'plans/storyboard.md',
        completedAt: null,
      },
      video_generation: {
        status: 'pending',
        planFile: 'plans/video-generation.md',
        completedAt: null,
      },
      video_stitching: {
        status: 'pending',
        completedAt: null,
      },
      final_signoff: {
        status: 'pending',
        completedAt: null,
      },
    },
    characters: [],
    settings: [],
    storyboard: [],
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
  }

  saveProject(project, basePath);
  return project;
}

/**
 * Get the current workflow phase based on project state.
 */
export function getCurrentPhase(project: ProjectFile): WorkflowPhase {
  // Map phase keys to WorkflowPhase enum
  const phaseKeyToEnum: Record<keyof ProjectFile['phases'], WorkflowPhase> = {
    story_discovery: WorkflowPhase.STORY_DISCOVERY,
    character_descriptions: WorkflowPhase.CHARACTER_DESCRIPTIONS,
    three_acts: WorkflowPhase.THREE_ACTS,
    storyboard_images: WorkflowPhase.STORYBOARD_IMAGES,
    video_generation: WorkflowPhase.VIDEO_GENERATION,
    video_stitching: WorkflowPhase.VIDEO_STITCHING,
    final_signoff: WorkflowPhase.FINAL_SIGNOFF,
  };

  // Check for in_progress phases first
  for (const [key, phase] of Object.entries(project.phases)) {
    if (phase.status === 'in_progress') {
      return phaseKeyToEnum[key as keyof ProjectFile['phases']];
    }
  }

  // Find first pending phase
  const phaseOrder: (keyof ProjectFile['phases'])[] = [
    'story_discovery',
    'character_descriptions',
    'three_acts',
    'storyboard_images',
    'video_generation',
    'video_stitching',
    'final_signoff',
  ];

  for (const key of phaseOrder) {
    if (project.phases[key].status === 'pending') {
      return phaseKeyToEnum[key];
    }
  }

  // All phases complete
  return WorkflowPhase.COMPLETED;
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

  const currentPhase = getCurrentPhase(project);
  const completedPhases = Object.entries(project.phases)
    .filter(([, info]) => info.status === 'completed')
    .map(([key]) => key);

  return `
Project: ${project.title || '(untitled)'}
ID: ${project.id}
Current Phase: ${currentPhase}
Completed Phases: ${completedPhases.length > 0 ? completedPhases.join(', ') : 'none'}
Characters: ${project.characters.length > 0 ? project.characters.join(', ') : 'none defined'}
Settings: ${project.settings.length > 0 ? project.settings.join(', ') : 'none defined'}
Scenes: ${project.storyboard.length}
Assets: ${project.assets.length}
`.trim();
}
