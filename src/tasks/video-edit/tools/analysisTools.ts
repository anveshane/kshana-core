/**
 * Analysis tools for the video editing workflow.
 * Handles enhancement opportunity detection and frame extraction.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createTool } from '../../../core/tools/index.js';
import type { ToolDefinition } from '../../../core/llm/index.js';
import { FFmpegService } from '../../../services/ffmpeg/FFmpegService.js';
import {
  loadProject,
  saveProject,
  addAsset,
  getProjectDir,
  updatePhaseStatus,
  writeProjectFile,
} from '../workflow/ProjectManager.js';
import type {
  ScriptSegment,
  EnhancementType,
  CompositionMode,
  AssetInfo,
} from '../workflow/types.js';

// Initialize FFmpeg service
const ffmpegService = new FFmpegService();

/**
 * Enhancement opportunity detected from script analysis.
 */
export interface EnhancementOpportunity {
  /** Associated script segment ID */
  segmentId: string;
  /** Segment index */
  segmentIndex: number;
  /** Time range in milliseconds */
  timeRange: { startMs: number; endMs: number };
  /** Suggested enhancement type */
  suggestedType: EnhancementType;
  /** Suggested composition mode */
  suggestedComposition: CompositionMode;
  /** Why this is an opportunity */
  reason: string;
  /** Keywords that triggered this opportunity */
  triggerKeywords: string[];
  /** Confidence score (0-1) */
  confidence: number;
  /** Suggested prompt for AI generation */
  suggestedPrompt?: string;
}

/**
 * Keywords that suggest visual enhancement opportunities.
 */
const VISUAL_KEYWORDS: Record<string, { type: EnhancementType; composition: CompositionMode; confidence: number }> = {
  // Descriptive scenes - suggest B-roll images
  'landscape': { type: 'ai_image', composition: 'broll_cut', confidence: 0.8 },
  'scenery': { type: 'ai_image', composition: 'broll_cut', confidence: 0.8 },
  'building': { type: 'ai_image', composition: 'broll_cut', confidence: 0.7 },
  'city': { type: 'ai_image', composition: 'broll_cut', confidence: 0.7 },
  'nature': { type: 'ai_image', composition: 'broll_cut', confidence: 0.8 },
  'mountain': { type: 'ai_image', composition: 'broll_cut', confidence: 0.8 },
  'ocean': { type: 'ai_image', composition: 'broll_cut', confidence: 0.8 },
  'forest': { type: 'ai_image', composition: 'broll_cut', confidence: 0.8 },

  // Data/statistics - suggest infographics
  'percent': { type: 'motion_graphic', composition: 'pip_overlay', confidence: 0.9 },
  'percentage': { type: 'motion_graphic', composition: 'pip_overlay', confidence: 0.9 },
  'statistics': { type: 'motion_graphic', composition: 'pip_overlay', confidence: 0.9 },
  'data': { type: 'motion_graphic', composition: 'pip_overlay', confidence: 0.7 },
  'chart': { type: 'motion_graphic', composition: 'pip_overlay', confidence: 0.9 },
  'graph': { type: 'motion_graphic', composition: 'pip_overlay', confidence: 0.9 },
  'number': { type: 'motion_graphic', composition: 'lower_third', confidence: 0.6 },

  // Comparisons - suggest split screen
  'versus': { type: 'ai_image', composition: 'split_screen', confidence: 0.8 },
  'vs': { type: 'ai_image', composition: 'split_screen', confidence: 0.8 },
  'compare': { type: 'ai_image', composition: 'split_screen', confidence: 0.8 },
  'comparison': { type: 'ai_image', composition: 'split_screen', confidence: 0.8 },
  'before': { type: 'ai_image', composition: 'split_screen', confidence: 0.7 },
  'after': { type: 'ai_image', composition: 'split_screen', confidence: 0.7 },

  // Actions/demonstrations - suggest video clips
  'demo': { type: 'ai_video_clip', composition: 'broll_cut', confidence: 0.8 },
  'demonstration': { type: 'ai_video_clip', composition: 'broll_cut', confidence: 0.8 },
  'tutorial': { type: 'ai_video_clip', composition: 'broll_cut', confidence: 0.7 },
  'step': { type: 'ai_video_clip', composition: 'pip_overlay', confidence: 0.6 },
  'process': { type: 'ai_video_clip', composition: 'broll_cut', confidence: 0.7 },
  'workflow': { type: 'ai_video_clip', composition: 'broll_cut', confidence: 0.7 },

  // Names/titles - suggest lower thirds
  'introduce': { type: 'motion_graphic', composition: 'lower_third', confidence: 0.9 },
  'introducing': { type: 'motion_graphic', composition: 'lower_third', confidence: 0.9 },
  'welcome': { type: 'motion_graphic', composition: 'lower_third', confidence: 0.7 },
  'guest': { type: 'motion_graphic', composition: 'lower_third', confidence: 0.8 },
  'speaker': { type: 'motion_graphic', composition: 'lower_third', confidence: 0.8 },

  // Emotional moments - suggest music
  'emotional': { type: 'audio_music', composition: 'full_overlay', confidence: 0.7 },
  'dramatic': { type: 'audio_music', composition: 'full_overlay', confidence: 0.8 },
  'exciting': { type: 'audio_music', composition: 'full_overlay', confidence: 0.7 },
  'suspense': { type: 'audio_music', composition: 'full_overlay', confidence: 0.8 },
  'celebration': { type: 'audio_music', composition: 'full_overlay', confidence: 0.8 },

  // Sound effects
  'explosion': { type: 'audio_sfx', composition: 'full_overlay', confidence: 0.9 },
  'crash': { type: 'audio_sfx', composition: 'full_overlay', confidence: 0.8 },
  'door': { type: 'audio_sfx', composition: 'full_overlay', confidence: 0.6 },
  'phone': { type: 'audio_sfx', composition: 'full_overlay', confidence: 0.7 },
  'alarm': { type: 'audio_sfx', composition: 'full_overlay', confidence: 0.8 },
};

/**
 * Segment type patterns that suggest enhancements.
 */
const SEGMENT_TYPE_ENHANCEMENTS: Record<string, { type: EnhancementType; composition: CompositionMode; confidence: number }> = {
  'scene_heading': { type: 'ai_image', composition: 'broll_cut', confidence: 0.7 },
  'action': { type: 'ai_video_clip', composition: 'broll_cut', confidence: 0.6 },
  'transition': { type: 'motion_graphic', composition: 'full_overlay', confidence: 0.5 },
};

/**
 * identify_enhancement_opportunities tool - Analyze script to find enhancement opportunities.
 */
export const identifyEnhancementOpportunitiesTool: ToolDefinition = createTool(
  'identify_enhancement_opportunities',
  `Analyze the parsed script to identify opportunities for visual and audio enhancements.

This tool scans the script segments for:
- Keywords suggesting visual content (landscapes, data, comparisons)
- Segment types that benefit from enhancements (scene headings, action)
- Patterns indicating good placement for graphics or music

Returns a list of enhancement opportunities with suggested types, compositions, and prompts.`,
  {
    type: 'object',
    properties: {
      min_confidence: {
        type: 'number',
        description: 'Minimum confidence threshold (0-1, default: 0.5)',
      },
      max_opportunities: {
        type: 'number',
        description: 'Maximum number of opportunities to return (default: 20)',
      },
      enhancement_types: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['ai_image', 'ai_video_clip', 'motion_graphic', 'audio_music', 'audio_sfx'],
        },
        description: 'Filter to specific enhancement types (default: all)',
      },
    },
    required: [],
  },
  async (args) => {
    const minConfidence = (args.min_confidence as number) || 0.5;
    const maxOpportunities = (args.max_opportunities as number) || 20;
    const typeFilter = args.enhancement_types as EnhancementType[] | undefined;

    const project = loadProject();
    if (!project) {
      return { success: false, error: 'No project found.' };
    }

    if (!project.script.segments || project.script.segments.length === 0) {
      return { success: false, error: 'No script segments found. Run parse_script first.' };
    }

    const segments = project.script.segments;
    const opportunities: EnhancementOpportunity[] = [];

    // Analyze each segment
    for (const segment of segments) {
      const segmentOpportunities = analyzeSegment(segment);

      // Filter by confidence
      const filtered = segmentOpportunities.filter(op => op.confidence >= minConfidence);

      // Filter by type if specified
      const typeFiltered = typeFilter
        ? filtered.filter(op => typeFilter.includes(op.suggestedType))
        : filtered;

      opportunities.push(...typeFiltered);
    }

    // Sort by confidence and limit
    opportunities.sort((a, b) => b.confidence - a.confidence);
    const limited = opportunities.slice(0, maxOpportunities);

    // Group by type for summary
    const byType: Record<string, number> = {};
    for (const op of limited) {
      byType[op.suggestedType] = (byType[op.suggestedType] || 0) + 1;
    }

    // Save opportunities to file
    const analysisPath = path.join('plans', 'analysis.md');
    const analysisContent = generateAnalysisMarkdown(limited, segments.length);
    writeProjectFile(analysisPath, analysisContent);

    return {
      success: true,
      totalSegments: segments.length,
      opportunitiesFound: limited.length,
      byType,
      opportunities: limited.map(op => ({
        segmentIndex: op.segmentIndex,
        timeRange: op.timeRange,
        type: op.suggestedType,
        composition: op.suggestedComposition,
        reason: op.reason,
        confidence: op.confidence,
        suggestedPrompt: op.suggestedPrompt,
      })),
    };
  }
);

/**
 * Analyze a single segment for enhancement opportunities.
 */
function analyzeSegment(segment: ScriptSegment): EnhancementOpportunity[] {
  const opportunities: EnhancementOpportunity[] = [];
  const text = segment.text.toLowerCase();
  const words = text.split(/\s+/);

  // Check for keyword matches
  const foundKeywords: string[] = [];
  let bestMatch: { type: EnhancementType; composition: CompositionMode; confidence: number } | null = null;

  for (const word of words) {
    const cleanWord = word.replace(/[^a-z]/g, '');
    if (VISUAL_KEYWORDS[cleanWord]) {
      foundKeywords.push(cleanWord);
      const match = VISUAL_KEYWORDS[cleanWord];
      if (!bestMatch || (match && match.confidence > bestMatch.confidence)) {
        bestMatch = match;
      }
    }
  }

  // Add keyword-based opportunity
  if (bestMatch && foundKeywords.length > 0) {
    opportunities.push({
      segmentId: segment.id,
      segmentIndex: segment.index,
      timeRange: segment.timeRange || { startMs: 0, endMs: 0 },
      suggestedType: bestMatch.type,
      suggestedComposition: bestMatch.composition,
      reason: `Contains keywords: ${foundKeywords.join(', ')}`,
      triggerKeywords: foundKeywords,
      confidence: bestMatch.confidence,
      suggestedPrompt: generatePromptFromSegment(segment, bestMatch.type),
    });
  }

  // Check segment type
  const typeMatch = SEGMENT_TYPE_ENHANCEMENTS[segment.type];
  if (typeMatch) {
    // Only add if not already covered by keyword match
    const alreadyCovered = opportunities.some(op => op.suggestedType === typeMatch.type);
    if (!alreadyCovered) {
      opportunities.push({
        segmentId: segment.id,
        segmentIndex: segment.index,
        timeRange: segment.timeRange || { startMs: 0, endMs: 0 },
        suggestedType: typeMatch.type,
        suggestedComposition: typeMatch.composition,
        reason: `Segment type "${segment.type}" suggests enhancement`,
        triggerKeywords: [],
        confidence: typeMatch.confidence,
        suggestedPrompt: generatePromptFromSegment(segment, typeMatch.type),
      });
    }
  }

  // Check for segment keywords if available
  if (segment.keywords && segment.keywords.length > 0) {
    const keywordMatches: string[] = [];
    let keywordBestMatch: { type: EnhancementType; composition: CompositionMode; confidence: number } | null = null;

    for (const keyword of segment.keywords) {
      const cleanKeyword = keyword.toLowerCase();
      if (VISUAL_KEYWORDS[cleanKeyword]) {
        keywordMatches.push(cleanKeyword);
        const match = VISUAL_KEYWORDS[cleanKeyword];
        if (!keywordBestMatch || (match && match.confidence > keywordBestMatch.confidence)) {
          keywordBestMatch = match;
        }
      }
    }

    if (keywordBestMatch && keywordMatches.length > 0) {
      // Only add if not already covered
      const alreadyCovered = opportunities.some(
        op => op.suggestedType === keywordBestMatch!.type && op.triggerKeywords.some(k => keywordMatches.includes(k))
      );
      if (!alreadyCovered) {
        opportunities.push({
          segmentId: segment.id,
          segmentIndex: segment.index,
          timeRange: segment.timeRange || { startMs: 0, endMs: 0 },
          suggestedType: keywordBestMatch.type,
          suggestedComposition: keywordBestMatch.composition,
          reason: `Extracted keywords: ${keywordMatches.join(', ')}`,
          triggerKeywords: keywordMatches,
          confidence: keywordBestMatch.confidence * 0.9, // Slightly lower for extracted keywords
          suggestedPrompt: generatePromptFromSegment(segment, keywordBestMatch.type),
        });
      }
    }
  }

  return opportunities;
}

/**
 * Generate an AI prompt from a segment.
 */
function generatePromptFromSegment(segment: ScriptSegment, type: EnhancementType): string {
  const text = segment.text;

  // Extract key phrases (simple approach)
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const firstSentence = sentences[0]?.trim() || text.substring(0, 100);

  switch (type) {
    case 'ai_image':
      return `Create a high-quality image depicting: ${firstSentence}. Professional photography style, cinematic lighting.`;

    case 'ai_video_clip':
      return `Generate a short video clip showing: ${firstSentence}. Smooth motion, professional quality.`;

    case 'motion_graphic':
      // For motion graphics, extract any numbers or key terms
      const numbers = text.match(/\d+(\.\d+)?%?/g);
      if (numbers && numbers.length > 0) {
        return `Create an animated infographic displaying: ${numbers.join(', ')} - ${firstSentence}`;
      }
      return `Create a lower third text overlay for: ${firstSentence}`;

    case 'audio_music':
      // Determine mood from keywords
      const mood = determineMood(text);
      return `Background music: ${mood} mood, professional quality`;

    case 'audio_sfx':
      return `Sound effect for: ${firstSentence}`;

    default:
      return firstSentence;
  }
}

/**
 * Determine the mood from text for music generation.
 */
function determineMood(text: string): string {
  const lowerText = text.toLowerCase();

  if (lowerText.includes('happy') || lowerText.includes('celebration') || lowerText.includes('success')) {
    return 'upbeat, celebratory';
  }
  if (lowerText.includes('sad') || lowerText.includes('tragic') || lowerText.includes('loss')) {
    return 'melancholic, emotional';
  }
  if (lowerText.includes('suspense') || lowerText.includes('tension') || lowerText.includes('danger')) {
    return 'tense, suspenseful';
  }
  if (lowerText.includes('action') || lowerText.includes('exciting') || lowerText.includes('adventure')) {
    return 'energetic, adventurous';
  }
  if (lowerText.includes('calm') || lowerText.includes('peaceful') || lowerText.includes('nature')) {
    return 'calm, ambient';
  }

  return 'neutral, professional';
}

/**
 * Generate analysis markdown document.
 */
function generateAnalysisMarkdown(opportunities: EnhancementOpportunity[], totalSegments: number): string {
  let md = `# Script Analysis Results\n\n`;
  md += `**Total Segments Analyzed:** ${totalSegments}\n`;
  md += `**Enhancement Opportunities Found:** ${opportunities.length}\n\n`;

  // Group by type
  const byType: Record<string, EnhancementOpportunity[]> = {};
  for (const op of opportunities) {
    if (!byType[op.suggestedType]) {
      byType[op.suggestedType] = [];
    }
    byType[op.suggestedType].push(op);
  }

  md += `## Summary by Type\n\n`;
  for (const [type, ops] of Object.entries(byType)) {
    md += `- **${type}**: ${ops.length} opportunities\n`;
  }

  md += `\n## Detailed Opportunities\n\n`;
  for (const op of opportunities) {
    md += `### Segment ${op.segmentIndex} - ${op.suggestedType}\n`;
    md += `- **Confidence:** ${(op.confidence * 100).toFixed(0)}%\n`;
    md += `- **Composition:** ${op.suggestedComposition}\n`;
    md += `- **Reason:** ${op.reason}\n`;
    if (op.suggestedPrompt) {
      md += `- **Suggested Prompt:** ${op.suggestedPrompt}\n`;
    }
    md += `\n`;
  }

  return md;
}

/**
 * extract_frame tool - Extract a single frame from the video at a specific timecode.
 */
export const extractFrameTool: ToolDefinition = createTool(
  'extract_frame',
  `Extract a single frame from the source video at a specific timecode.

Useful for:
- Visual analysis of specific moments
- Reference for AI image generation
- Thumbnail creation

Returns the path to the extracted frame image.`,
  {
    type: 'object',
    properties: {
      time: {
        type: 'string',
        description: 'Timecode to extract frame at (MM:SS or HH:MM:SS format)',
      },
      time_ms: {
        type: 'number',
        description: 'Alternative: time in milliseconds',
      },
      output_name: {
        type: 'string',
        description: 'Optional: custom output filename (without extension)',
      },
    },
    required: [],
  },
  async (args) => {
    const timeStr = args.time as string | undefined;
    const timeMs = args.time_ms as number | undefined;
    const outputName = args.output_name as string | undefined;

    const project = loadProject();
    if (!project) {
      return { success: false, error: 'No project found.' };
    }

    if (!project.source.path) {
      return { success: false, error: 'No source video found. Import a video first.' };
    }

    // Determine timestamp in milliseconds
    let timestampMs: number;
    if (timeMs !== undefined) {
      timestampMs = timeMs;
    } else if (timeStr) {
      timestampMs = parseTimeToMs(timeStr);
    } else {
      return { success: false, error: 'Either time or time_ms is required' };
    }

    // Validate against video duration
    if (project.source.metadata) {
      if (timestampMs > project.source.metadata.durationMs) {
        return {
          success: false,
          error: `Timestamp exceeds video duration (${formatMsToTime(project.source.metadata.durationMs)})`,
        };
      }
    }

    const projectDir = getProjectDir();
    const framesDir = path.join(projectDir, 'assets', 'frames');

    // Ensure frames directory exists
    if (!fs.existsSync(framesDir)) {
      fs.mkdirSync(framesDir, { recursive: true });
    }

    // Generate output path
    const filename = outputName || `frame_${timestampMs}`;
    const outputPath = path.join(framesDir, `${filename}.jpg`);

    try {
      // Extract frame using FFmpeg service
      await ffmpegService.extractFrame(project.source.path, timestampMs, outputPath);

      // Register as asset
      const asset: AssetInfo = {
        id: `asset_frame_${Date.now()}`,
        type: 'thumbnail',
        path: path.relative(projectDir, outputPath),
        createdAt: Date.now(),
        metadata: {
          sourceTimestampMs: timestampMs,
        },
      };
      addAsset(project, asset);

      return {
        success: true,
        framePath: path.relative(projectDir, outputPath),
        absolutePath: outputPath,
        timestampMs,
        timestampFormatted: formatMsToTime(timestampMs),
        assetId: asset.id,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Failed to extract frame: ${errorMessage}` };
    }
  }
);

/**
 * complete_analysis tool - Mark the analysis phase as complete.
 */
export const completeAnalysisTool: ToolDefinition = createTool(
  'complete_analysis',
  `Mark the analysis phase as complete after identifying enhancement opportunities.

This transitions the project to the ENHANCEMENT_PLAN phase.`,
  {
    type: 'object',
    properties: {},
    required: [],
  },
  async () => {
    const project = loadProject();
    if (!project) {
      return { success: false, error: 'No project found.' };
    }

    // Mark phase as complete
    updatePhaseStatus(project, 'analysis', 'completed');

    return {
      success: true,
      message: 'Analysis phase completed. Ready for enhancement planning.',
      nextPhase: 'enhancement_plan',
    };
  }
);

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse time string (MM:SS or HH:MM:SS) to milliseconds.
 */
function parseTimeToMs(timeStr: string): number {
  const parts = timeStr.split(':').map(Number);

  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return ((minutes ?? 0) * 60 + (seconds ?? 0)) * 1000;
  } else if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return ((hours ?? 0) * 3600 + (minutes ?? 0) * 60 + (seconds ?? 0)) * 1000;
  }

  throw new Error(`Invalid time format: ${timeStr}. Use MM:SS or HH:MM:SS`);
}

/**
 * Format milliseconds to time string.
 */
function formatMsToTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// ============================================================================
// Export all analysis tools
// ============================================================================

export const analysisTools: ToolDefinition[] = [
  identifyEnhancementOpportunitiesTool,
  extractFrameTool,
  completeAnalysisTool,
];
