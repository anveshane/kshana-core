/**
 * Tests for video-edit tools.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  ingestTools,
  scriptTools,
  analysisTools,
  enhancementTools,
  allVideoEditTools,
  getToolsForPhase,
} from '../../src/tasks/video-edit/tools/index.js';
import { createProject, loadProject, setScript, setScriptSegments, addEnhancement } from '../../src/tasks/video-edit/workflow/ProjectManager.js';
import type { ScriptSegment, EnhancementSuggestion } from '../../src/tasks/video-edit/workflow/types.js';

describe('Video Edit Tools', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-edit-tools-test-'));
    originalCwd = process.cwd();
    process.chdir(testDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    // Clean up temp directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Tool Registration', () => {
    it('should have ingest tools', () => {
      expect(ingestTools).toHaveLength(4);
      const toolNames = ingestTools.map(t => t.name);
      expect(toolNames).toContain('import_video');
      expect(toolNames).toContain('extract_metadata');
      expect(toolNames).toContain('generate_thumbnails');
      expect(toolNames).toContain('complete_ingest');
    });

    it('should have script tools', () => {
      expect(scriptTools).toHaveLength(6);
      const toolNames = scriptTools.map(t => t.name);
      expect(toolNames).toContain('detect_script_format');
      expect(toolNames).toContain('parse_script');
      expect(toolNames).toContain('transcribe_video');
      expect(toolNames).toContain('align_script_to_video');
      expect(toolNames).toContain('add_user_hint');
      expect(toolNames).toContain('complete_script_parse');
    });

    it('should have analysis tools', () => {
      expect(analysisTools).toHaveLength(3);
      const toolNames = analysisTools.map(t => t.name);
      expect(toolNames).toContain('identify_enhancement_opportunities');
      expect(toolNames).toContain('extract_frame');
      expect(toolNames).toContain('complete_analysis');
    });

    it('should have enhancement tools', () => {
      expect(enhancementTools).toHaveLength(7);
      const toolNames = enhancementTools.map(t => t.name);
      expect(toolNames).toContain('suggest_enhancement');
      expect(toolNames).toContain('approve_enhancement');
      expect(toolNames).toContain('reject_enhancement');
      expect(toolNames).toContain('regenerate_enhancement');
      expect(toolNames).toContain('list_enhancements');
      expect(toolNames).toContain('get_next_pending_enhancement');
      expect(toolNames).toContain('complete_enhancement_plan');
    });

    it('should combine all tools', () => {
      const expectedTotal = ingestTools.length + scriptTools.length + analysisTools.length + enhancementTools.length;
      expect(allVideoEditTools).toHaveLength(expectedTotal);
    });
  });

  describe('getToolsForPhase', () => {
    it('should return ingest tools for ingest phase', () => {
      const tools = getToolsForPhase('ingest');
      expect(tools).toEqual(ingestTools);
    });

    it('should return script tools for script_parse phase', () => {
      const tools = getToolsForPhase('script_parse');
      expect(tools).toEqual(scriptTools);
    });

    it('should return analysis tools for analysis phase', () => {
      const tools = getToolsForPhase('analysis');
      expect(tools).toEqual(analysisTools);
    });

    it('should return enhancement tools for enhancement_plan phase', () => {
      const tools = getToolsForPhase('enhancement_plan');
      expect(tools).toEqual(enhancementTools);
    });

    it('should return empty array for unknown phase', () => {
      const tools = getToolsForPhase('unknown_phase');
      expect(tools).toEqual([]);
    });
  });

  describe('Tool Handlers', () => {
    describe('detect_script_format', () => {
      it('should detect SRT format', async () => {
        const tool = scriptTools.find(t => t.name === 'detect_script_format');
        expect(tool?.handler).toBeDefined();

        const srtContent = `1
00:00:01,000 --> 00:00:04,000
Hello world.`;

        const result = await tool!.handler!({ content: srtContent });

        expect(result).toHaveProperty('success', true);
        expect(result).toHaveProperty('format', 'srt');
      });

      it('should detect VTT format', async () => {
        const tool = scriptTools.find(t => t.name === 'detect_script_format');

        const vttContent = `WEBVTT

00:00:01.000 --> 00:00:04.000
Hello world.`;

        const result = await tool!.handler!({ content: vttContent });

        expect(result).toHaveProperty('success', true);
        expect(result).toHaveProperty('format', 'vtt');
      });
    });

    describe('parse_script', () => {
      it('should parse script and store in project', async () => {
        createProject('Test Project', testDir);
        const tool = scriptTools.find(t => t.name === 'parse_script');

        const srtContent = `1
00:00:01,000 --> 00:00:04,000
First line.

2
00:00:04,500 --> 00:00:08,000
Second line.`;

        const result = await tool!.handler!({ content: srtContent });

        expect(result).toHaveProperty('success', true);
        expect(result).toHaveProperty('segmentCount', 2);

        const project = loadProject(testDir);
        expect(project?.script.segments).toHaveLength(2);
      });

      it('should fail without project', async () => {
        const tool = scriptTools.find(t => t.name === 'parse_script');

        const result = await tool!.handler!({ content: 'test' });

        expect(result).toHaveProperty('success', false);
        expect(result).toHaveProperty('error');
      });
    });

    describe('identify_enhancement_opportunities', () => {
      it('should identify opportunities from script', async () => {
        const project = createProject('Test Project', testDir);
        const segments: ScriptSegment[] = [
          {
            id: '1',
            index: 0,
            text: 'The beautiful mountain landscape stretches before us.',
            type: 'narration',
            timeRange: { startMs: 0, endMs: 5000 },
          },
          {
            id: '2',
            index: 1,
            text: 'Statistics show 75% increase in performance.',
            type: 'narration',
            timeRange: { startMs: 5000, endMs: 10000 },
          },
        ];
        setScriptSegments(project, segments, testDir);

        const tool = analysisTools.find(t => t.name === 'identify_enhancement_opportunities');
        const result = await tool!.handler!({});

        expect(result).toHaveProperty('success', true);
        expect(result).toHaveProperty('opportunitiesFound');
        expect((result as { opportunitiesFound: number }).opportunitiesFound).toBeGreaterThan(0);
      });

      it('should fail without script segments', async () => {
        createProject('Test Project', testDir);

        const tool = analysisTools.find(t => t.name === 'identify_enhancement_opportunities');
        const result = await tool!.handler!({});

        expect(result).toHaveProperty('success', false);
      });
    });

    describe('suggest_enhancement', () => {
      it('should create enhancement suggestion', async () => {
        createProject('Test Project', testDir);

        const tool = enhancementTools.find(t => t.name === 'suggest_enhancement');
        const result = await tool!.handler!({
          start_time: '00:00',
          end_time: '00:30',
          type: 'ai_image',
          composition_mode: 'broll_cut',
          description: 'A beautiful landscape shot',
          prompt: 'Mountain landscape, cinematic',
        });

        expect(result).toHaveProperty('success', true);
        expect(result).toHaveProperty('enhancementId');
        expect(result).toHaveProperty('type', 'ai_image');

        const project = loadProject(testDir);
        expect(project?.enhancements).toHaveLength(1);
      });
    });

    describe('approve_enhancement', () => {
      it('should approve pending enhancement', async () => {
        const project = createProject('Test Project', testDir);
        const enhancement: EnhancementSuggestion = {
          id: 'enh_test',
          type: 'ai_image',
          compositionMode: 'broll_cut',
          timeRange: { startMs: 0, endMs: 5000 },
          source: 'ai_suggested',
          confidence: 0.8,
          description: 'Test',
          approvalStatus: 'pending',
          regenerationCount: 0,
        };
        addEnhancement(project, enhancement, testDir);

        const tool = enhancementTools.find(t => t.name === 'approve_enhancement');
        const result = await tool!.handler!({ enhancement_id: 'enh_test' });

        expect(result).toHaveProperty('success', true);
        expect(result).toHaveProperty('status', 'approved');

        const updated = loadProject(testDir);
        expect(updated?.enhancements[0].approvalStatus).toBe('approved');
      });
    });

    describe('reject_enhancement', () => {
      it('should reject enhancement with feedback', async () => {
        const project = createProject('Test Project', testDir);
        const enhancement: EnhancementSuggestion = {
          id: 'enh_test',
          type: 'ai_image',
          compositionMode: 'broll_cut',
          timeRange: { startMs: 0, endMs: 5000 },
          source: 'ai_suggested',
          confidence: 0.8,
          description: 'Test',
          approvalStatus: 'pending',
          regenerationCount: 0,
        };
        addEnhancement(project, enhancement, testDir);

        const tool = enhancementTools.find(t => t.name === 'reject_enhancement');
        const result = await tool!.handler!({
          enhancement_id: 'enh_test',
          feedback: 'Not relevant to the content',
        });

        expect(result).toHaveProperty('success', true);
        expect(result).toHaveProperty('status', 'rejected');

        const updated = loadProject(testDir);
        expect(updated?.enhancements[0].approvalStatus).toBe('rejected');
        expect(updated?.enhancements[0].feedback).toBe('Not relevant to the content');
      });
    });

    describe('list_enhancements', () => {
      it('should list all enhancements', async () => {
        const project = createProject('Test Project', testDir);
        addEnhancement(project, {
          id: 'enh_1',
          type: 'ai_image',
          compositionMode: 'broll_cut',
          timeRange: { startMs: 0, endMs: 5000 },
          source: 'ai_suggested',
          confidence: 0.8,
          description: 'First',
          approvalStatus: 'pending',
          regenerationCount: 0,
        }, testDir);
        addEnhancement(project, {
          id: 'enh_2',
          type: 'motion_graphic',
          compositionMode: 'lower_third',
          timeRange: { startMs: 5000, endMs: 10000 },
          source: 'ai_suggested',
          confidence: 0.7,
          description: 'Second',
          approvalStatus: 'approved',
          regenerationCount: 0,
        }, testDir);

        const tool = enhancementTools.find(t => t.name === 'list_enhancements');
        const result = await tool!.handler!({});

        expect(result).toHaveProperty('success', true);
        expect(result).toHaveProperty('total', 2);
        expect((result as { enhancements: unknown[] }).enhancements).toHaveLength(2);
      });

      it('should filter by status', async () => {
        const project = createProject('Test Project', testDir);
        addEnhancement(project, {
          id: 'enh_1',
          type: 'ai_image',
          compositionMode: 'broll_cut',
          timeRange: { startMs: 0, endMs: 5000 },
          source: 'ai_suggested',
          confidence: 0.8,
          description: 'Pending one',
          approvalStatus: 'pending',
          regenerationCount: 0,
        }, testDir);
        addEnhancement(project, {
          id: 'enh_2',
          type: 'ai_image',
          compositionMode: 'broll_cut',
          timeRange: { startMs: 5000, endMs: 10000 },
          source: 'ai_suggested',
          confidence: 0.8,
          description: 'Approved one',
          approvalStatus: 'approved',
          regenerationCount: 0,
        }, testDir);

        const tool = enhancementTools.find(t => t.name === 'list_enhancements');
        const result = await tool!.handler!({ status_filter: 'pending' });

        expect(result).toHaveProperty('success', true);
        expect(result).toHaveProperty('filtered', 1);
      });
    });

    describe('get_next_pending_enhancement', () => {
      it('should get next pending item', async () => {
        const project = createProject('Test Project', testDir);
        addEnhancement(project, {
          id: 'enh_1',
          type: 'ai_image',
          compositionMode: 'broll_cut',
          timeRange: { startMs: 0, endMs: 5000 },
          source: 'ai_suggested',
          confidence: 0.8,
          description: 'First pending',
          approvalStatus: 'pending',
          regenerationCount: 0,
        }, testDir);

        const tool = enhancementTools.find(t => t.name === 'get_next_pending_enhancement');
        const result = await tool!.handler!({});

        expect(result).toHaveProperty('success', true);
        expect(result).toHaveProperty('hasMorePending', true);
        expect(result).toHaveProperty('enhancement');
        expect((result as { enhancement: { id: string } }).enhancement.id).toBe('enh_1');
      });

      it('should indicate when no pending items', async () => {
        createProject('Test Project', testDir);

        const tool = enhancementTools.find(t => t.name === 'get_next_pending_enhancement');
        const result = await tool!.handler!({});

        expect(result).toHaveProperty('success', true);
        expect(result).toHaveProperty('hasMorePending', false);
      });
    });
  });
});
