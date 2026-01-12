#!/usr/bin/env tsx
/**
 * Manual test script for the video editing workflow.
 *
 * This script demonstrates the video editing tools and workflow
 * without requiring an actual video file or AI services.
 *
 * Run with: pnpm tsx scripts/test-video-edit.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Import workflow components
import {
  createProject,
  loadProject,
  deleteProject,
  setSourceVideo,
  updateSourceMetadata,
  setScript,
  setScriptSegments,
  addEnhancement,
  updateEnhancementApproval,
  getPendingEnhancements,
  getApprovedEnhancements,
  updatePhaseStatus,
  transitionToNextPhase,
  getProjectSummary,
  getStateTransitionPrompt,
} from '../src/tasks/video-edit/workflow/ProjectManager.js';

import { ScriptParser } from '../src/services/script-parser/ScriptParser.js';

import {
  EditWorkflowPhase,
  type VideoMetadata,
  type EnhancementSuggestion,
} from '../src/tasks/video-edit/workflow/types.js';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

function log(message: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function section(title: string) {
  console.log('');
  log(`${'═'.repeat(60)}`, 'cyan');
  log(`  ${title}`, 'bold');
  log(`${'═'.repeat(60)}`, 'cyan');
}

function subsection(title: string) {
  console.log('');
  log(`── ${title} ──`, 'yellow');
}

async function main() {
  // Create temp directory for test
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-edit-demo-'));
  log(`\nTest directory: ${testDir}`, 'dim');

  try {
    // =========================================================================
    section('1. Create Project');
    // =========================================================================

    const project = createProject('My Demo Video Enhancement', testDir);
    log(`Project created: ${project.id}`, 'green');
    log(`Title: ${project.title}`);
    log(`Version: ${project.version}`);
    log(`Current Phase: ${project.currentPhase}`);

    // =========================================================================
    section('2. Simulate Video Import (INGEST Phase)');
    // =========================================================================

    subsection('Setting source video');
    setSourceVideo(project, 'local_file', '/fake/path/to/video.mp4', undefined, testDir);
    log('Source video set', 'green');

    subsection('Setting metadata');
    const fakeMetadata: VideoMetadata = {
      durationMs: 300000, // 5 minutes
      width: 1920,
      height: 1080,
      fps: 30,
      codec: 'h264',
      bitrate: 8000,
      fileSize: 150000000,
      format: 'mp4',
      audioTracks: [
        { index: 0, codec: 'aac', channels: 2, sampleRate: 48000 },
      ],
    };
    updateSourceMetadata(project, fakeMetadata, testDir);
    log('Metadata updated', 'green');
    log(`  Duration: ${fakeMetadata.durationMs / 1000}s`);
    log(`  Resolution: ${fakeMetadata.width}x${fakeMetadata.height}`);
    log(`  FPS: ${fakeMetadata.fps}`);

    subsection('Completing INGEST phase');
    updatePhaseStatus(project, 'ingest', 'completed', testDir);
    transitionToNextPhase(project, testDir);
    log(`Transitioned to: ${loadProject(testDir)?.currentPhase}`, 'green');

    // =========================================================================
    section('3. Parse Script (SCRIPT_PARSE Phase)');
    // =========================================================================

    const sampleScript = `
1
00:00:00,000 --> 00:00:15,000
Welcome to our comprehensive guide on mountain landscape photography.
Today we'll explore the beautiful terrain of the Swiss Alps.

2
00:00:15,500 --> 00:00:35,000
Statistics show that 78% of professional photographers prefer
shooting during golden hour for optimal lighting conditions.

3
00:00:35,500 --> 00:00:55,000
Let me introduce our guest expert, John Smith, who has been
photographing mountains for over 20 years.

4
00:00:55,500 --> 00:01:15,000
The comparison between morning and evening light is dramatic.
On the left, you can see the cool tones. On the right, warm sunset colors.

5
00:01:15,500 --> 00:01:35,000
This concludes our tutorial. We hope you found this information helpful!
`;

    subsection('Detecting script format');
    const parser = new ScriptParser();
    const formatResult = parser.detectFormat(sampleScript);
    log(`Detected format: ${formatResult.format}`, 'green');
    log(`Confidence: ${(formatResult.confidence * 100).toFixed(0)}%`);

    subsection('Parsing script');
    const segments = parser.parse(sampleScript);
    setScript(project, sampleScript, formatResult.format, undefined, testDir);
    setScriptSegments(project, segments, testDir);
    log(`Parsed ${segments.length} segments`, 'green');

    segments.forEach((seg, i) => {
      const time = seg.timeRange
        ? `${formatTime(seg.timeRange.startMs)} - ${formatTime(seg.timeRange.endMs)}`
        : 'no time';
      log(`  ${i + 1}. [${time}] ${seg.text.substring(0, 50)}...`, 'dim');
    });

    subsection('Completing SCRIPT_PARSE phase');
    updatePhaseStatus(project, 'script_parse', 'completed', testDir);
    transitionToNextPhase(project, testDir);
    log(`Transitioned to: ${loadProject(testDir)?.currentPhase}`, 'green');

    // =========================================================================
    section('4. Analyze Script (ANALYSIS Phase)');
    // =========================================================================

    subsection('Identifying enhancement opportunities');
    // In real usage, this would be done by the identify_enhancement_opportunities tool
    // Here we simulate the results

    const opportunities = [
      {
        segment: 0,
        type: 'ai_image',
        reason: 'Landscape description',
        keywords: ['mountain', 'landscape'],
        confidence: 0.9,
      },
      {
        segment: 1,
        type: 'motion_graphic',
        reason: 'Statistics/percentage',
        keywords: ['statistics', 'percent'],
        confidence: 0.95,
      },
      {
        segment: 2,
        type: 'motion_graphic',
        reason: 'Guest introduction',
        keywords: ['introduce', 'guest'],
        confidence: 0.9,
      },
      {
        segment: 3,
        type: 'ai_image',
        reason: 'Comparison opportunity',
        keywords: ['comparison', 'left', 'right'],
        confidence: 0.85,
      },
    ];

    log(`Found ${opportunities.length} enhancement opportunities:`, 'green');
    opportunities.forEach(opp => {
      log(`  • Segment ${opp.segment + 1}: ${opp.type} (${(opp.confidence * 100).toFixed(0)}%)`, 'dim');
      log(`    Reason: ${opp.reason}`, 'dim');
    });

    subsection('Completing ANALYSIS phase');
    updatePhaseStatus(project, 'analysis', 'completed', testDir);
    transitionToNextPhase(project, testDir);
    log(`Transitioned to: ${loadProject(testDir)?.currentPhase}`, 'green');

    // =========================================================================
    section('5. Enhancement Planning (ENHANCEMENT_PLAN Phase)');
    // =========================================================================

    subsection('Creating enhancement suggestions');

    const enhancements: EnhancementSuggestion[] = [
      {
        id: 'enh_1',
        type: 'ai_image',
        compositionMode: 'broll_cut',
        timeRange: { startMs: 0, endMs: 15000 },
        source: 'ai_suggested',
        confidence: 0.9,
        description: 'Swiss Alps mountain landscape establishing shot',
        prompt: 'Majestic Swiss Alps mountain range, snow-capped peaks, dramatic clouds, golden hour lighting, cinematic photography, 8k',
        scriptSegmentId: segments[0]?.id,
        approvalStatus: 'pending',
        regenerationCount: 0,
      },
      {
        id: 'enh_2',
        type: 'motion_graphic',
        compositionMode: 'pip_overlay',
        timeRange: { startMs: 15500, endMs: 35000 },
        source: 'ai_suggested',
        confidence: 0.95,
        description: 'Animated statistics: 78% of photographers prefer golden hour',
        prompt: 'Animated infographic showing 78% statistic with camera icon',
        scriptSegmentId: segments[1]?.id,
        approvalStatus: 'pending',
        regenerationCount: 0,
      },
      {
        id: 'enh_3',
        type: 'motion_graphic',
        compositionMode: 'lower_third',
        timeRange: { startMs: 35500, endMs: 55000 },
        source: 'ai_suggested',
        confidence: 0.9,
        description: 'Lower third: John Smith - Mountain Photography Expert',
        prompt: 'Professional lower third text animation',
        scriptSegmentId: segments[2]?.id,
        approvalStatus: 'pending',
        regenerationCount: 0,
      },
      {
        id: 'enh_4',
        type: 'ai_image',
        compositionMode: 'split_screen',
        timeRange: { startMs: 55500, endMs: 75000 },
        source: 'ai_suggested',
        confidence: 0.85,
        description: 'Split-screen comparison: morning vs evening mountain light',
        prompt: 'Split screen comparison, left side cool blue morning light on mountains, right side warm golden sunset on same mountain',
        scriptSegmentId: segments[3]?.id,
        approvalStatus: 'pending',
        regenerationCount: 0,
      },
    ];

    for (const enh of enhancements) {
      addEnhancement(project, enh, testDir);
    }
    log(`Created ${enhancements.length} enhancement suggestions`, 'green');

    subsection('Simulating approval workflow');

    // Approve first three, reject fourth
    log('\n  Reviewing Enhancement 1: Mountain landscape B-roll', 'cyan');
    updateEnhancementApproval(project, 'enh_1', 'approved', undefined, testDir);
    log('    → Approved ✓', 'green');

    log('\n  Reviewing Enhancement 2: Statistics infographic', 'cyan');
    updateEnhancementApproval(project, 'enh_2', 'approved', undefined, testDir);
    log('    → Approved ✓', 'green');

    log('\n  Reviewing Enhancement 3: Guest lower third', 'cyan');
    updateEnhancementApproval(project, 'enh_3', 'approved', undefined, testDir);
    log('    → Approved ✓', 'green');

    log('\n  Reviewing Enhancement 4: Split-screen comparison', 'cyan');
    updateEnhancementApproval(project, 'enh_4', 'rejected', 'Too complex for this video', testDir);
    log('    → Rejected ✗ (Too complex for this video)', 'yellow');

    const pending = getPendingEnhancements(loadProject(testDir)!);
    const approved = getApprovedEnhancements(loadProject(testDir)!);
    log(`\nApproval complete: ${approved.length} approved, ${pending.length} pending`, 'green');

    // =========================================================================
    section('6. Project Summary');
    // =========================================================================

    const summary = getProjectSummary(testDir);
    log(summary);

    console.log('');
    log('State Transition Prompt:', 'yellow');
    log('─'.repeat(40), 'dim');
    const prompt = getStateTransitionPrompt(testDir);
    log(prompt, 'dim');

    // =========================================================================
    section('Test Complete!');
    // =========================================================================

    log('\nAll video editing workflow components tested successfully.', 'green');
    log('\nNext steps to continue testing:', 'cyan');
    log('  1. Run unit tests: pnpm test tests/video-edit/', 'dim');
    log('  2. Test with real video: Use the ingest tools with an actual MP4', 'dim');
    log('  3. Test FFmpeg: Ensure ffmpeg is installed and extractMetadata works', 'dim');

  } finally {
    // Cleanup
    deleteProject(testDir);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    log(`\nCleaned up test directory`, 'dim');
  }
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Run the test
main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
