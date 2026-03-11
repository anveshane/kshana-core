import { CONTENT_TYPE_OUTPUT_FILES } from '../tools/builtin/generateContentTool.js';

export interface GenerateContentPathArgs {
  contentType: string;
  instruction: string;
  name?: string;
  sceneNumber?: number;
  shotNumber?: number;
  chapterNumber?: number;
  outputFile?: string;
}

function extractOutputPathFromInstruction(instruction: string): string | undefined {
  const normalized = instruction.replace(/[`'"]/g, '');
  const match = normalized.match(
    /\b((?:plans|characters|settings|scenes|prompts|assets)\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+)\b/
  );
  return match?.[1];
}

export function resolveGenerateContentOutputFile({
  contentType,
  instruction,
  name,
  sceneNumber,
  shotNumber,
  chapterNumber,
  outputFile,
}: GenerateContentPathArgs): string {
  if (outputFile) {
    return outputFile;
  }

  const instructionPath = extractOutputPathFromInstruction(instruction);
  if (instructionPath) {
    return instructionPath;
  }

  let resolved = CONTENT_TYPE_OUTPUT_FILES[contentType] || `plans/${contentType}.md`;

  if ((contentType === 'character' || contentType === 'setting') && name) {
    const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    return `${resolved.replace(/\/$/, '')}/${safeName}.profile.md`;
  }

  if (contentType === 'story') {
    const chapter = chapterNumber ?? 1;
    return `${resolved.replace(/\/$/, '')}/chapter-${chapter}.story.md`;
  }

  if (
    (contentType === 'character_image_prompt' || contentType === 'setting_image_prompt') &&
    name
  ) {
    const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    return `${resolved.replace(/\/$/, '')}/${safeName}.prompt.md`;
  }

  if (contentType === 'scene' && sceneNumber !== undefined) {
    return `${resolved.replace(/\/$/, '')}/scene-${sceneNumber}.md`;
  }

  if (contentType === 'scene_image_prompt' && sceneNumber !== undefined) {
    return `${resolved.replace(/\/$/, '')}/scene-${sceneNumber}.prompt.md`;
  }

  if (contentType === 'scene_video_prompt' && sceneNumber !== undefined) {
    return `${resolved.replace(/\/$/, '')}/scene-${sceneNumber}.motion.json`;
  }

  if (
    contentType === 'shot_image_prompt' &&
    sceneNumber !== undefined &&
    shotNumber !== undefined
  ) {
    return `${resolved.replace(/\/$/, '')}/scene-${sceneNumber}-shot-${shotNumber}.prompt.md`;
  }

  return resolved;
}
