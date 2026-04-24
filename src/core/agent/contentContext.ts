/**
 * Pre-fetches and formats context for content creator subagents.
 *
 * Each artifact level fully encapsulates the level above it — a scene description
 * already contains everything from the story relevant to that scene. This module
 * reads the MINIMAL set of files for each content type, eliminating redundant reads.
 */
import { tryParseSceneMotionPrompt } from '../contentValidation.js';
import { loadTimeline } from '../timeline/TimelineManager.js';
import { getProjectDir, loadProject } from '../../tasks/video/workflow/ProjectManager.js';
import type { ProjectFile } from '../../tasks/video/workflow/types.js';
import {
  projectExists as projectFileExists,
  readProjectText,
} from '../../tasks/video/workflow/projectFileIO.js';

/**
 * Result of building pre-loaded context.
 */
export interface PreloadedContext {
  /** Formatted context block to inject into the subagent task */
  contextBlock: string;
  /** List of files that were read (for debugging/analytics) */
  filesRead: string[];
}

/**
 * Safely read a file from the project directory.
 * Returns the content or null if not found.
 */
function readProjectFile(relativePath: string): string | null {
  try {
    return readProjectText(relativePath);
  } catch {
    // File not readable
  }
  return null;
}

/**
 * Find the file path for a character profile.
 */
function getCharacterFilePath(project: ProjectFile, charName: string): string | undefined {
  const itemFiles = project.content?.characters?.itemFiles;
  if (itemFiles?.[charName]) return itemFiles[charName];
  const safeName = charName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return `characters/${safeName}.profile.md`;
}

/**
 * Find the file path for a setting profile.
 */
function getSettingFilePath(project: ProjectFile, settingName: string): string | undefined {
  const itemFiles = project.content?.settings?.itemFiles;
  if (itemFiles?.[settingName]) return itemFiles[settingName];
  const safeName = settingName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return `settings/${safeName}.profile.md`;
}

/**
 * Build a reference images section listing verified paths.
 */
function buildReferenceImagesSection(
  project: ProjectFile,
  opts?: { filterCharNames?: string[]; filterSettingNames?: string[] }
): string {
  const lines: string[] = [];

  const chars = opts?.filterCharNames
    ? project.characters.filter(c => opts.filterCharNames!.includes(c.name))
    : project.characters;

  const settings = opts?.filterSettingNames
    ? project.settings.filter(s => opts.filterSettingNames!.includes(s.name))
    : project.settings;

  lines.push('### Character Reference Images');
  for (const char of chars) {
    if (char.referenceImagePath) {
      if (projectFileExists(char.referenceImagePath)) {
        lines.push(`- ${char.name}: ${char.referenceImagePath} (exists)`);
      } else {
        lines.push(`- ${char.name}: reference image missing`);
      }
    } else {
      lines.push(`- ${char.name}: no reference image`);
    }
  }

  lines.push('### Setting Reference Images');
  for (const setting of settings) {
    if (setting.referenceImagePath) {
      if (projectFileExists(setting.referenceImagePath)) {
        lines.push(`- ${setting.name}: ${setting.referenceImagePath} (exists)`);
      } else {
        lines.push(`- ${setting.name}: reference image missing`);
      }
    } else {
      lines.push(`- ${setting.name}: no reference image`);
    }
  }

  return lines.join('\n');
}

function buildShotContinuitySection(sceneNumber: number, shotNumber: number): string | null {
  const projectDir = getProjectDir();
  const motionPromptPath = `prompts/videos/scenes/scene-${sceneNumber}.motion.json`;
  const motionPromptContent = readProjectFile(motionPromptPath);
  const parsedMotionPrompt = motionPromptContent
    ? tryParseSceneMotionPrompt(motionPromptContent)
    : null;
  const shot = parsedMotionPrompt?.shots?.find(candidate => candidate.shotNumber === shotNumber);

  const timeline = loadTimeline(projectDir);
  const priorTimelineSegments = timeline?.segments
    .filter(segment => {
      const match = new RegExp(`^segment_${sceneNumber - 1}_shot_(\\d+)$`).exec(segment.id);
      if (!match?.[1]) {
        return false;
      }
      return Number(match[1]) < shotNumber;
    })
    .sort((a, b) => a.startTime - b.startTime) ?? [];

  const priorPromptBlocks: string[] = [];
  for (let currentShot = 1; currentShot < shotNumber; currentShot++) {
    const promptPath = `prompts/images/shots/scene-${sceneNumber}-shot-${currentShot}.prompt.md`;
    const promptContent = readProjectFile(promptPath);
    if (promptContent) {
      priorPromptBlocks.push(`Shot ${currentShot} Prompt (${promptPath})\n${promptContent}`);
    }
  }

  const lines: string[] = [];
  if (shot) {
    lines.push('### Current Shot Continuity Target');
    lines.push(`- Shot Number: ${shot.shotNumber ?? shotNumber}`);
    if (shot.label) lines.push(`- Shot Label: ${shot.label}`);
    if (shot.shotType) lines.push(`- Shot Type: ${shot.shotType}`);
    if (shot.cameraWork) lines.push(`- Camera Work: ${shot.cameraWork}`);
    if (shot.prompt) lines.push(`- Action/Prompt: ${shot.prompt}`);
    if (shot.continuity_anchor) lines.push(`- Character Appearance Lock: ${shot.continuity_anchor}`);
    if (shot.wardrobe_lock) lines.push(`- Wardrobe / Props Lock: ${shot.wardrobe_lock}`);
    if (shot.setting_lock) lines.push(`- Setting Anchor Details: ${shot.setting_lock}`);
    if (shot.scene_palette) lines.push(`- Lighting / Palette Lock: ${shot.scene_palette}`);
    if (shot.dialogue) lines.push(`- Emotional Tone / Dialogue: ${shot.dialogue}`);
    if (shot.do_not_change) lines.push(`- Do Not Change: ${shot.do_not_change}`);
  }

  if (parsedMotionPrompt) {
    lines.push('### Scene-Wide Continuity Source');
    if (parsedMotionPrompt.sceneTitle) lines.push(`- Scene Title: ${parsedMotionPrompt.sceneTitle}`);
    if (parsedMotionPrompt.totalSceneDuration) {
      lines.push(`- Scene Duration: ${parsedMotionPrompt.totalSceneDuration}s`);
    }
    lines.push(`- Motion Prompt File: ${motionPromptPath}`);
  }

  if (priorPromptBlocks.length > 0) {
    lines.push('### Earlier Approved Shot Prompts In This Scene');
    lines.push(priorPromptBlocks.join('\n\n---\n\n'));
  }

  if (priorTimelineSegments.length > 0) {
    lines.push('### Earlier Timeline Continuity References');
    for (const segment of priorTimelineSegments) {
      lines.push(
        `- ${segment.id} (${segment.fillStatus})` +
        `${segment.metadata ? ` metadata=${JSON.stringify(segment.metadata)}` : ''}` +
        `${segment.layers[0]?.metadata ? ` layer_prompt=${JSON.stringify(segment.layers[0].metadata)}` : ''}`
      );
    }
  }

  if (lines.length === 0) {
    return null;
  }

  return lines.join('\n');
}

/**
 * Build pre-loaded context for a content creator subagent.
 *
 * Returns the minimal set of files needed for the given content type,
 * eliminating the need for the subagent to call read_file().
 */
export function buildPreloadedContext(
  contentType: string,
  name?: string,
  sceneNumber?: number,
  shotNumber?: number,
  chapterNumber?: number,
): PreloadedContext | null {
  const project = loadProject();
  if (!project) return null;

  const filesRead: string[] = [];
  const sections: string[] = [];

  // Helper to read and add a file section
  const addFileSection = (label: string, relativePath: string): string | null => {
    const content = readProjectFile(relativePath);
    if (content) {
      filesRead.push(relativePath);
      sections.push(`### ${label}\n**File:** ${relativePath}\n\n${content}`);
      return content;
    }
    return null;
  };

  // Add project metadata
  sections.push(`### Project Metadata
**Template:** ${(project as unknown as Record<string, unknown>)['templateId'] ?? 'narrative'}
**Style:** ${project.style}
**Phase:** ${project.currentPhase}
**Characters:** ${project.characters.map(c => c.name).join(', ') || 'None'}
**Settings:** ${project.settings.map(s => s.name).join(', ') || 'None'}`);

  const chapterPaths = (project.files || [])
    .map(file => file.path)
    .filter((filePath): filePath is string => /^plans\/chapters\/.+\.story\.md$/.test(filePath))
    .sort();

  switch (contentType) {
    case 'plot': {
      // Plot only needs original_input.md
      addFileSection('Original Input', project.originalInputFile);
      break;
    }

    case 'story': {
      // Story needs the plot (which encapsulates original_input)
      addFileSection('Plot', 'plans/plot.md');
      break;
    }

    case 'character': {
      // Character needs story chapters (which encapsulate plot + original_input)
      for (const chapterPath of chapterPaths) {
        addFileSection(`Story Chapter: ${chapterPath.split('/').pop()}`, chapterPath);
      }
      break;
    }

    case 'setting': {
      // Setting needs story chapters
      for (const chapterPath of chapterPaths) {
        addFileSection(`Story Chapter: ${chapterPath.split('/').pop()}`, chapterPath);
      }
      break;
    }

    case 'scene': {
      // Scene needs story + character/setting profiles mentioned in the scene
      for (const chapterPath of chapterPaths) {
        addFileSection(`Story Chapter: ${chapterPath.split('/').pop()}`, chapterPath);
      }
      // Add all character and setting profiles
      for (const char of project.characters) {
        const filePath = getCharacterFilePath(project, char.name);
        if (filePath) addFileSection(`Character: ${char.name}`, filePath);
      }
      for (const setting of project.settings) {
        const filePath = getSettingFilePath(project, setting.name);
        if (filePath) addFileSection(`Setting: ${setting.name}`, filePath);
      }
      break;
    }

    case 'character_image_prompt': {
      // Only needs the character profile + reference image info
      if (name) {
        const filePath = getCharacterFilePath(project, name);
        if (filePath) addFileSection(`Character Profile: ${name}`, filePath);
      }
      sections.push(buildReferenceImagesSection(project,
        name ? { filterCharNames: [name] } : undefined));
      break;
    }

    case 'setting_image_prompt': {
      // Only needs the setting profile + reference image info
      if (name) {
        const filePath = getSettingFilePath(project, name);
        if (filePath) addFileSection(`Setting Profile: ${name}`, filePath);
      }
      sections.push(buildReferenceImagesSection(project,
        name ? { filterSettingNames: [name] } : undefined));
      break;
    }

    case 'scene_image_prompt': {
      // Scene desc + char/setting profiles + reference image paths
      if (sceneNumber !== undefined) {
        let sceneLoaded = false;
        const scene = project.scenes.find(s => s.sceneNumber === sceneNumber);
        if (scene?.file) {
          sceneLoaded = !!addFileSection(`Scene ${sceneNumber} Description`, scene.file);
        }
        if (!sceneLoaded) {
          sceneLoaded = !!addFileSection(`Scene ${sceneNumber} Description`, `plans/scenes/scene-${sceneNumber}.md`);
        }
        if (!sceneLoaded) {
          // Legacy: try old single-file format
          addFileSection(`Scenes Plan (find Scene ${sceneNumber})`, 'plans/scenes.md');
        }
      }
      // Add all character and setting profiles
      for (const char of project.characters) {
        const filePath = getCharacterFilePath(project, char.name);
        if (filePath) addFileSection(`Character: ${char.name}`, filePath);
      }
      for (const setting of project.settings) {
        const filePath = getSettingFilePath(project, setting.name);
        if (filePath) addFileSection(`Setting: ${setting.name}`, filePath);
      }
      sections.push(buildReferenceImagesSection(project));
      break;
    }

    case 'scene_video_prompt': {
      // Scene desc + profiles + reference image paths
      if (sceneNumber !== undefined) {
        let sceneLoaded = false;
        const scene = project.scenes.find(s => s.sceneNumber === sceneNumber);
        if (scene?.file) {
          sceneLoaded = !!addFileSection(`Scene ${sceneNumber} Description`, scene.file);
        }
        if (!sceneLoaded) {
          sceneLoaded = !!addFileSection(`Scene ${sceneNumber} Description`, `plans/scenes/scene-${sceneNumber}.md`);
        }
        if (!sceneLoaded) {
          addFileSection(`Scenes Plan (find Scene ${sceneNumber})`, 'plans/scenes.md');
        }
      }
      for (const char of project.characters) {
        const filePath = getCharacterFilePath(project, char.name);
        if (filePath) addFileSection(`Character: ${char.name}`, filePath);
      }
      for (const setting of project.settings) {
        const filePath = getSettingFilePath(project, setting.name);
        if (filePath) addFileSection(`Setting: ${setting.name}`, filePath);
      }
      sections.push(buildReferenceImagesSection(project));
      break;
    }

    case 'shot_image_prompt': {
      // Scene video prompt JSON + scene description + profiles + reference image paths
      if (sceneNumber !== undefined) {
        // Read the scene's motion JSON (scene_video_prompt output)
        addFileSection(
          `Scene ${sceneNumber} Video Prompt`,
          `prompts/videos/scenes/scene-${sceneNumber}.motion.json`
        );
        // Also read the scene description (with fallback chain)
        let sceneLoaded = false;
        const scene = project.scenes.find(s => s.sceneNumber === sceneNumber);
        if (scene?.file) {
          sceneLoaded = !!addFileSection(`Scene ${sceneNumber} Description`, scene.file);
        }
        if (!sceneLoaded) {
          sceneLoaded = !!addFileSection(`Scene ${sceneNumber} Description`, `plans/scenes/scene-${sceneNumber}.md`);
        }
        if (!sceneLoaded) {
          addFileSection(`Scenes Plan (find Scene ${sceneNumber})`, 'plans/scenes.md');
        }
        if (shotNumber !== undefined) {
          const continuitySection = buildShotContinuitySection(sceneNumber, shotNumber);
          if (continuitySection) {
            sections.push(continuitySection);
          }
        }
      }
      for (const char of project.characters) {
        const filePath = getCharacterFilePath(project, char.name);
        if (filePath) addFileSection(`Character: ${char.name}`, filePath);
      }
      for (const setting of project.settings) {
        const filePath = getSettingFilePath(project, setting.name);
        if (filePath) addFileSection(`Setting: ${setting.name}`, filePath);
      }
      sections.push(buildReferenceImagesSection(project));
      break;
    }

    default: {
      // For unknown content types (thesis, outline, segment, etc.), fall back to
      // reading original_input.md — the subagent can still call read_file() if needed
      addFileSection('Original Input', project.originalInputFile);
      return null; // Signal that we don't have a specialized context strategy
    }
  }

  if (sections.length <= 1) {
    // Only metadata, no actual content found
    return null;
  }

  const contextBlock = `<pre_loaded_context>
ALL context needed for this content type has been pre-loaded below.
DO NOT call read_file(). You may call read_project() if you need additional project metadata.
Generate the content using ONLY the provided context.

${sections.join('\n\n---\n\n')}
</pre_loaded_context>`;

  return { contextBlock, filesRead };
}
