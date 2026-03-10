/**
 * ProjectManager - Handles project file creation, reading, and updating.
 * Manages the *.kshana directory structure and project.json index file.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'fs';
import { isAbsolute, join } from 'path';
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
  WorkflowPhase,
  PlannerStage,
  PHASE_CONFIGS,
  STYLE_CONFIGS,
  INPUT_TYPE_CONFIGS,
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
import { generateProjectTitle, contextStore } from '../../../core/context/index.js';
import { initializeArtifactsFromFiles, createArtifactFromFile } from './ArtifactManager.js';
import { TemplateRegistry } from '../../../core/templates/TemplateRegistry.js';
import type { PhaseDefinition } from '../../../core/templates/types.js';
import { getActiveProjectDir, setActiveProjectDir } from './activeProject.js';

/**
 * Get the project directory path for the current working directory.
 */
export function getProjectDir(basePath: string = process.cwd()): string {
  const activeProjectDir = getActiveProjectDir();
  if (isAbsolute(activeProjectDir)) {
    return activeProjectDir;
  }
  return join(basePath, activeProjectDir);
}

/**
 * Summary info returned by scanProjects().
 */
export interface ProjectInfo {
  /** Directory name (e.g., "story.kshana") */
  dirName: string;
  /** Project title from project.json */
  title: string;
  /** Template ID (e.g., "narrative", "documentary") */
  templateId: string;
  /** Current workflow phase */
  currentPhase: string;
  /** Last updated timestamp */
  updatedAt: number;
}

/**
 * Scan for all *.kshana project directories under basePath.
 * Returns an array of project summaries sorted by most recently updated.
 */
export function scanProjects(basePath: string = process.cwd()): ProjectInfo[] {
  if (!existsSync(basePath)) return [];

  const entries = readdirSync(basePath, { withFileTypes: true });
  const projects: ProjectInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith('.kshana')) continue;

    const projectJsonPath = join(basePath, entry.name, PROJECT_FILE);
    if (!existsSync(projectJsonPath)) continue;

    try {
      const raw = readFileSync(projectJsonPath, 'utf-8');
      const data = JSON.parse(raw);
      projects.push({
        dirName: entry.name,
        title: entry.name.replace(/\.kshana$/, ''),
        templateId: data.templateId ?? 'narrative',
        currentPhase: data.currentPhase ?? 'unknown',
        updatedAt: data.updatedAt ?? 0,
      });
    } catch {
      // Skip malformed project files
    }
  }

  // Sort by most recently updated first
  projects.sort((a, b) => b.updatedAt - a.updatedAt);
  return projects;
}

/**
 * Infer a project directory name from the user's input content.
 * Uses generateProjectTitle() to create a slug, appends ".kshana",
 * and handles collisions by appending a number suffix.
 */
export function inferProjectDirName(content: string, basePath: string = process.cwd()): string {
  const slug = generateProjectTitle(content);
  const base = `${slug}.kshana`;

  if (!existsSync(join(basePath, base))) {
    return base;
  }

  // Handle collision
  let counter = 2;
  while (existsSync(join(basePath, `${slug}-${counter}.kshana`))) {
    counter++;
  }
  return `${slug}-${counter}.kshana`;
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
 * Also clears the context store to ensure a clean slate.
 */
export function deleteProject(basePath: string = process.cwd()): boolean {
  const projectDir = getProjectDir(basePath);

  // Always clear the context store to remove old context variables
  contextStore.clear();

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
    join(projectDir, 'plans', 'chapters'), // For chapter-based story files
    join(projectDir, 'characters'),
    join(projectDir, 'settings'),
    join(projectDir, 'assets'),
    // Prompt directories for image/video prompt files
    join(projectDir, 'prompts'),
    join(projectDir, 'prompts', 'images'),
    join(projectDir, 'prompts', 'images', 'characters'),
    join(projectDir, 'prompts', 'images', 'settings'),
    join(projectDir, 'prompts', 'images', 'scenes'),
    join(projectDir, 'prompts', 'videos'),
    join(projectDir, 'prompts', 'videos', 'scenes'),
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
 * Create a minimal content registry with status tracking only.
 * File paths are NOT included - they are set when content is actually created.
 * This avoids confusion about files that don't exist yet.
 */
export function createDefaultContentRegistry(): ContentRegistry {
  return {
    plot: { status: 'missing' },
    story: { status: 'missing' },
    characters: { status: 'missing', items: [] },
    settings: { status: 'missing', items: [] },
    scenes: { status: 'missing', items: [] },
    images: { status: 'missing', items: [] },
    videos: { status: 'missing', items: [] },
  };
}

/**
 * Strip XML-like tags from content (e.g., <user_task>, [STORED CONTENT:], etc.)
 */
function stripWrapperTags(content: string): string {
  return (
    content
      // Remove <user_task>...</user_task> tags
      .replace(/<user_task>\s*/gi, '')
      .replace(/\s*<\/user_task>/gi, '')
      // Remove [user_task]... prefix
      .replace(/^\[user_task\]\s*/i, '')
      // Remove [STORED CONTENT: ...] blocks
      .replace(
        /\[STORED CONTENT:[^\]]*\]\s*context_ref:[^\n]*\n[^\n]*\n\nPreview:[^\n]*\n\n[^\n]*\n[^\n]*/gi,
        ''
      )
      .trim()
  );
}

/**
 * Build the fixed 8-phase structure for narrative projects.
 */
function buildNarrativePhases(): Record<string, import('./types.js').PhaseInfo> {
  return {
    plot: { status: 'pending', completedAt: null },
    story: { status: 'pending', completedAt: null },
    characters_settings: { status: 'pending', completedAt: null },
    scenes: { status: 'pending', completedAt: null },
    character_setting_images: { status: 'pending', completedAt: null },
    scene_images: { status: 'pending', completedAt: null },
    video: { status: 'pending', completedAt: null },
    video_combine: { status: 'pending', completedAt: null },
  };
}

/**
 * Create a new project file with the given input.
 * Stores originalInput in a separate file, only reference in project.json.
 * @param originalInput - The original story/prompt input
 * @param style - The visual style for the project (cinematic_realism or anime)
 * @param basePath - Base path for the project
 * @param targetDuration - Target video duration in seconds
 * @param templateId - Template to use for phase structure (default: narrative)
 */
export function createProject(
  originalInput: string,
  styleOrBasePath: ProjectStyle | string = 'cinematic_realism',
  basePathMaybe: string = process.cwd(),
  targetDuration?: number,
  templateId?: string
): ProjectFile {
  // Determine style and basePath.
  // If styleOrBasePath looks like a filesystem path, treat it as basePath (old signature).
  // Otherwise treat it as a style name.
  const looksLikePath =
    styleOrBasePath.startsWith('/') ||
    styleOrBasePath.startsWith('./') ||
    styleOrBasePath.startsWith('~');
  const style: ProjectStyle = looksLikePath
    ? 'cinematic_realism'
    : (styleOrBasePath as ProjectStyle);
  const basePath: string = looksLikePath
    ? String(styleOrBasePath)
    : basePathMaybe;

  // Infer project directory name from input and set it as active
  const inferredDir = inferProjectDirName(originalInput, basePath);
  setActiveProjectDir(inferredDir);

  // Ensure directory structure exists
  createProjectStructure(basePath);

  // If input looks like a file path and the file exists, read its contents
  let resolvedInput = originalInput;
  const trimmedInput = originalInput.trim();
  if (!trimmedInput.includes('\n') && (trimmedInput.startsWith('/') || trimmedInput.startsWith('~') || trimmedInput.startsWith('./'))) {
    const expandedPath = trimmedInput.startsWith('~')
      ? join(process.env['HOME'] || '', trimmedInput.slice(1))
      : trimmedInput;
    if (existsSync(expandedPath)) {
      resolvedInput = readFileSync(expandedPath, 'utf-8');
    }
  }

  // Clean the input - remove any XML tags or wrapper formats
  const cleanInput = stripWrapperTags(resolvedInput);

  const now = Date.now();
  const projectId = `proj-${now}-${Math.random().toString(36).slice(2, 8)}`;

  // Save original input to a separate file
  const inputFilePath = 'original_input.md';
  const fullInputPath = join(getProjectDir(basePath), inputFilePath);
  writeFileSync(fullInputPath, cleanInput, 'utf-8');

  // Build phases based on template
  const isNonNarrativeTemplate = templateId && templateId !== 'narrative';
  let phases: Record<string, import('./types.js').PhaseInfo>;
  let initialPhase: string;

  if (isNonNarrativeTemplate) {
    const template = TemplateRegistry.getInstance().get(templateId);
    if (template?.phases && template.phases.length > 0) {
      // Sort template phases by order, build dynamic phases
      const sortedPhases = [...template.phases].sort((a, b) => a.order - b.order);
      phases = {};
      for (const phase of sortedPhases) {
        phases[phase.id] = { status: 'pending', completedAt: null };
      }
      initialPhase = sortedPhases[0]!.id;
    } else {
      // Template exists but has no phases — fall back to narrative defaults
      phases = buildNarrativePhases();
      initialPhase = WorkflowPhase.PLOT;
    }
  } else {
    phases = buildNarrativePhases();
    initialPhase = WorkflowPhase.PLOT;
  }

  // Default to 'idea' input type - agent will analyze and update if it's a full story
  // Simplified structure: only track phase status, no file references for non-existent files
  const project: ProjectFile = {
    version: '2.0',
    id: projectId,
    title: generateProjectTitle(cleanInput),
    originalInputFile: inputFilePath,
    style,
    inputType: 'idea',
    ...(targetDuration != null ? { targetDuration } : {}),
    ...(templateId ? { templateId } : {}),
    createdAt: now,
    updatedAt: now,
    productionStartedAt: now,
    currentPhase: initialPhase as import('./types.js').WorkflowPhase,
    phases,
    // Empty content registry - entries added when content is created
    content: createDefaultContentRegistry(),
    // Empty arrays - populated as items are created
    characters: [],
    settings: [],
    scenes: [],
    assets: [],
    // Track only files that actually exist
    files: [{ type: 'original_input', path: inputFilePath }],
  };

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
      const phaseInfo = project.phases[skipPhase];
      if (phaseInfo) {
        phaseInfo.status = 'skipped';
        phaseInfo.completedAt = now;
        phaseInfo.plannerStage = PlannerStage.COMPLETE;
      }
    }

    // Update current phase to the start phase for this input type
    project.currentPhase = inputTypeConfig.startPhase;

    // Clear todos when skipping phases - new phase will create its own
    project.todos = [];

    // Read the original input and save it as the story
    const originalInput = getOriginalInput(project, basePath);
    if (originalInput) {
      const storyDir = join(getProjectDir(basePath), 'plans');
      if (!existsSync(storyDir)) {
        mkdirSync(storyDir, { recursive: true });
      }
      const storyPath = join(storyDir, 'story.md');
      writeFileSync(storyPath, `# Story\n\n${originalInput}`, 'utf-8');

      // Update content registry
      project.content.story.status = 'available';
    }
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
  // Non-narrative templates don't use the narrative content registry
  if (project.templateId && project.templateId !== 'narrative') {
    return false;
  }

  let needsSave = false;

  // Ensure content registry exists
  if (!project.content) {
    project.content = createDefaultContentRegistry();
    needsSave = true;
  }

  // Ensure files array exists
  if (!project.files) {
    project.files = [];
    needsSave = true;
  }

  // Helper to add file if not already tracked
  const trackFile = (type: string, path: string, name?: string) => {
    if (!project.files) project.files = [];
    const exists = project.files.some(f => f.path === path);
    if (!exists) {
      project.files.push({ type, path, name });
      needsSave = true;
    }
  };

  const projectDir = getProjectDir(basePath);

  // Always track original_input if it exists
  if (existsSync(join(projectDir, project.originalInputFile))) {
    trackFile('original_input', project.originalInputFile);
  }

  // Sync plot content
  const plotFile = join(projectDir, 'plans', 'plot.md');
  if (existsSync(plotFile)) {
    if (project.content.plot.status === 'missing') {
      project.content.plot.status = 'available';
      needsSave = true;
    }
    trackFile('plot', 'plans/plot.md');
  }

  // Sync story content - check both old format (story.md) and new format (chapters/)
  const storyFile = join(projectDir, 'plans', 'story.md');
  const chaptersDir = join(projectDir, 'plans', 'chapters');

  if (existsSync(storyFile)) {
    if (project.content.story.status === 'missing') {
      project.content.story.status = 'available';
      needsSave = true;
    }
    trackFile('story', 'plans/story.md');
  }

  // Also check for chapter-based story files
  if (existsSync(chaptersDir)) {
    const chapterFiles = readdirSync(chaptersDir)
      .filter(f => /^chapter-\d+\.story\.md$/.test(f))
      .sort();

    for (const chapterFile of chapterFiles) {
      trackFile('story_chapter', `plans/chapters/${chapterFile}`);
      if (project.content.story.status === 'missing') {
        project.content.story.status = 'available';
        needsSave = true;
      }
    }
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
    // Also track file path (new convention: .profile.md)
    const safeName = char.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const charFile = `characters/${safeName}.profile.md`;
    if (!project.content.characters.itemFiles) {
      project.content.characters.itemFiles = {};
    }
    if (!project.content.characters.itemFiles[char.name]) {
      project.content.characters.itemFiles[char.name] = charFile;
      needsSave = true;
    }
    // Track in files array
    trackFile('character', charFile, char.name);
  }

  // Sync characters from disk - scan characters/ directory for .profile.md and .md files
  const charactersDir = join(projectDir, 'characters');
  if (existsSync(charactersDir)) {
    // Support both old (.md) and new (.profile.md) naming conventions
    const charFiles = readdirSync(charactersDir).filter(
      f => f.endsWith('.profile.md') || (f.endsWith('.md') && !f.endsWith('.profile.md'))
    );

    for (const charFile of charFiles) {
      try {
        const charContent = readFileSync(join(charactersDir, charFile), 'utf-8');
        // Extract name from first heading or filename
        const nameMatch = charContent.match(/^#\s*(?:Character[:\-–—\s]*)?(.+)/m);
        const charName =
          nameMatch && nameMatch[1]
            ? nameMatch[1].trim()
            : charFile
                .replace(/\.profile\.md$/, '')
                .replace(/\.md$/, '')
                .replace(/[-_]/g, ' ');

        // Check if character is already registered
        const existingChar = project.characters.find(
          c => c.name.toLowerCase() === charName.toLowerCase()
        );
        if (!existingChar) {
          const character = createDefaultCharacterData(charName);

          // If characters_settings phase is complete, mark as approved
          if (
            project.phases['characters_settings']?.status === 'completed' ||
            project.phases['characters_settings']?.plannerStage === 'complete'
          ) {
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

  if (
    (project.content.characters.items?.length ?? 0) > 0 &&
    project.content.characters.status === 'missing'
  ) {
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
    // Also track file path (new convention: .profile.md)
    const safeName = setting.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const settingFile = `settings/${safeName}.profile.md`;
    if (!project.content.settings.itemFiles) {
      project.content.settings.itemFiles = {};
    }
    if (!project.content.settings.itemFiles[setting.name]) {
      project.content.settings.itemFiles[setting.name] = settingFile;
      needsSave = true;
    }
    // Track in files array
    trackFile('setting', settingFile, setting.name);
  }

  // Sync settings from disk - scan settings/ directory for .profile.md and .md files
  const settingsDir = join(projectDir, 'settings');
  if (existsSync(settingsDir)) {
    // Support both old (.md) and new (.profile.md) naming conventions
    const settingFiles = readdirSync(settingsDir).filter(
      f => f.endsWith('.profile.md') || (f.endsWith('.md') && !f.endsWith('.profile.md'))
    );

    for (const settingFile of settingFiles) {
      try {
        const settingContent = readFileSync(join(settingsDir, settingFile), 'utf-8');
        // Extract name from first heading or filename
        const nameMatch = settingContent.match(/^#\s*(?:Setting[:\-–—\s]*)?(.+)/m);
        const settingName =
          nameMatch && nameMatch[1]
            ? nameMatch[1].trim()
            : settingFile
                .replace(/\.profile\.md$/, '')
                .replace(/\.md$/, '')
                .replace(/[-_]/g, ' ');

        // Check if setting is already registered
        const existingSetting = project.settings.find(
          s => s.name.toLowerCase() === settingName.toLowerCase()
        );
        if (!existingSetting) {
          const setting = createDefaultSettingData(settingName);

          // If characters_settings phase is complete, mark as approved
          if (
            project.phases['characters_settings']?.status === 'completed' ||
            project.phases['characters_settings']?.plannerStage === 'complete'
          ) {
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

  if (
    (project.content.settings.items?.length ?? 0) > 0 &&
    project.content.settings.status === 'missing'
  ) {
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
    // Track in files array
    const sceneFile = `scenes/scene_${String(scene.sceneNumber).padStart(2, '0')}.md`;
    trackFile('scene', sceneFile, `Scene ${scene.sceneNumber}`);
  }
  if (
    (project.content.scenes.items?.length ?? 0) > 0 &&
    project.content.scenes.status === 'missing'
  ) {
    project.content.scenes.status = 'partial';
    needsSave = true;
  }

  // Sync scenes from disk - scan scenes/ directory for scene_XX.md files
  // This catches scenes that were created but never registered in project.scenes
  const scenesDir = join(projectDir, 'scenes');
  if (existsSync(scenesDir)) {
    const sceneFiles = readdirSync(scenesDir)
      .filter(f => /^scene_\d+\.md$/.test(f))
      .sort();

    for (const sceneFile of sceneFiles) {
      const match = sceneFile.match(/^scene_(\d+)\.md$/);
      if (match && match[1]) {
        const sceneNumber = parseInt(match[1], 10);

        // Track scene file in files array
        trackFile('scene', `scenes/${sceneFile}`, `Scene ${sceneNumber}`);

        // Check if scene is already registered
        const existingScene = project.scenes.find(s => s.sceneNumber === sceneNumber);
        if (!existingScene) {
          // Create new scene ref
          const sceneRef = createDefaultSceneRef(sceneNumber);

          // Extract title from file content
          try {
            const sceneContent = readFileSync(join(scenesDir, sceneFile), 'utf-8');
            const titleMatch = sceneContent.match(/^#\s*(?:Scene\s*\d+[:\-–—\s]*)?(.+)/m);
            if (titleMatch && titleMatch[1]) {
              sceneRef.title = titleMatch[1].trim();
            }
          } catch {
            /* ignore read errors */
          }

          // If scenes phase is complete, mark scene as approved
          if (
            project.phases['scenes']?.status === 'completed' ||
            project.phases['scenes']?.plannerStage === 'complete'
          ) {
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
    if (
      (project.content.scenes.items?.length ?? 0) > 0 &&
      project.content.scenes.status === 'missing'
    ) {
      project.content.scenes.status = 'partial';
      needsSave = true;
    }
  }

  // Sync image prompts for characters
  const charImagePromptsDir = join(projectDir, 'prompts', 'images', 'characters');
  if (existsSync(charImagePromptsDir)) {
    const promptFiles = readdirSync(charImagePromptsDir).filter(f => f.endsWith('.prompt.md'));
    for (const promptFile of promptFiles) {
      // Extract character name from filename (e.g., "alice.prompt.md" -> "alice")
      const charNameFromFile = promptFile.replace('.prompt.md', '').replace(/[-_]/g, ' ');
      const promptPath = `prompts/images/characters/${promptFile}`;

      // Find matching character (case-insensitive)
      const matchingChar = project.characters.find(
        c =>
          c.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim() === charNameFromFile.toLowerCase().trim()
      );
      if (matchingChar && !matchingChar.imagePromptPath) {
        matchingChar.imagePromptPath = promptPath;
        // If character_setting_images phase is in progress or complete, mark prompt as approved
        if (
          project.phases['character_setting_images']?.status === 'in_progress' ||
          project.phases['character_setting_images']?.status === 'completed'
        ) {
          matchingChar.imagePromptApprovalStatus = 'approved';
        }
        trackFile('character_image_prompt', promptPath, matchingChar.name);
        needsSave = true;
      }
    }
  }

  // Sync image prompts for settings
  const settingImagePromptsDir = join(projectDir, 'prompts', 'images', 'settings');
  if (existsSync(settingImagePromptsDir)) {
    const promptFiles = readdirSync(settingImagePromptsDir).filter(f => f.endsWith('.prompt.md'));
    for (const promptFile of promptFiles) {
      const settingNameFromFile = promptFile.replace('.prompt.md', '').replace(/[-_]/g, ' ');
      const promptPath = `prompts/images/settings/${promptFile}`;

      const matchingSetting = project.settings.find(
        s =>
          s.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim() === settingNameFromFile.toLowerCase().trim()
      );
      if (matchingSetting && !matchingSetting.imagePromptPath) {
        matchingSetting.imagePromptPath = promptPath;
        if (
          project.phases['character_setting_images']?.status === 'in_progress' ||
          project.phases['character_setting_images']?.status === 'completed'
        ) {
          matchingSetting.imagePromptApprovalStatus = 'approved';
        }
        trackFile('setting_image_prompt', promptPath, matchingSetting.name);
        needsSave = true;
      }
    }
  }

  // Sync image prompts for scenes
  const sceneImagePromptsDir = join(projectDir, 'prompts', 'images', 'scenes');
  if (existsSync(sceneImagePromptsDir)) {
    const promptFiles = readdirSync(sceneImagePromptsDir).filter(f => f.endsWith('.prompt.md'));
    for (const promptFile of promptFiles) {
      // Extract scene number from filename (e.g., "scene-1.prompt.md" -> 1)
      const sceneMatch = promptFile.match(/scene[_-]?(\d+)\.prompt\.md/i);
      if (sceneMatch && sceneMatch[1]) {
        const sceneNumber = parseInt(sceneMatch[1], 10);
        const promptPath = `prompts/images/scenes/${promptFile}`;

        const matchingScene = project.scenes.find(s => s.sceneNumber === sceneNumber);
        if (matchingScene && !matchingScene.imagePromptPath) {
          matchingScene.imagePromptPath = promptPath;
          if (
            project.phases['scene_images']?.status === 'in_progress' ||
            project.phases['scene_images']?.status === 'completed'
          ) {
            matchingScene.imagePromptApprovalStatus = 'approved';
          }
          trackFile('scene_image_prompt', promptPath, `Scene ${sceneNumber}`);
          needsSave = true;
        }
      }
    }
  }

  // Sync video/motion prompts for scenes
  const sceneVideoPromptsDir = join(projectDir, 'prompts', 'videos', 'scenes');
  if (existsSync(sceneVideoPromptsDir)) {
    const promptFiles = readdirSync(sceneVideoPromptsDir).filter(f => f.endsWith('.motion.md'));
    for (const promptFile of promptFiles) {
      const sceneMatch = promptFile.match(/scene[_-]?(\d+)\.motion\.md/i);
      if (sceneMatch && sceneMatch[1]) {
        const sceneNumber = parseInt(sceneMatch[1], 10);
        const promptPath = `prompts/videos/scenes/${promptFile}`;

        const matchingScene = project.scenes.find(s => s.sceneNumber === sceneNumber);
        if (matchingScene && !matchingScene.videoPromptPath) {
          matchingScene.videoPromptPath = promptPath;
          if (
            project.phases['video']?.status === 'in_progress' ||
            project.phases['video']?.status === 'completed'
          ) {
            matchingScene.videoPromptApprovalStatus = 'approved';
          }
          trackFile('scene_video_prompt', promptPath, `Scene ${sceneNumber}`);
          needsSave = true;
        }
      }
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
      console.warn(
        `[ProjectManager] Incompatible project version: ${project.version ?? 'unknown'}. Expected: 2.0`
      );
      console.warn('[ProjectManager] Please delete the .kshana directory and start a new project.');
      return null;
    }

    // Sync content registry for backward compatibility
    if (syncContentRegistry(project, basePath)) {
      saveProject(project, basePath);
    }

    // Initialize artifacts from existing files
    initializeArtifactsFromFiles(project, basePath);

    return project as ProjectFile;
  } catch {
    return null;
  }
}

/**
 * Check if an existing project is compatible with the current workflow.
 */
export function isProjectCompatible(basePath: string = process.cwd()): {
  compatible: boolean;
  version?: string;
  reason?: string;
} {
  const filePath = getProjectFilePath(basePath);

  if (!existsSync(filePath)) {
    return { compatible: true, reason: 'No existing project' };
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const project = JSON.parse(content);

    if (!project.version) {
      return {
        compatible: false,
        version: 'unknown',
        reason: 'Old project without version (pre-2.0). Delete .kshana directory to start fresh.',
      };
    }

    if (project.version !== '2.0') {
      return {
        compatible: false,
        version: project.version,
        reason: `Incompatible version ${project.version}. Expected 2.0. Delete .kshana directory to start fresh.`,
      };
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
 * Register a file in the project's files array with an optional summary.
 * If the file already exists in the array, updates it.
 */
export function registerFile(
  filePath: string,
  fileType: string,
  options: { name?: string; summary?: string } = {},
  basePath: string = process.cwd()
): void {
  const project = loadProject(basePath);
  if (!project) return;

  // Initialize files array if needed
  if (!project.files) {
    project.files = [];
  }

  // Check if file already registered
  const existingIndex = project.files.findIndex(f => f.path === filePath);

  const fileEntry = {
    type: fileType,
    path: filePath,
    ...(options.name && { name: options.name }),
    ...(options.summary && { summary: options.summary }),
  };

  if (existingIndex >= 0) {
    // Update existing entry
    project.files[existingIndex] = fileEntry;
  } else {
    // Add new entry
    project.files.push(fileEntry);

    // Also create an artifact for the new file
    createArtifactFromFile(project, filePath, fileType, options.name, options.summary, basePath);
  }

  saveProject(project, basePath);
}

/**
 * Generate a brief summary of file content (first 1-2 sentences or key info).
 */
export function generateFileSummary(content: string, fileType: string): string {
  const trimmed = content.trim();

  // For markdown files, try to extract the first meaningful paragraph
  if (fileType === 'plot' || fileType === 'story') {
    // Skip title lines (starting with #)
    const lines = trimmed.split('\n').filter(l => !l.startsWith('#') && l.trim());
    const firstParagraph = lines.slice(0, 3).join(' ').trim();
    if (firstParagraph.length > 150) {
      return firstParagraph.slice(0, 147) + '...';
    }
    return firstParagraph || `${fileType} content`;
  }

  // For character/setting files, extract name and brief description
  if (fileType === 'character' || fileType === 'setting') {
    const nameMatch = trimmed.match(/^#\s*(.+)/m);
    const name = nameMatch ? nameMatch[1] : 'Unknown';
    const descLines = trimmed
      .split('\n')
      .filter(l => !l.startsWith('#') && l.trim())
      .slice(0, 2);
    const desc = descLines.join(' ').trim();
    if (desc.length > 100) {
      return `${name}: ${desc.slice(0, 97)}...`;
    }
    return `${name}: ${desc || 'No description'}`;
  }

  // For scene files
  if (fileType === 'scene') {
    const titleMatch = trimmed.match(/^#\s*(.+)/m);
    const title = titleMatch?.[1] ?? 'Untitled scene';
    return title;
  }

  // Default: first 100 chars
  if (trimmed.length > 100) {
    return trimmed.slice(0, 97) + '...';
  }
  return trimmed || `${fileType} content`;
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
export function getOrCreateProject(
  originalInput: string,
  style: ProjectStyle = 'cinematic_realism',
  basePath: string = process.cwd()
): ProjectFile {
  const existing = loadProject(basePath);
  if (existing) {
    return existing;
  }
  return createProject(originalInput, style, basePath);
}

/**
 * Get the current workflow phase from the project.
 */
export function getCurrentPhase(project: ProjectFile): WorkflowPhase | string {
  return project.currentPhase;
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
  return STYLE_CONFIGS[style as keyof typeof STYLE_CONFIGS] ?? STYLE_CONFIGS['cinematic_realism'];
}

/**
 * Update a phase's status.
 * Ensures status and plannerStage stay synchronized.
 */
export function updatePhaseStatus(
  project: ProjectFile,
  phase: string,
  status: PhaseStatus,
  basePath: string = process.cwd()
): ProjectFile {
  const phaseInfo = project.phases[phase];
  if (!phaseInfo) {
    throw new Error(`Phase '${phase}' does not exist in project`);
  }
  phaseInfo.status = status;

  if (status === 'completed') {
    phaseInfo.completedAt = Date.now();
    phaseInfo.plannerStage = PlannerStage.COMPLETE;
  } else if (status === 'in_progress') {
    // Ensure plannerStage is set when status becomes in_progress
    if (!phaseInfo.plannerStage || phaseInfo.plannerStage === PlannerStage.COMPLETE) {
      // If plannerStage is not set or is already complete (shouldn't happen),
      // reset to PLANNING for consistency
      phaseInfo.plannerStage = PlannerStage.PLANNING;
    }
    // Set startedAt if not already set
    if (!phaseInfo.startedAt) {
      phaseInfo.startedAt = Date.now();
    }
  }

  saveProject(project, basePath);
  return project;
}

/**
 * Update a phase's planner stage.
 */
export function updatePlannerStage(
  project: ProjectFile,
  phase: string,
  stage: PlannerStage,
  basePath: string = process.cwd()
): ProjectFile {
  const phaseInfo = project.phases[phase];
  if (!phaseInfo) {
    throw new Error(`Phase '${phase}' does not exist in project`);
  }
  phaseInfo.plannerStage = stage;

  if (stage === PlannerStage.REFINING) {
    phaseInfo.refinementCount = (phaseInfo.refinementCount ?? 0) + 1;
  }

  // When planner stage reaches COMPLETE:
  // - For per-item phases: Only the PLAN is complete, not the phase itself
  //   The phase is only complete when all items are approved
  // - For planning-only phases: The phase is complete
  if (stage === PlannerStage.COMPLETE) {
    const phaseConfig = PHASE_CONFIGS[phase as WorkflowPhase];
    const isPerItemPhase = phaseConfig?.requiresPerItemApproval ?? false;

    if (!isPerItemPhase) {
      // Planning-only phases (plot, story, video_combine) are complete when plan is approved
      phaseInfo.status = 'completed';
      phaseInfo.completedAt = Date.now();
    } else {
      // For per-item phases, ensure status is 'in_progress' when planner stage is complete
      // (not 'pending', since we're now actively creating items)
      if (phaseInfo.status === 'pending') {
        phaseInfo.status = 'in_progress';
        phaseInfo.startedAt = Date.now();
      }
    }
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
    const phaseInfo = project.phases[result.nextPhase];
    if (phaseInfo) {
      phaseInfo.status = 'in_progress';
      phaseInfo.plannerStage = PlannerStage.PLANNING;
    }

    // Clear persisted todos from previous phase
    // New phase will create its own todos
    project.todos = [];

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
export function readProjectFile(
  relativePath: string,
  basePath: string = process.cwd()
): string | null {
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
export function saveCharacter(character: CharacterData, basePath: string = process.cwd()): void {
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
    // Also track in content registry for persistence across restarts
    addContentItem(project, 'characters', character.name, filePath, basePath);
    // Track in files array for simplified project overview
    addProjectFile(project, 'character', filePath, character.name, basePath);
  }
}

/**
 * Add a character to the project (creates default entry if only name provided).
 */
export function addCharacter(name: string, basePath: string = process.cwd()): CharacterData {
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

  const existing = project.characters[index];
  if (!existing) return null;

  const updated: CharacterData = { ...existing, ...updates };
  project.characters[index] = updated;
  saveProject(project, basePath);

  // Also save to markdown file if description changed
  if (updates.description || updates.visualDescription) {
    saveCharacter(updated, basePath);
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

  const index = project.characters.findIndex(c => c.name === name);
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
export function loadCharacterMarkdown(
  name: string,
  basePath: string = process.cwd()
): string | null {
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
    // Also track in content registry for persistence across restarts
    addContentItem(project, 'settings', setting.name, filePath, basePath);
    // Track in files array for simplified project overview
    addProjectFile(project, 'setting', filePath, setting.name, basePath);
  }
}

/**
 * Add a setting to the project (creates default entry if only name provided).
 */
export function addSetting(name: string, basePath: string = process.cwd()): SettingData {
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

  const existing = project.settings[index];
  if (!existing) return null;

  const updated: SettingData = { ...existing, ...updates };
  project.settings[index] = updated;
  saveProject(project, basePath);

  // Also save to markdown file if description changed
  if (updates.description || updates.visualDescription) {
    saveSetting(updated, basePath);
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

  const index = project.settings.findIndex(s => s.name === name);
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
  const existingIndex = project.scenes.findIndex(s => s.sceneNumber === sceneRef.sceneNumber);
  if (existingIndex >= 0) {
    project.scenes[existingIndex] = sceneRef;
  } else {
    project.scenes.push(sceneRef);
    project.scenes.sort((a, b) => a.sceneNumber - b.sceneNumber);
  }

  // Also track in content registry for persistence across restarts
  const sceneName = sceneRef.title || `Scene ${sceneRef.sceneNumber}`;
  addContentItem(project, 'scenes', sceneName, undefined, basePath);
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
    throw new Error(
      `⛔ SCENE LIMIT EXCEEDED: Maximum ${MAX_SCENES} scenes allowed. Scene ${sceneNumber} cannot be created.`
    );
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
  const existingIndex = manifest.assets.findIndex(a => a.id === asset.id);
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
  const phaseConfig = PHASE_CONFIGS[currentPhase as WorkflowPhase];
  const phaseInfo = project.phases[currentPhase];

  const completedPhases = Object.entries(project.phases)
    .filter(([, info]) => info.status === 'completed')
    .map(([key]) => key);

  // Get character and setting names from the data arrays
  const characterNames = project.characters.map(c => c.name);
  const settingNames = project.settings.map(s => s.name);

  // Get per-item approval status for current phase if applicable
  let itemProgress = '';
  if (phaseConfig?.requiresPerItemApproval) {
    const { approved, total } = countApprovedItems(project, currentPhase as WorkflowPhase);
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

  // Build files section with summaries
  let filesSection = '';
  if (project.files && project.files.length > 0) {
    const fileLines = project.files.map(f => {
      const nameStr = f.name ? ` (${f.name})` : '';
      const summaryStr = f.summary ? `: ${f.summary}` : '';
      return `  - ${f.path}${nameStr}${summaryStr}`;
    });
    filesSection = `\n\nAvailable Files:\n${fileLines.join('\n')}`;
  }

  return `
Project: ${project.title || '(untitled)'}
ID: ${project.id}
Version: ${project.version}
Style: ${styleDisplay}
Input Type: ${inputTypeDisplay}
Current Phase: ${phaseConfig?.displayName ?? currentPhase} (${currentPhase})
Planner Stage: ${phaseInfo?.plannerStage ?? 'not started'}
Completed Phases: ${completedPhases.length > 0 ? completedPhases.join(', ') : 'none'}
Skipped Phases: ${skippedPhases.length > 0 ? skippedPhases.join(', ') : 'none'}
Characters: ${characterNames.length > 0 ? characterNames.join(', ') : 'none defined'}
Settings: ${settingNames.length > 0 ? settingNames.join(', ') : 'none defined'}
Scenes: ${project.scenes.length}/${MAX_SCENES} (max)
Assets: ${project.assets.length}${itemProgress}${sceneLimitWarning}${filesSection}
`.trim();
}

/**
 * Get state transition prompt for non-narrative template projects.
 * Returns a generic prompt that points to backward planner tools.
 */
function getTemplateStateTransitionPrompt(project: ProjectFile): string {
  const currentPhase = project.currentPhase;
  const phaseInfo = project.phases[currentPhase];
  const template = TemplateRegistry.getInstance().get(project.templateId!);
  const phaseDef = template?.phases?.find((p: PhaseDefinition) => p.id === currentPhase);
  const phaseName = phaseDef?.displayName ?? currentPhase;
  const plannerStage = phaseInfo?.plannerStage ?? 'planning';

  // Build phase status summary
  const phaseKeys = Object.keys(project.phases);
  const statusLines = phaseKeys.map(key => {
    const info = project.phases[key];
    const def = template?.phases?.find((p: PhaseDefinition) => p.id === key);
    const name = def?.displayName ?? key;
    const marker = key === currentPhase ? ' ← current' : '';
    return `- **${name}** (${key}): ${info?.status ?? 'unknown'}${marker}`;
  });

  return `
## Current State
- **Template**: ${template?.displayName ?? project.templateId}
- **Phase**: ${phaseName} (${currentPhase})
- **Status**: ${phaseInfo?.status ?? 'unknown'}
- **Planner Stage**: ${plannerStage}

## All Phases
${statusLines.join('\n')}

## What to Do Next

Use the backward planner tools to work on the current phase.
The artifact dependency graph defines what needs to be created and in what order.
Use \`read_project\` to understand available artifacts and \`update_project\` to track progress.

When this phase is complete, use \`update_project(action: 'transition_phase')\` to advance to the next phase.
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

  // Non-narrative templates: return a generic prompt pointing to backward planner tools
  if (project.templateId && project.templateId !== 'narrative') {
    return getTemplateStateTransitionPrompt(project);
  }

  const currentPhase = project.currentPhase;
  const phaseConfig = PHASE_CONFIGS[currentPhase as WorkflowPhase];
  const phaseInfo = project.phases[currentPhase];

  // Check if this phase was skipped
  if (phaseInfo?.status === 'skipped') {
    const nextPhase = phaseConfig.nextPhase;
    if (nextPhase && PHASE_CONFIGS[nextPhase]) {
      const nextPhaseConfig = PHASE_CONFIGS[nextPhase];
      return `
## Current State
- **Phase**: ${phaseConfig.displayName}
- **Status**: SKIPPED

## What to Do Next

This phase is SKIPPED (likely because the user provided a complete chapter).

⛔ **DO NOT create any content for this phase**

Immediately transition to the next phase:
\`\`\`
update_project(action: 'transition_phase', data: { next_phase: '${nextPhase}' })
\`\`\`

Next phase: **${nextPhaseConfig.displayName}**
`;
    }
  }

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
    if (
      phaseConfig.phase === WorkflowPhase.CHARACTERS_SETTINGS ||
      phaseConfig.phase === WorkflowPhase.SCENES
    ) {
      instruction += getPerItemPhasePlanningInstructions(
        project,
        phaseConfig,
        plannerStage,
        planFileExists,
        basePath
      );
    } else {
      instruction += getPerItemPhaseInstructions(project, phaseConfig, basePath);
    }
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
1. Use transition_phase to move to the next phase: ${phaseConfig.nextPhase && PHASE_CONFIGS[phaseConfig.nextPhase] ? PHASE_CONFIGS[phaseConfig.nextPhase].displayName : 'DONE'}
`;
        break;
    }
  }

  return instruction.trim();
}

/**
 * Get planning instructions for per-item phases that require a breakdown approval step.
 */
function getPerItemPhasePlanningInstructions(
  project: ProjectFile,
  phaseConfig: PhaseConfig,
  plannerStage: PlannerStage,
  planFileExists: boolean,
  _basePath: string
): string {
  const planFile = phaseConfig.planOutputFile ?? 'N/A';
  const isCharacters = phaseConfig.phase === WorkflowPhase.CHARACTERS_SETTINGS;
  const planLabel = isCharacters ? 'Character & Setting Breakdown' : 'Scene Outline';
  const planSummary = isCharacters
    ? 'Identify all characters and key settings from the chapter with short role notes.'
    : 'Outline 5-8 key scenes with short titles and beats.';
  const planNotes = isCharacters
    ? 'Do NOT write full character/setting descriptions yet.'
    : 'Do NOT write full scene descriptions yet.';

  let instruction = `
**IMPORTANT: This phase starts with a ${planLabel} that requires user approval before per-item generation.**

## Planner Stage
- **Stage**: ${plannerStage}
- **Plan File**: ${planFile}
- **Plan File Has Content**: ${planFileExists ? 'YES' : 'NO'}
`;

  switch (plannerStage) {
    case PlannerStage.PLANNING:
      if (planFileExists) {
        instruction += `
A ${planLabel} already exists at ${planFile}. Do NOT regenerate it.

1. Read the plan from ${planFile}
2. Move to VERIFY and present it for approval
`;
      } else {
        instruction += `
Create the ${planLabel}.
1. Read the story
2. ${planSummary}
3. Save the breakdown to ${planFile}
4. Move to VERIFY stage by updating the planner stage

${planNotes}
`;
      }
      break;

    case PlannerStage.VERIFY:
      if (planFileExists) {
        instruction += `
Present the ${planLabel} to the user for approval.
1. Read the plan from ${planFile}
2. Present a concise summary to the user using ask_user
3. If approved, update planner stage to COMPLETE
4. If feedback is given, move to REFINING stage

${planNotes}
`;
      } else {
        instruction += `
No ${planLabel} found at ${planFile}.
Return to PLANNING stage to create the breakdown before requesting approval.
`;
      }
      break;

    case PlannerStage.REFINING:
      instruction += `
Update the ${planLabel} based on user feedback.
1. Read the current plan
2. Apply feedback
3. Update the plan in ${planFile}
4. Move back to VERIFY stage

${planNotes}
`;
      break;

    case PlannerStage.COMPLETE:
      instruction += `
${planLabel} approved. Proceed with per-item generation.
`;
      instruction += getPerItemPhaseInstructions(project, phaseConfig, _basePath);
      break;
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
  const { approved: approvedCount, total: totalItems } = countApprovedItems(
    project,
    phaseConfig.phase
  );

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
    const status =
      item.status === 'approved'
        ? 'completed'
        : idx === allItems.findIndex(i => i.status !== 'approved')
          ? 'in_progress'
          : 'pending';
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
        instruction += `Use the approved Character & Setting Breakdown to register each character and setting, then create their profiles.
`;
        break;
      case WorkflowPhase.CHARACTER_SETTING_IMAGES:
        instruction += `No characters or settings are registered yet. Read the story, identify all characters and settings, and register each one with their descriptions before generating reference images.
`;
        break;
      case WorkflowPhase.SCENES:
        instruction += `Use the approved Scene Outline to register each scene, then create detailed scene descriptions.
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

Generate detailed content including description and visual characteristics suitable for image generation.

After creating, get user approval before moving to the next item.

**CRITICAL - After User Approval:**
1. Register the item with update_project(action: 'add_${nextItem.type}', ...)
2. **MUST** call TodoWrite(merge: true, todos: [...]) to mark the current item as 'completed' and the next as 'in_progress'
3. Then create the next item

**DO NOT skip the TodoWrite call!**
`;
        break;
    }
  } else if (areAllItemsApproved(project, phaseConfig.phase)) {
    instruction += `
## All Items Approved!

All ${totalItems} items have been approved. Mark this phase as complete and move to the next phase: **${phaseConfig.nextPhase && PHASE_CONFIGS[phaseConfig.nextPhase] ? PHASE_CONFIGS[phaseConfig.nextPhase].displayName : 'DONE'}**
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
 * Add a file to the project's files tracking array.
 * This helps agents understand what content exists without parsing the full structure.
 */
export function addProjectFile(
  project: ProjectFile,
  fileType: string,
  filePath: string,
  name?: string,
  basePath: string = process.cwd()
): ProjectFile {
  // Initialize files array if needed
  if (!project.files) {
    project.files = [];
  }

  // Check if file already exists in the array
  const existingIndex = project.files.findIndex(
    f => f.path === filePath || (f.type === fileType && f.name === name)
  );

  if (existingIndex >= 0) {
    // Update existing entry
    project.files[existingIndex] = { type: fileType, path: filePath, name };
  } else {
    // Add new entry
    project.files.push({ type: fileType, path: filePath, name });
  }

  saveProject(project, basePath);
  return project;
}

/**
 * Get the files summary string for use in prompts.
 * This provides a simple list of existing files for agents to reference.
 */
export function getFilesContext(project: ProjectFile): string {
  if (!project.files || project.files.length === 0) {
    return 'No project files created yet.';
  }

  let context = '## Existing Project Files\n\n';
  context += 'The following files exist and can be read:\n\n';

  for (const file of project.files) {
    const nameStr = file.name ? ` (${file.name})` : '';
    context += `- **${file.type}${nameStr}**: \`.kshana/${file.path}\`\n`;
  }

  return context.trim();
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

// ============================================================================
// Image/Video Prompt Persistence Functions
// ============================================================================

/**
 * Prompt type for image/video prompts.
 */
export type PromptType = 'character' | 'setting' | 'scene';

/**
 * Save an image prompt to the prompts directory.
 * @param type - Type of prompt (character, setting, scene)
 * @param name - Name/identifier (character name, setting name, or scene number as string)
 * @param content - The prompt content to save
 * @param basePath - Base path for the project
 * @returns The relative path where the prompt was saved
 */
export function saveImagePrompt(
  type: PromptType,
  name: string,
  content: string,
  basePath: string = process.cwd()
): string {
  const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  let relativePath: string;

  switch (type) {
    case 'character':
      relativePath = `prompts/images/characters/${safeName}.prompt.md`;
      break;
    case 'setting':
      relativePath = `prompts/images/settings/${safeName}.prompt.md`;
      break;
    case 'scene':
      relativePath = `prompts/images/scenes/scene-${safeName}.prompt.md`;
      break;
  }

  writeProjectFile(relativePath, content, basePath);

  // Update the project with the prompt path
  const project = loadProject(basePath);
  if (project) {
    if (type === 'character') {
      const character = project.characters.find(
        c => c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') === safeName
      );
      if (character) {
        character.imagePromptPath = relativePath;
        saveProject(project, basePath);
      }
    } else if (type === 'setting') {
      const setting = project.settings.find(
        s => s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') === safeName
      );
      if (setting) {
        setting.imagePromptPath = relativePath;
        saveProject(project, basePath);
      }
    } else if (type === 'scene') {
      const sceneNumber = parseInt(name, 10);
      const scene = project.scenes.find(s => s.sceneNumber === sceneNumber);
      if (scene) {
        scene.imagePromptPath = relativePath;
        saveProject(project, basePath);
      }
    }
  }

  return relativePath;
}

/**
 * Load an image prompt from the prompts directory.
 * @param type - Type of prompt (character, setting, scene)
 * @param name - Name/identifier (character name, setting name, or scene number as string)
 * @param basePath - Base path for the project
 * @returns The prompt content or null if not found
 */
export function loadImagePrompt(
  type: PromptType,
  name: string,
  basePath: string = process.cwd()
): string | null {
  const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  let relativePath: string;

  switch (type) {
    case 'character':
      relativePath = `prompts/images/characters/${safeName}.prompt.md`;
      break;
    case 'setting':
      relativePath = `prompts/images/settings/${safeName}.prompt.md`;
      break;
    case 'scene':
      relativePath = `prompts/images/scenes/scene-${safeName}.prompt.md`;
      break;
  }

  return readProjectFile(relativePath, basePath);
}

/**
 * Save a video/motion prompt to the prompts directory.
 * @param sceneNumber - The scene number
 * @param content - The prompt content to save
 * @param basePath - Base path for the project
 * @returns The relative path where the prompt was saved
 */
export function saveVideoPrompt(
  sceneNumber: number,
  content: string,
  basePath: string = process.cwd()
): string {
  const relativePath = `prompts/videos/scenes/scene-${sceneNumber}.motion.md`;
  writeProjectFile(relativePath, content, basePath);

  // Update the project with the prompt path
  const project = loadProject(basePath);
  if (project) {
    const scene = project.scenes.find(s => s.sceneNumber === sceneNumber);
    if (scene) {
      scene.videoPromptPath = relativePath;
      saveProject(project, basePath);
    }
  }

  return relativePath;
}

/**
 * Load a video/motion prompt from the prompts directory.
 * @param sceneNumber - The scene number
 * @param basePath - Base path for the project
 * @returns The prompt content or null if not found
 */
export function loadVideoPrompt(
  sceneNumber: number,
  basePath: string = process.cwd()
): string | null {
  const relativePath = `prompts/videos/scenes/scene-${sceneNumber}.motion.md`;
  return readProjectFile(relativePath, basePath);
}

/**
 * Update the image prompt approval status for a character, setting, or scene.
 */
export function updateImagePromptApproval(
  type: PromptType,
  name: string,
  status: ItemApprovalStatus,
  basePath: string = process.cwd()
): boolean {
  const project = loadProject(basePath);
  if (!project) return false;

  const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  if (type === 'character') {
    const character = project.characters.find(
      c => c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') === safeName
    );
    if (character) {
      character.imagePromptApprovalStatus = status;
      saveProject(project, basePath);
      return true;
    }
  } else if (type === 'setting') {
    const setting = project.settings.find(
      s => s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') === safeName
    );
    if (setting) {
      setting.imagePromptApprovalStatus = status;
      saveProject(project, basePath);
      return true;
    }
  } else if (type === 'scene') {
    const sceneNumber = parseInt(name, 10);
    const scene = project.scenes.find(s => s.sceneNumber === sceneNumber);
    if (scene) {
      scene.imagePromptApprovalStatus = status;
      saveProject(project, basePath);
      return true;
    }
  }

  return false;
}

/**
 * Update the video prompt approval status for a scene.
 */
export function updateVideoPromptApproval(
  sceneNumber: number,
  status: ItemApprovalStatus,
  basePath: string = process.cwd()
): boolean {
  const project = loadProject(basePath);
  if (!project) return false;

  const scene = project.scenes.find(s => s.sceneNumber === sceneNumber);
  if (scene) {
    scene.videoPromptApprovalStatus = status;
    saveProject(project, basePath);
    return true;
  }

  return false;
}

// ============================================================================
// Todo Persistence Functions
// ============================================================================

import type { PersistedTodo } from './types.js';

/**
 * Save todos to the project file for resumption.
 * Called after TodoWrite operations to persist the current state.
 */
export function saveTodos(todos: PersistedTodo[], basePath: string = process.cwd()): boolean {
  const project = loadProject(basePath);
  if (!project) {
    return false;
  }

  project.todos = todos;
  saveProject(project, basePath);
  return true;
}

/**
 * Load persisted todos from the project file.
 * Returns empty array if no todos are stored.
 */
export function loadTodos(basePath: string = process.cwd()): PersistedTodo[] {
  const project = loadProject(basePath);
  if (!project || !project.todos) {
    return [];
  }
  return project.todos;
}

/**
 * Clear persisted todos from the project file.
 * Useful when starting a new phase or resetting.
 */
export function clearPersistedTodos(basePath: string = process.cwd()): boolean {
  const project = loadProject(basePath);
  if (!project) {
    return false;
  }

  project.todos = [];
  saveProject(project, basePath);
  return true;
}

// ============================================================================
// Multi-Input Management Functions
// ============================================================================

import type { ProjectInput, InputPurpose, PrimaryNarrationConfig } from './types.js';

/**
 * Add a new input to the project.
 * @param input - The input to add (without ID)
 * @param basePath - Base path for the project
 * @returns The added input with its generated ID
 */
export function addProjectInput(
  input: Omit<ProjectInput, 'id'>,
  basePath: string = process.cwd()
): ProjectInput {
  const project = loadProject(basePath);
  if (!project) {
    throw new Error('No project found');
  }

  // Initialize inputs array if needed
  if (!project.inputs) {
    project.inputs = [];
  }

  // Generate ID
  const inputId = `input-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const newInput: ProjectInput = {
    ...input,
    id: inputId,
  };

  project.inputs.push(newInput);
  saveProject(project, basePath);

  // Create inputs directory structure
  const inputsDir = join(getProjectDir(basePath), 'inputs');
  const subdirs = ['local', 'remote', 'youtube', 'transcriptions', 'keyframes', 'extracted_audio'];
  for (const subdir of subdirs) {
    const dir = join(inputsDir, subdir);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  return newInput;
}

/**
 * Update an existing input in the project.
 * @param inputId - ID of the input to update
 * @param updates - Partial input data to merge
 * @param basePath - Base path for the project
 * @returns The updated input or null if not found
 */
export function updateProjectInput(
  inputId: string,
  updates: Partial<ProjectInput>,
  basePath: string = process.cwd()
): ProjectInput | null {
  const project = loadProject(basePath);
  if (!project || !project.inputs) {
    return null;
  }

  const index = project.inputs.findIndex(i => i.id === inputId);
  if (index === -1) {
    return null;
  }

  // Deep merge for nested objects
  const existing = project.inputs[index];
  if (!existing) {
    return null;
  }

  const updated: ProjectInput = {
    ...existing,
    ...updates,
    source: { ...existing.source, ...updates.source },
    metadata: { ...existing.metadata, ...updates.metadata },
    processing: { ...existing.processing, ...updates.processing },
  };

  project.inputs[index] = updated;
  saveProject(project, basePath);

  return updated;
}

/**
 * Delete an input from the project.
 * @param inputId - ID of the input to delete
 * @param basePath - Base path for the project
 * @returns Whether the deletion was successful
 */
export function deleteProjectInput(inputId: string, basePath: string = process.cwd()): boolean {
  const project = loadProject(basePath);
  if (!project || !project.inputs) {
    return false;
  }

  const initialLength = project.inputs.length;
  project.inputs = project.inputs.filter(i => i.id !== inputId);

  if (project.inputs.length === initialLength) {
    return false;
  }

  // Clear primary narration if it was this input
  if (project.primaryNarration?.inputId === inputId) {
    project.primaryNarration = undefined;
  }

  saveProject(project, basePath);
  return true;
}

/**
 * Get an input by ID.
 * @param inputId - ID of the input to get
 * @param basePath - Base path for the project
 * @returns The input or null if not found
 */
export function getProjectInput(
  inputId: string,
  basePath: string = process.cwd()
): ProjectInput | null {
  const project = loadProject(basePath);
  if (!project || !project.inputs) {
    return null;
  }

  return project.inputs.find(i => i.id === inputId) || null;
}

/**
 * Set the primary narration source for the project.
 * @param inputId - ID of the input to use as narration
 * @param preserveAudio - Whether to preserve original audio in final video
 * @param basePath - Base path for the project
 */
export function setPrimaryNarration(
  inputId: string,
  preserveAudio: boolean,
  basePath: string = process.cwd()
): void {
  const project = loadProject(basePath);
  if (!project) {
    throw new Error('No project found');
  }

  const input = project.inputs?.find(i => i.id === inputId);
  if (!input) {
    throw new Error(`Input not found: ${inputId}`);
  }

  // Determine narration type based on media type
  let narrationType: 'text' | 'audio' | 'transcription';
  if (input.mediaType === 'text') {
    narrationType = 'text';
  } else if (input.mediaType === 'audio') {
    narrationType = 'audio';
  } else if (input.mediaType === 'video') {
    narrationType = 'transcription';
  } else {
    throw new Error(`Cannot use ${input.mediaType} as narration source`);
  }

  project.primaryNarration = {
    inputId,
    type: narrationType,
    preserveAudio: narrationType !== 'text' && preserveAudio,
  };

  saveProject(project, basePath);
}

/**
 * Get inputs filtered by purpose.
 * @param purpose - The purpose to filter by
 * @param basePath - Base path for the project
 * @returns Array of inputs with the specified purpose
 */
export function getInputsByPurpose(
  purpose: InputPurpose,
  basePath: string = process.cwd()
): ProjectInput[] {
  const project = loadProject(basePath);
  if (!project || !project.inputs) {
    return [];
  }

  return project.inputs.filter(i => i.purpose === purpose);
}

/**
 * Get the narration content from the primary narration source.
 * Returns the text content (from text input or audio transcription)
 * along with timing information if audio is being preserved.
 * @param basePath - Base path for the project
 * @returns Narration content or null if no primary narration set
 */
export function getNarrationContent(basePath: string = process.cwd()): {
  content: string;
  audioPath?: string;
  timingMarkers?: Array<{ start: number; end: number; text: string }>;
} | null {
  const project = loadProject(basePath);
  if (!project || !project.primaryNarration) {
    return null;
  }

  const input = project.inputs?.find(i => i.id === project.primaryNarration?.inputId);
  if (!input) {
    return null;
  }

  // Get content based on narration type
  let content: string;
  if (project.primaryNarration.type === 'text') {
    // Read text content from local path
    if (input.processing.localPath && existsSync(input.processing.localPath)) {
      content = readFileSync(input.processing.localPath, 'utf-8');
    } else if (input.source.type === 'inline') {
      content = input.source.value;
    } else {
      return null;
    }
  } else {
    // Use transcription for audio/video
    if (!input.processing.transcription) {
      return null;
    }
    content = input.processing.transcription;
  }

  const result: {
    content: string;
    audioPath?: string;
    timingMarkers?: Array<{ start: number; end: number; text: string }>;
  } = { content };

  // Add audio path if preserving audio
  if (project.primaryNarration.preserveAudio) {
    if (input.mediaType === 'audio') {
      result.audioPath = input.processing.localPath;
    } else if (input.mediaType === 'video') {
      result.audioPath = input.processing.extractedAudioPath || input.processing.localPath;
    }
    result.timingMarkers = input.processing.timingMarkers;
  }

  return result;
}

/**
 * Get all inputs for the project.
 * @param basePath - Base path for the project
 * @returns Array of all inputs
 */
export function getAllInputs(basePath: string = process.cwd()): ProjectInput[] {
  const project = loadProject(basePath);
  if (!project || !project.inputs) {
    return [];
  }
  return project.inputs;
}

/**
 * Check if any inputs exist in the project.
 * @param basePath - Base path for the project
 * @returns Whether the project has any inputs
 */
export function hasInputs(basePath: string = process.cwd()): boolean {
  const project = loadProject(basePath);
  return !!(project?.inputs && project.inputs.length > 0);
}

/**
 * Get inputs by processing status.
 * @param status - The processing status to filter by
 * @param basePath - Base path for the project
 * @returns Array of inputs with the specified status
 */
export function getInputsByStatus(
  status: 'pending' | 'processing' | 'completed' | 'failed',
  basePath: string = process.cwd()
): ProjectInput[] {
  const project = loadProject(basePath);
  if (!project || !project.inputs) {
    return [];
  }

  return project.inputs.filter(i => i.processing.status === status);
}
