/**
 * Tests for ProjectManager - project lifecycle and file management.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  projectExists,
  createProject,
  loadProject,
  deleteProject,
  writeProjectFile,
  readProjectFile,
  getProjectDir,
  getOriginalInput,
  getStateTransitionPrompt,
  saveProject,
} from '../../src/tasks/video/workflow/index.js';
import { PlannerStage } from '../../src/tasks/video/workflow/types.js';

// Use a temp directory for tests
const TEST_BASE_PATH = join(process.cwd(), 'test-temp-project');

describe('ProjectManager', () => {
  beforeEach(() => {
    // Clean up before each test
    if (existsSync(TEST_BASE_PATH)) {
      rmSync(TEST_BASE_PATH, { recursive: true, force: true });
    }
    mkdirSync(TEST_BASE_PATH, { recursive: true });
  });

  afterEach(() => {
    // Clean up after each test
    if (existsSync(TEST_BASE_PATH)) {
      rmSync(TEST_BASE_PATH, { recursive: true, force: true });
    }
  });

  describe('projectExists', () => {
    it('returns false when no project exists', () => {
      expect(projectExists(TEST_BASE_PATH)).toBe(false);
    });

    it('returns true when project exists', () => {
      createProject('Test story', TEST_BASE_PATH);
      expect(projectExists(TEST_BASE_PATH)).toBe(true);
    });
  });

  describe('createProject', () => {
    it('creates project.json with correct structure', () => {
      const project = createProject('A robot learning to dance', TEST_BASE_PATH);

      expect(project.id).toMatch(/^proj-/);
      // Original input is now stored in a separate file
      expect(project.originalInputFile).toBe('original_input.md');
      expect(getOriginalInput(project, TEST_BASE_PATH)).toBe('A robot learning to dance');
      expect(project.currentPhase).toBe('plot');
      expect(project.characters).toEqual([]);
      expect(project.scenes).toEqual([]);
    });

    it('creates directory structure without empty plan files', () => {
      createProject('Test story', TEST_BASE_PATH);
      const projectDir = getProjectDir(TEST_BASE_PATH);

      // Directories should exist
      expect(existsSync(join(projectDir, 'plans'))).toBe(true);
      expect(existsSync(join(projectDir, 'characters'))).toBe(true);
      expect(existsSync(join(projectDir, 'settings'))).toBe(true);
      expect(existsSync(join(projectDir, 'assets'))).toBe(true);

      // Plan files should NOT exist (created on first write)
      expect(existsSync(join(projectDir, 'plans', 'plot.md'))).toBe(false);
      expect(existsSync(join(projectDir, 'plans', 'story.md'))).toBe(false);
      expect(existsSync(join(projectDir, 'plans', 'scenes.md'))).toBe(false);

      // Assets manifest should exist
      expect(existsSync(join(projectDir, 'assets', 'manifest.json'))).toBe(true);
    });
  });

  describe('loadProject', () => {
    it('returns null when no project exists', () => {
      expect(loadProject(TEST_BASE_PATH)).toBeNull();
    });

    it('loads existing project correctly', () => {
      createProject('Test story', TEST_BASE_PATH);
      const project = loadProject(TEST_BASE_PATH);

      expect(project).not.toBeNull();
      expect(project?.originalInputFile).toBe('original_input.md');
      expect(getOriginalInput(project!, TEST_BASE_PATH)).toBe('Test story');
    });
  });

  describe('deleteProject', () => {
    it('returns false when no project exists', () => {
      expect(deleteProject(TEST_BASE_PATH)).toBe(false);
    });

    it('deletes existing project and returns true', () => {
      createProject('Test story', TEST_BASE_PATH);
      expect(projectExists(TEST_BASE_PATH)).toBe(true);

      const result = deleteProject(TEST_BASE_PATH);

      expect(result).toBe(true);
      expect(projectExists(TEST_BASE_PATH)).toBe(false);
    });

    it('removes entire .kshana directory', () => {
      createProject('Test story', TEST_BASE_PATH);
      const projectDir = getProjectDir(TEST_BASE_PATH);

      // Write some files
      writeProjectFile('plans/plot.md', '# Plot', TEST_BASE_PATH);
      writeProjectFile('plans/story.md', '# Story', TEST_BASE_PATH);

      expect(existsSync(projectDir)).toBe(true);

      deleteProject(TEST_BASE_PATH);

      expect(existsSync(projectDir)).toBe(false);
    });
  });

  describe('writeProjectFile', () => {
    it('creates file on first write (not at project creation)', () => {
      createProject('Test story', TEST_BASE_PATH);
      const projectDir = getProjectDir(TEST_BASE_PATH);
      const plotPath = join(projectDir, 'plans', 'plot.md');

      // File should not exist after project creation
      expect(existsSync(plotPath)).toBe(false);

      // Write content
      writeProjectFile('plans/plot.md', '# My Plot\n\nA great story.', TEST_BASE_PATH);

      // Now file should exist with content
      expect(existsSync(plotPath)).toBe(true);
      expect(readFileSync(plotPath, 'utf-8')).toBe('# My Plot\n\nA great story.');
    });

    it('overwrites existing file', () => {
      createProject('Test story', TEST_BASE_PATH);

      writeProjectFile('plans/plot.md', 'First version', TEST_BASE_PATH);
      writeProjectFile('plans/plot.md', 'Second version', TEST_BASE_PATH);

      const content = readProjectFile('plans/plot.md', TEST_BASE_PATH);
      expect(content).toBe('Second version');
    });
  });

  describe('readProjectFile', () => {
    it('returns null for non-existent file', () => {
      createProject('Test story', TEST_BASE_PATH);
      expect(readProjectFile('plans/plot.md', TEST_BASE_PATH)).toBeNull();
    });

    it('returns content for existing file', () => {
      createProject('Test story', TEST_BASE_PATH);
      writeProjectFile('plans/plot.md', 'Test content', TEST_BASE_PATH);

      expect(readProjectFile('plans/plot.md', TEST_BASE_PATH)).toBe('Test content');
    });
  });
});

describe('Project Continuation Flow', () => {
  beforeEach(() => {
    if (existsSync(TEST_BASE_PATH)) {
      rmSync(TEST_BASE_PATH, { recursive: true, force: true });
    }
    mkdirSync(TEST_BASE_PATH, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_BASE_PATH)) {
      rmSync(TEST_BASE_PATH, { recursive: true, force: true });
    }
  });

  it('can detect existing project on startup', () => {
    // Simulate first session - create project
    const project1 = createProject('A robot story', TEST_BASE_PATH);
    const projectId = project1.id;

    // Simulate new session - check for existing
    expect(projectExists(TEST_BASE_PATH)).toBe(true);

    const loadedProject = loadProject(TEST_BASE_PATH);
    expect(loadedProject?.id).toBe(projectId);
    expect(getOriginalInput(loadedProject!, TEST_BASE_PATH)).toBe('A robot story');
  });

  it('can continue existing project with its state', () => {
    // First session - create and update project
    const project = createProject('A robot story', TEST_BASE_PATH);
    writeProjectFile('plans/plot.md', '# Robot Dance Plot\n\nA robot learns to dance.', TEST_BASE_PATH);

    // New session - load and continue
    const continued = loadProject(TEST_BASE_PATH);
    expect(getOriginalInput(continued!, TEST_BASE_PATH)).toBe('A robot story');

    const plotContent = readProjectFile('plans/plot.md', TEST_BASE_PATH);
    expect(plotContent).toContain('Robot Dance Plot');
  });

  it('can start new project after deleting existing', () => {
    // Create first project
    createProject('First story', TEST_BASE_PATH);
    writeProjectFile('plans/plot.md', 'First plot', TEST_BASE_PATH);

    // Delete and create new
    deleteProject(TEST_BASE_PATH);
    expect(projectExists(TEST_BASE_PATH)).toBe(false);

    const newProject = createProject('Second story', TEST_BASE_PATH);
    expect(getOriginalInput(newProject, TEST_BASE_PATH)).toBe('Second story');

    // Old content should be gone
    expect(readProjectFile('plans/plot.md', TEST_BASE_PATH)).toBeNull();
  });

  it('preserves project state across multiple sessions', () => {
    // Session 1: Create project and plot
    createProject('Epic tale', TEST_BASE_PATH);
    writeProjectFile('plans/plot.md', '# Act 1\nIntroduction', TEST_BASE_PATH);

    // Session 2: Add more content
    const loaded1 = loadProject(TEST_BASE_PATH);
    expect(loaded1).not.toBeNull();
    writeProjectFile('plans/story.md', '# Full Story\nOnce upon a time...', TEST_BASE_PATH);

    // Session 3: Verify all content persists
    const loaded2 = loadProject(TEST_BASE_PATH);
    expect(getOriginalInput(loaded2!, TEST_BASE_PATH)).toBe('Epic tale');
    expect(readProjectFile('plans/plot.md', TEST_BASE_PATH)).toContain('Act 1');
    expect(readProjectFile('plans/story.md', TEST_BASE_PATH)).toContain('Once upon a time');
  });
});

describe('Disk-Scanning Sync Functionality', () => {
  beforeEach(() => {
    if (existsSync(TEST_BASE_PATH)) {
      rmSync(TEST_BASE_PATH, { recursive: true, force: true });
    }
    mkdirSync(TEST_BASE_PATH, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_BASE_PATH)) {
      rmSync(TEST_BASE_PATH, { recursive: true, force: true });
    }
  });

  describe('Character file scanning', () => {
    it('registers orphaned character files from disk', () => {
      // Create project with empty characters array
      const project = createProject('Test story', TEST_BASE_PATH);
      expect(project.characters.length).toBe(0);

      // Manually create a character file on disk (simulating orphaned file)
      const projectDir = getProjectDir(TEST_BASE_PATH);
      writeFileSync(
        join(projectDir, 'characters', 'aria.md'),
        '# Character: Aria\n\nA brave warrior princess.'
      );

      // Reload project - should scan and register the character
      const reloaded = loadProject(TEST_BASE_PATH);

      expect(reloaded).not.toBeNull();
      expect(reloaded!.characters.length).toBe(1);
      expect(reloaded!.characters[0].name).toBe('Aria');
    });

    it('extracts character name from heading', () => {
      createProject('Test story', TEST_BASE_PATH);
      const projectDir = getProjectDir(TEST_BASE_PATH);

      writeFileSync(
        join(projectDir, 'characters', 'hero.md'),
        '# The Great Hero\n\nDescription here.'
      );

      const reloaded = loadProject(TEST_BASE_PATH);
      expect(reloaded!.characters[0].name).toBe('The Great Hero');
    });

    it('does not duplicate already registered characters', () => {
      const project = createProject('Test story', TEST_BASE_PATH);
      const projectDir = getProjectDir(TEST_BASE_PATH);

      // Manually add character to project
      project.characters.push({
        name: 'Aria',
        description: 'A warrior',
        file: 'characters/aria.md',
        approvalStatus: 'approved',
        createdAt: Date.now(),
      } as any);

      // Save project with the character
      const filePath = join(projectDir, 'project.json');
      writeFileSync(filePath, JSON.stringify(project, null, 2));

      // Create the matching file on disk
      writeFileSync(
        join(projectDir, 'characters', 'aria.md'),
        '# Character: Aria\n\nA warrior.'
      );

      // Reload - should not duplicate
      const reloaded = loadProject(TEST_BASE_PATH);
      expect(reloaded!.characters.length).toBe(1);
    });

    it('marks characters as approved if phase is complete', () => {
      const project = createProject('Test story', TEST_BASE_PATH);
      const projectDir = getProjectDir(TEST_BASE_PATH);

      // Mark characters_settings phase as complete
      project.phases.characters_settings = {
        status: 'completed',
        plannerStage: PlannerStage.COMPLETE, completedAt: null,
      };

      // Save project with completed phase
      const filePath = join(projectDir, 'project.json');
      writeFileSync(filePath, JSON.stringify(project, null, 2));

      // Create orphaned character file
      writeFileSync(
        join(projectDir, 'characters', 'bolt.md'),
        '# Bolt\n\nA speedy robot.'
      );

      // Reload - character should be marked as approved
      const reloaded = loadProject(TEST_BASE_PATH);
      expect(reloaded!.characters[0].approvalStatus).toBe('approved');
      expect(reloaded!.characters[0].approvedAt).toBeDefined();
    });
  });

  describe('Setting file scanning', () => {
    it('registers orphaned setting files from disk', () => {
      const project = createProject('Test story', TEST_BASE_PATH);
      expect(project.settings.length).toBe(0);

      const projectDir = getProjectDir(TEST_BASE_PATH);
      writeFileSync(
        join(projectDir, 'settings', 'forest.md'),
        '# Setting: Enchanted Forest\n\nA magical woodland.'
      );

      const reloaded = loadProject(TEST_BASE_PATH);

      expect(reloaded!.settings.length).toBe(1);
      expect(reloaded!.settings[0].name).toBe('Enchanted Forest');
    });

    it('extracts setting name from heading', () => {
      createProject('Test story', TEST_BASE_PATH);
      const projectDir = getProjectDir(TEST_BASE_PATH);

      writeFileSync(
        join(projectDir, 'settings', 'castle.md'),
        '# The Ancient Castle\n\nA mysterious fortress.'
      );

      const reloaded = loadProject(TEST_BASE_PATH);
      expect(reloaded!.settings[0].name).toBe('The Ancient Castle');
    });

    it('marks settings as approved if phase is complete', () => {
      const project = createProject('Test story', TEST_BASE_PATH);
      const projectDir = getProjectDir(TEST_BASE_PATH);

      project.phases.characters_settings = {
        status: 'completed',
        plannerStage: PlannerStage.COMPLETE, completedAt: null,
      };

      const filePath = join(projectDir, 'project.json');
      writeFileSync(filePath, JSON.stringify(project, null, 2));

      writeFileSync(
        join(projectDir, 'settings', 'cave.md'),
        '# Dark Cave\n\nA spooky location.'
      );

      const reloaded = loadProject(TEST_BASE_PATH);
      expect(reloaded!.settings[0].approvalStatus).toBe('approved');
    });
  });

  describe('Scene file scanning', () => {
    it('registers orphaned scene files from disk', () => {
      const project = createProject('Test story', TEST_BASE_PATH);
      expect(project.scenes.length).toBe(0);

      const projectDir = getProjectDir(TEST_BASE_PATH);

      // Create scenes directory if it doesn't exist
      mkdirSync(join(projectDir, 'scenes'), { recursive: true });

      writeFileSync(
        join(projectDir, 'scenes', 'scene_01.md'),
        '# Scene 1: The Beginning\n\nThe story starts here.'
      );
      writeFileSync(
        join(projectDir, 'scenes', 'scene_02.md'),
        '# Scene 2: The Journey\n\nOur hero sets off.'
      );

      const reloaded = loadProject(TEST_BASE_PATH);

      expect(reloaded!.scenes.length).toBe(2);
      expect(reloaded!.scenes[0].sceneNumber).toBe(1);
      expect(reloaded!.scenes[0].title).toBe('The Beginning');
      expect(reloaded!.scenes[1].sceneNumber).toBe(2);
      expect(reloaded!.scenes[1].title).toBe('The Journey');
    });

    it('extracts scene title from content', () => {
      createProject('Test story', TEST_BASE_PATH);
      const projectDir = getProjectDir(TEST_BASE_PATH);

      mkdirSync(join(projectDir, 'scenes'), { recursive: true });
      writeFileSync(
        join(projectDir, 'scenes', 'scene_05.md'),
        '# The Epic Climax\n\nThe final battle begins.'
      );

      const reloaded = loadProject(TEST_BASE_PATH);
      expect(reloaded!.scenes[0].title).toBe('The Epic Climax');
      expect(reloaded!.scenes[0].sceneNumber).toBe(5);
    });

    it('sorts scenes by number', () => {
      createProject('Test story', TEST_BASE_PATH);
      const projectDir = getProjectDir(TEST_BASE_PATH);

      mkdirSync(join(projectDir, 'scenes'), { recursive: true });

      // Create scenes out of order
      writeFileSync(join(projectDir, 'scenes', 'scene_03.md'), '# Scene 3');
      writeFileSync(join(projectDir, 'scenes', 'scene_01.md'), '# Scene 1');
      writeFileSync(join(projectDir, 'scenes', 'scene_02.md'), '# Scene 2');

      const reloaded = loadProject(TEST_BASE_PATH);

      expect(reloaded!.scenes.map(s => s.sceneNumber)).toEqual([1, 2, 3]);
    });

    it('marks scenes as approved if phase is complete', () => {
      const project = createProject('Test story', TEST_BASE_PATH);
      const projectDir = getProjectDir(TEST_BASE_PATH);

      project.phases.scenes = {
        status: 'completed',
        plannerStage: PlannerStage.COMPLETE, completedAt: null,
      };

      const filePath = join(projectDir, 'project.json');
      writeFileSync(filePath, JSON.stringify(project, null, 2));

      mkdirSync(join(projectDir, 'scenes'), { recursive: true });
      writeFileSync(
        join(projectDir, 'scenes', 'scene_01.md'),
        '# Scene 1: Opening'
      );

      const reloaded = loadProject(TEST_BASE_PATH);
      expect(reloaded!.scenes[0].contentApprovalStatus).toBe('approved');
      expect(reloaded!.scenes[0].contentApprovedAt).toBeDefined();
    });

    it('ignores files that do not match scene_XX.md pattern', () => {
      createProject('Test story', TEST_BASE_PATH);
      const projectDir = getProjectDir(TEST_BASE_PATH);

      mkdirSync(join(projectDir, 'scenes'), { recursive: true });
      writeFileSync(join(projectDir, 'scenes', 'scene_01.md'), '# Scene 1');
      writeFileSync(join(projectDir, 'scenes', 'notes.md'), '# Notes'); // Should be ignored
      writeFileSync(join(projectDir, 'scenes', 'draft_scene.md'), '# Draft'); // Should be ignored

      const reloaded = loadProject(TEST_BASE_PATH);
      expect(reloaded!.scenes.length).toBe(1);
    });

    it('does not duplicate already registered scenes', () => {
      const project = createProject('Test story', TEST_BASE_PATH);
      const projectDir = getProjectDir(TEST_BASE_PATH);

      // Pre-register a scene
      project.scenes.push({
        sceneNumber: 1,
        title: 'First Scene',
        file: 'scenes/scene_01.md',
        contentApprovalStatus: 'approved',
        createdAt: Date.now(),
      } as any);

      const filePath = join(projectDir, 'project.json');
      writeFileSync(filePath, JSON.stringify(project, null, 2));

      mkdirSync(join(projectDir, 'scenes'), { recursive: true });
      writeFileSync(join(projectDir, 'scenes', 'scene_01.md'), '# Scene 1: First Scene');

      const reloaded = loadProject(TEST_BASE_PATH);
      expect(reloaded!.scenes.length).toBe(1);
    });
  });

  describe('Resume mid-phase', () => {
    it('correctly identifies approved vs pending items after reload', () => {
      const project = createProject('Test story', TEST_BASE_PATH);
      const projectDir = getProjectDir(TEST_BASE_PATH);

      // Create multiple characters, some approved, some not
      project.characters = [
        {
          name: 'Aria',
          description: 'Approved character',
          approvalStatus: 'approved',
          approvedAt: Date.now(),
          createdAt: Date.now(),
        } as any,
      ];

      project.currentPhase = 'characters_settings';
      project.phases.characters_settings = {
        status: 'in_progress',
        plannerStage: PlannerStage.PLANNING, completedAt: null,
      };

      const filePath = join(projectDir, 'project.json');
      writeFileSync(filePath, JSON.stringify(project, null, 2));

      // Add an orphaned character file (not approved)
      writeFileSync(
        join(projectDir, 'characters', 'bolt.md'),
        '# Bolt\n\nNew character.'
      );

      const reloaded = loadProject(TEST_BASE_PATH);

      // Should have 2 characters now
      expect(reloaded!.characters.length).toBe(2);

      // First one should still be approved
      const aria = reloaded!.characters.find(c => c.name === 'Aria');
      expect(aria?.approvalStatus).toBe('approved');

      // New one should NOT be approved (phase not complete)
      const bolt = reloaded!.characters.find(c => c.name === 'Bolt');
      expect(bolt?.approvalStatus).not.toBe('approved');
    });
  });
});

describe('Todo Resume Instructions', () => {
  beforeEach(() => {
    if (existsSync(TEST_BASE_PATH)) {
      rmSync(TEST_BASE_PATH, { recursive: true, force: true });
    }
    mkdirSync(TEST_BASE_PATH, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_BASE_PATH)) {
      rmSync(TEST_BASE_PATH, { recursive: true, force: true });
    }
  });

  describe('getStateTransitionPrompt', () => {
    it('generates PHASE START instructions when no items are approved', () => {
      createProject('Test story', TEST_BASE_PATH);
      const projectDir = getProjectDir(TEST_BASE_PATH);

      // Create character files directly on disk
      writeFileSync(join(projectDir, 'characters', 'hero.md'), '# Hero\n\nThe protagonist');
      writeFileSync(join(projectDir, 'characters', 'villain.md'), '# Villain\n\nThe antagonist');

      // Reload to pick up characters from disk
      const project = loadProject(TEST_BASE_PATH)!;
      project.currentPhase = 'characters_settings';
      project.phases.characters_settings = {
        status: 'in_progress',
        plannerStage: PlannerStage.COMPLETE, completedAt: null,
      };
      saveProject(project, TEST_BASE_PATH);

      const prompt = getStateTransitionPrompt(TEST_BASE_PATH);

      expect(prompt).toContain('PHASE START');
      expect(prompt).toContain('merge: false');
      expect(prompt).toContain('REPLACE');
    });

    it('generates RESUMING MID-PHASE instructions when some items are approved', () => {
      createProject('Test story', TEST_BASE_PATH);
      const projectDir = getProjectDir(TEST_BASE_PATH);

      // Create character files
      writeFileSync(join(projectDir, 'characters', 'hero.md'), '# Hero\n\nThe protagonist');
      writeFileSync(join(projectDir, 'characters', 'sidekick.md'), '# Sidekick\n\nThe helper');
      writeFileSync(join(projectDir, 'characters', 'villain.md'), '# Villain\n\nThe antagonist');

      // Reload to pick up characters
      let project = loadProject(TEST_BASE_PATH)!;

      // Approve only the first one
      project.characters[0].approvalStatus = 'approved';
      project.characters[0].approvedAt = Date.now();

      project.currentPhase = 'characters_settings';
      project.phases.characters_settings = {
        status: 'in_progress',
        plannerStage: PlannerStage.COMPLETE, completedAt: null,
      };
      saveProject(project, TEST_BASE_PATH);

      const prompt = getStateTransitionPrompt(TEST_BASE_PATH);

      expect(prompt).toContain('RESUMING MID-PHASE');
      expect(prompt).toContain('1 of 3');
      expect(prompt).toContain('TodoWrite');
      expect(prompt).toContain('merge: false');
    });

    it('includes Current Item Statuses section', () => {
      createProject('Test story', TEST_BASE_PATH);
      const projectDir = getProjectDir(TEST_BASE_PATH);

      writeFileSync(join(projectDir, 'characters', 'alice.md'), '# Alice\n\nFirst character');
      writeFileSync(join(projectDir, 'characters', 'bob.md'), '# Bob\n\nSecond character');

      let project = loadProject(TEST_BASE_PATH)!;
      // Approve Alice
      const alice = project.characters.find(c => c.name === 'Alice');
      if (alice) {
        alice.approvalStatus = 'approved';
        alice.approvedAt = Date.now();
      }

      project.currentPhase = 'characters_settings';
      project.phases.characters_settings = {
        status: 'in_progress',
        plannerStage: PlannerStage.COMPLETE, completedAt: null,
      };
      saveProject(project, TEST_BASE_PATH);

      const prompt = getStateTransitionPrompt(TEST_BASE_PATH);

      expect(prompt).toContain('Current Item Statuses');
      expect(prompt).toContain('Alice');
      expect(prompt).toContain('Bob');
      expect(prompt).toContain('approved');
    });

    it('generates pre-filled TodoWrite call with correct statuses', () => {
      createProject('Test story', TEST_BASE_PATH);
      const projectDir = getProjectDir(TEST_BASE_PATH);

      writeFileSync(join(projectDir, 'characters', 'done.md'), '# Done\n\nCompleted');
      writeFileSync(join(projectDir, 'characters', 'next.md'), '# Next\n\nNext to process');
      writeFileSync(join(projectDir, 'characters', 'later.md'), '# Later\n\nFuture item');

      let project = loadProject(TEST_BASE_PATH)!;
      // Approve Done
      const done = project.characters.find(c => c.name === 'Done');
      if (done) {
        done.approvalStatus = 'approved';
        done.approvedAt = Date.now();
      }

      project.currentPhase = 'characters_settings';
      project.phases.characters_settings = {
        status: 'in_progress',
        plannerStage: PlannerStage.COMPLETE, completedAt: null,
      };
      saveProject(project, TEST_BASE_PATH);

      const prompt = getStateTransitionPrompt(TEST_BASE_PATH);

      // Should have completed for approved items
      expect(prompt).toContain('status: "completed"');
      // Should have in_progress for the next item
      expect(prompt).toContain('status: "in_progress"');
      // Should have pending for future items
      expect(prompt).toContain('status: "pending"');
    });

    it('identifies next item to process', () => {
      createProject('Test story', TEST_BASE_PATH);
      const projectDir = getProjectDir(TEST_BASE_PATH);

      writeFileSync(join(projectDir, 'characters', 'completed.md'), '# Completed\n\nDone');
      writeFileSync(join(projectDir, 'characters', 'nextup.md'), '# NextUp\n\nTo be processed');

      let project = loadProject(TEST_BASE_PATH)!;
      const completed = project.characters.find(c => c.name === 'Completed');
      if (completed) {
        completed.approvalStatus = 'approved';
        completed.approvedAt = Date.now();
      }

      project.currentPhase = 'characters_settings';
      project.phases.characters_settings = {
        status: 'in_progress',
        plannerStage: PlannerStage.COMPLETE, completedAt: null,
      };
      saveProject(project, TEST_BASE_PATH);

      const prompt = getStateTransitionPrompt(TEST_BASE_PATH);

      expect(prompt).toContain('Next Item to Process');
      expect(prompt).toContain('NextUp');
    });

    it('works with scenes phase', () => {
      createProject('Test story', TEST_BASE_PATH);
      const projectDir = getProjectDir(TEST_BASE_PATH);

      // Create scenes directory and files
      mkdirSync(join(projectDir, 'scenes'), { recursive: true });
      writeFileSync(join(projectDir, 'scenes', 'scene_01.md'), '# Scene 1: Opening');
      writeFileSync(join(projectDir, 'scenes', 'scene_02.md'), '# Scene 2: Middle');
      writeFileSync(join(projectDir, 'scenes', 'scene_03.md'), '# Scene 3: End');

      // Reload to pick up scenes from disk
      let project = loadProject(TEST_BASE_PATH)!;

      // Approve first scene
      project.scenes[0].contentApprovalStatus = 'approved';
      project.scenes[0].contentApprovedAt = Date.now();

      // Set phase to scenes
      project.currentPhase = 'scenes';
      project.phases.scenes = {
        status: 'in_progress',
        plannerStage: PlannerStage.COMPLETE, completedAt: null,
      };
      saveProject(project, TEST_BASE_PATH);

      const prompt = getStateTransitionPrompt(TEST_BASE_PATH);

      expect(prompt).toContain('RESUMING MID-PHASE');
      expect(prompt).toContain('1 of 3');
    });

    it('works with settings in characters_settings phase', () => {
      createProject('Test story', TEST_BASE_PATH);
      const projectDir = getProjectDir(TEST_BASE_PATH);

      writeFileSync(join(projectDir, 'settings', 'forest.md'), '# Forest\n\nDark forest');
      writeFileSync(join(projectDir, 'settings', 'castle.md'), '# Castle\n\nAncient castle');

      let project = loadProject(TEST_BASE_PATH)!;
      const forest = project.settings.find(s => s.name === 'Forest');
      if (forest) {
        forest.approvalStatus = 'approved';
        forest.approvedAt = Date.now();
      }

      project.currentPhase = 'characters_settings';
      project.phases.characters_settings = {
        status: 'in_progress',
        plannerStage: PlannerStage.COMPLETE, completedAt: null,
      };
      saveProject(project, TEST_BASE_PATH);

      const prompt = getStateTransitionPrompt(TEST_BASE_PATH);

      expect(prompt).toContain('Current Item Statuses');
      expect(prompt).toContain('Forest');
      expect(prompt).toContain('Castle');
    });
  });
});
