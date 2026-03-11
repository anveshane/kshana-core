import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import { join } from 'path';

import {
  createProject,
  getProjectDir,
  loadProject,
} from '../../src/tasks/video/workflow/ProjectManager.js';
import { updateProjectTool } from '../../src/tasks/video/workflow/FileTools.js';
import { setActiveProjectDir } from '../../src/tasks/video/workflow/activeProject.js';

describe('Project root stability', () => {
  let tempRoot: string;
  let projectRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(join(os.tmpdir(), 'kshana-project-root-'));
    projectRoot = join(tempRoot, 'desktop-root.kshana');
    setActiveProjectDir(projectRoot);
  });

  afterEach(() => {
    setActiveProjectDir('default.kshana');
    if (fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('keeps the configured absolute project root when creating a project', () => {
    const project = createProject('A boy playing football');

    expect(getProjectDir()).toBe(projectRoot);
    expect(project.id).toBe(loadProject()?.id);
    expect(fs.existsSync(join(projectRoot, 'project.json'))).toBe(true);
    expect(fs.existsSync(join(projectRoot, 'original_input.md'))).toBe(true);
  });

  it('does not recreate or switch roots when update_project(create) is called again', async () => {
    const project = createProject('Initial desktop project');

    const result = await updateProjectTool.handler?.({
      action: 'create',
      data: { original_input: 'A boy playing football' },
    });

    expect(result).toMatchObject({
      status: 'success',
      message: 'Project already exists',
      project_id: project.id,
      current_phase: project.currentPhase,
      already_exists: true,
    });
    expect(getProjectDir()).toBe(projectRoot);
    expect(loadProject()?.id).toBe(project.id);
  });
});
