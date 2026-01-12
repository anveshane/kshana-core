/**
 * Tests for the video-edit ProjectManager.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  createProject,
  loadProject,
  saveProject,
  deleteProject,
  projectExists,
  getProjectDir,
  setSourceVideo,
  updateSourceMetadata,
  setScript,
  setScriptSegments,
  addEnhancement,
  updateEnhancementApproval,
  getPendingEnhancements,
  getApprovedEnhancements,
  addAsset,
  addTimelineTrack,
  updatePhaseStatus,
  transitionToNextPhase,
  getProjectSummary,
} from '../../src/tasks/video-edit/workflow/ProjectManager.js';
import {
  EditWorkflowPhase,
  type EnhancementSuggestion,
  type VideoMetadata,
  type ScriptSegment,
  type AssetInfo,
} from '../../src/tasks/video-edit/workflow/types.js';

describe('Video Edit ProjectManager', () => {
  let testDir: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-edit-test-'));
  });

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('createProject', () => {
    it('should create a new project with correct structure', () => {
      const project = createProject('Test Video Project', testDir);

      expect(project).toBeDefined();
      expect(project.version).toBe('3.0');
      expect(project.title).toBe('Test Video Project');
      expect(project.currentPhase).toBe(EditWorkflowPhase.INGEST);
      expect(project.enhancements).toEqual([]);
      expect(project.assets).toEqual([]);
    });

    it('should create project directory structure', () => {
      createProject('Test Project', testDir);

      const projectDir = getProjectDir(testDir);
      expect(fs.existsSync(projectDir)).toBe(true);
      expect(fs.existsSync(path.join(projectDir, 'source'))).toBe(true);
      expect(fs.existsSync(path.join(projectDir, 'script'))).toBe(true);
      expect(fs.existsSync(path.join(projectDir, 'assets'))).toBe(true);
      expect(fs.existsSync(path.join(projectDir, 'timeline'))).toBe(true);
      expect(fs.existsSync(path.join(projectDir, 'export'))).toBe(true);
    });

    it('should create project.json file', () => {
      createProject('Test Project', testDir);

      const projectFile = path.join(getProjectDir(testDir), 'project.json');
      expect(fs.existsSync(projectFile)).toBe(true);

      const content = JSON.parse(fs.readFileSync(projectFile, 'utf-8'));
      expect(content.version).toBe('3.0');
    });
  });

  describe('loadProject', () => {
    it('should load existing project', () => {
      createProject('Test Project', testDir);

      const loaded = loadProject(testDir);

      expect(loaded).not.toBeNull();
      expect(loaded?.title).toBe('Test Project');
    });

    it('should return null for non-existent project', () => {
      const loaded = loadProject(testDir);

      expect(loaded).toBeNull();
    });
  });

  describe('projectExists', () => {
    it('should return true when project exists', () => {
      createProject('Test Project', testDir);

      expect(projectExists(testDir)).toBe(true);
    });

    it('should return false when project does not exist', () => {
      expect(projectExists(testDir)).toBe(false);
    });
  });

  describe('deleteProject', () => {
    it('should delete existing project', () => {
      createProject('Test Project', testDir);
      expect(projectExists(testDir)).toBe(true);

      const result = deleteProject(testDir);

      expect(result).toBe(true);
      expect(projectExists(testDir)).toBe(false);
    });

    it('should return false for non-existent project', () => {
      const result = deleteProject(testDir);

      expect(result).toBe(false);
    });
  });

  describe('setSourceVideo', () => {
    it('should set source video information', () => {
      const project = createProject('Test Project', testDir);

      setSourceVideo(project, 'local_file', '/path/to/video.mp4', undefined, testDir);

      const loaded = loadProject(testDir);
      expect(loaded?.source.type).toBe('local_file');
      expect(loaded?.source.path).toBe('/path/to/video.mp4');
    });
  });

  describe('updateSourceMetadata', () => {
    it('should update video metadata', () => {
      const project = createProject('Test Project', testDir);
      const metadata: VideoMetadata = {
        durationMs: 120000,
        width: 1920,
        height: 1080,
        fps: 30,
        codec: 'h264',
        bitrate: 5000,
        fileSize: 50000000,
        format: 'mp4',
        audioTracks: [],
      };

      updateSourceMetadata(project, metadata, testDir);

      const loaded = loadProject(testDir);
      expect(loaded?.source.metadata?.durationMs).toBe(120000);
      expect(loaded?.source.metadata?.width).toBe(1920);
      expect(loaded?.timeline.durationMs).toBe(120000);
    });
  });

  describe('Script Management', () => {
    it('should set script content', () => {
      const project = createProject('Test Project', testDir);

      setScript(project, 'Hello world', 'plain_text', undefined, testDir);

      const loaded = loadProject(testDir);
      expect(loaded?.script.format).toBe('plain_text');
      expect(loaded?.script.content).toBe('Hello world');
    });

    it('should set script segments', () => {
      const project = createProject('Test Project', testDir);
      const segments: ScriptSegment[] = [
        { id: '1', index: 0, text: 'First segment', type: 'dialogue' },
        { id: '2', index: 1, text: 'Second segment', type: 'narration' },
      ];

      setScriptSegments(project, segments, testDir);

      const loaded = loadProject(testDir);
      expect(loaded?.script.segments).toHaveLength(2);
      expect(loaded?.script.segments[0].text).toBe('First segment');
    });
  });

  describe('Enhancement Management', () => {
    it('should add enhancement', () => {
      const project = createProject('Test Project', testDir);
      const enhancement: EnhancementSuggestion = {
        id: 'enh_1',
        type: 'ai_image',
        compositionMode: 'broll_cut',
        timeRange: { startMs: 0, endMs: 5000 },
        source: 'ai_suggested',
        confidence: 0.8,
        description: 'Test enhancement',
        approvalStatus: 'pending',
        regenerationCount: 0,
      };

      addEnhancement(project, enhancement, testDir);

      const loaded = loadProject(testDir);
      expect(loaded?.enhancements).toHaveLength(1);
      expect(loaded?.enhancements[0].id).toBe('enh_1');
    });

    it('should update enhancement approval', () => {
      const project = createProject('Test Project', testDir);
      const enhancement: EnhancementSuggestion = {
        id: 'enh_1',
        type: 'ai_image',
        compositionMode: 'broll_cut',
        timeRange: { startMs: 0, endMs: 5000 },
        source: 'ai_suggested',
        confidence: 0.8,
        description: 'Test enhancement',
        approvalStatus: 'pending',
        regenerationCount: 0,
      };
      addEnhancement(project, enhancement, testDir);

      updateEnhancementApproval(project, 'enh_1', 'approved', undefined, testDir);

      const loaded = loadProject(testDir);
      expect(loaded?.enhancements[0].approvalStatus).toBe('approved');
    });

    it('should get pending enhancements', () => {
      const project = createProject('Test Project', testDir);

      // Add pending enhancement
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

      // Add approved enhancement
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

      const pending = getPendingEnhancements(project);

      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe('enh_1');
    });

    it('should get approved enhancements', () => {
      const project = createProject('Test Project', testDir);

      addEnhancement(project, {
        id: 'enh_1',
        type: 'ai_image',
        compositionMode: 'broll_cut',
        timeRange: { startMs: 0, endMs: 5000 },
        source: 'ai_suggested',
        confidence: 0.8,
        description: 'Test',
        approvalStatus: 'approved',
        regenerationCount: 0,
      }, testDir);

      const approved = getApprovedEnhancements(project);

      expect(approved).toHaveLength(1);
    });
  });

  describe('Asset Management', () => {
    it('should add asset', () => {
      const project = createProject('Test Project', testDir);
      const asset: AssetInfo = {
        id: 'asset_1',
        type: 'ai_image',
        path: 'assets/images/test.jpg',
        createdAt: Date.now(),
      };

      addAsset(project, asset, testDir);

      const loaded = loadProject(testDir);
      expect(loaded?.assets).toHaveLength(1);
      expect(loaded?.assets[0].id).toBe('asset_1');
    });
  });

  describe('Timeline Management', () => {
    it('should add timeline track', () => {
      const project = createProject('Test Project', testDir);

      const track = addTimelineTrack(project, 'broll', 'B-Roll Track', testDir);

      expect(track).toBeDefined();
      expect(track.type).toBe('broll');
      expect(track.label).toBe('B-Roll Track');

      const loaded = loadProject(testDir);
      expect(loaded?.timeline.tracks).toHaveLength(1);
    });
  });

  describe('Phase Management', () => {
    it('should update phase status', () => {
      const project = createProject('Test Project', testDir);

      updatePhaseStatus(project, 'ingest', 'completed', testDir);

      const loaded = loadProject(testDir);
      expect(loaded?.phases.ingest.status).toBe('completed');
    });

    it('should transition to next phase', () => {
      const project = createProject('Test Project', testDir);
      updatePhaseStatus(project, 'ingest', 'completed', testDir);

      const result = transitionToNextPhase(project, testDir);

      expect(result.transitioned).toBe(true);
      const loaded = loadProject(testDir);
      expect(loaded?.currentPhase).toBe(EditWorkflowPhase.SCRIPT_PARSE);
    });
  });

  describe('getProjectSummary', () => {
    it('should return summary for existing project', () => {
      createProject('My Test Video', testDir);

      const summary = getProjectSummary(testDir);

      expect(summary).toContain('My Test Video');
      expect(summary).toContain('3.0');
    });

    it('should return message for non-existent project', () => {
      const summary = getProjectSummary(testDir);

      expect(summary).toContain('No project found');
    });
  });
});
