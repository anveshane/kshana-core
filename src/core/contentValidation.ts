export interface ParsedSceneMotionShot {
  shotNumber?: number;
  shotType?: string;
  label?: string;
  duration?: number;
  prompt?: string;
  dialogue?: string | null;
  cameraWork?: string;
}

export interface ParsedSceneMotionPrompt {
  sceneNumber?: number;
  sceneTitle?: string;
  totalSceneDuration?: number;
  shots?: ParsedSceneMotionShot[];
}

type ValidationResult =
  | { valid: true; content: string }
  | { valid: false; error: string };

function stripMarkdownFence(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json|markdown|md)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() || trimmed;
}

export function normalizeProfileName(name: string): string {
  return name
    .trim()
    .replace(/^(?:character|setting)\s+profile\s*:\s*/i, '')
    .replace(/^profile\s*:\s*/i, '')
    .replace(/^(?:character|setting)\s*:\s*/i, '')
    .trim();
}

export function extractHeadingName(content: string): string | undefined {
  const headingMatch = content.match(/^#\s*(.+)$/m);
  if (!headingMatch?.[1]) {
    return undefined;
  }
  return normalizeProfileName(headingMatch[1]);
}

export function isLikelyToolChatter(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) {
    return false;
  }

  if (/read_project\s*\(\s*\)/i.test(trimmed) || /read_file\s*\(\s*\)/i.test(trimmed)) {
    return true;
  }

  return (
    /^i need to check\b/i.test(trimmed) ||
    /^i(?:'| wi)ll check\b/i.test(trimmed) ||
    /^first,\s+use read_project/i.test(trimmed)
  );
}

export function tryParseSceneMotionPrompt(content: string): ParsedSceneMotionPrompt | null {
  const unfenced = stripMarkdownFence(content);
  try {
    const parsed = JSON.parse(unfenced) as ParsedSceneMotionPrompt;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function extractSceneTitle(content: string, sceneNumber?: number): string | undefined {
  const markdownHeading = content.match(/^#\s*(?:Scene\s*\d+[:\-–—\s]*)?(.+)$/m);
  if (markdownHeading?.[1]) {
    return markdownHeading[1].trim();
  }

  const boldHeading = content.match(/^\*\*Scene\s*\d+[:\-–—\s]*([^*\n]+)\*\*/m);
  if (boldHeading?.[1]) {
    return boldHeading[1].trim();
  }

  if (sceneNumber !== undefined) {
    const looseHeading = content.match(
      new RegExp(`^Scene\\s*${sceneNumber}[:\\-–—\\s]*(.+)$`, 'im')
    );
    if (looseHeading?.[1]) {
      return looseHeading[1].trim();
    }
  }

  return undefined;
}

export function isValidSceneContent(content: string, sceneNumber?: number): boolean {
  if (isLikelyToolChatter(content)) {
    return false;
  }

  const motionPrompt = tryParseSceneMotionPrompt(content);
  if (motionPrompt && (motionPrompt.sceneNumber !== undefined || motionPrompt.shots)) {
    return false;
  }

  if (extractSceneTitle(content, sceneNumber)) {
    return true;
  }

  const sceneStructureSignals = [
    /\bcharacters?\s+present\s*:/i,
    /\bsetting\s*:/i,
    /\baction(?:\s+description)?\s*:/i,
    /\bmood\s*:/i,
    /\bcamera\b/i,
  ];

  return sceneStructureSignals.filter(pattern => pattern.test(content)).length >= 2;
}

export function validateGeneratedSceneContent(
  content: string,
  sceneNumber?: number
): ValidationResult {
  if (!content.trim()) {
    return { valid: false, error: 'scene content is empty' };
  }

  if (isLikelyToolChatter(content)) {
    return {
      valid: false,
      error: 'scene content contains tool-chatter text instead of a scene breakdown',
    };
  }

  const motionPrompt = tryParseSceneMotionPrompt(content);
  if (motionPrompt && (motionPrompt.sceneNumber !== undefined || motionPrompt.shots)) {
    return {
      valid: false,
      error: 'scene content looks like scene_video_prompt JSON and cannot be saved as a scene',
    };
  }

  if (!isValidSceneContent(content, sceneNumber)) {
    return {
      valid: false,
      error: 'scene content is missing scene-breakdown structure and cannot be approved',
    };
  }

  return { valid: true, content: content.trim() };
}

export function validateGeneratedSceneMotionPromptContent(content: string): ValidationResult {
  if (!content.trim()) {
    return { valid: false, error: 'scene_video_prompt content is empty' };
  }

  const parsed = tryParseSceneMotionPrompt(content);
  if (!parsed) {
    return { valid: false, error: 'scene_video_prompt content is not valid JSON' };
  }

  if (!Number.isFinite(parsed.sceneNumber) || !parsed.sceneNumber || parsed.sceneNumber <= 0) {
    return { valid: false, error: 'scene_video_prompt JSON is missing a valid sceneNumber' };
  }

  const validShots =
    parsed.shots?.filter(
      shot => Number.isFinite(shot.duration) && Number(shot.duration) > 0
    ) || [];
  if (validShots.length === 0) {
    return {
      valid: false,
      error: 'scene_video_prompt JSON must contain at least one shot with a positive duration',
    };
  }

  return { valid: true, content: stripMarkdownFence(content) };
}
