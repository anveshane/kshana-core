/**
 * Tests for /reset command from UI.
 *
 * Verifies:
 * 1. Reset script is callable and exits with expected codes
 * 2. Server types include reset_project message
 * 3. WebSocketHandler has the reset handler
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Reset from UI: infrastructure', () => {
  it('reset script shows usage on missing args', () => {
    const tsxPath = join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const scriptPath = join(process.cwd(), 'scripts', 'reset-project.ts');

    try {
      execSync(`"${tsxPath}" "${scriptPath}"`, { encoding: 'utf-8', timeout: 10000 });
    } catch (err: any) {
      // Should exit with code 1 and show usage
      expect(err.status).toBe(1);
      expect(err.stderr).toContain('Usage');
    }
  });

  it('reset script rejects invalid stage', () => {
    const tsxPath = join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const scriptPath = join(process.cwd(), 'scripts', 'reset-project.ts');

    try {
      execSync(`"${tsxPath}" "${scriptPath}" nonexistent_proj invalid_stage`, { encoding: 'utf-8', timeout: 10000 });
    } catch (err: any) {
      expect(err.status).toBe(1);
      expect(err.stderr).toMatch(/Unknown stage|not found/i);
    }
  });

  it('WebSocketHandler has handleResetProject method', () => {
    const code = readFileSync(join(process.cwd(), 'src/server/WebSocketHandler.ts'), 'utf-8');
    expect(code).toContain('handleResetProject');
    expect(code).toContain('reset_project');
  });

  it('types.ts has ResetProjectData and isResetProjectMessage', () => {
    const code = readFileSync(join(process.cwd(), 'src/server/types.ts'), 'utf-8');
    expect(code).toContain('ResetProjectData');
    expect(code).toContain('isResetProjectMessage');
    expect(code).toContain("'reset_project'");
  });

  it('frontend commands.ts sends reset_project message type', () => {
    const code = readFileSync(join(process.cwd(), 'frontend/src/lib/commands.ts'), 'utf-8');
    expect(code).toContain("type: 'reset_project'");
    expect(code).not.toContain("type: 'start_task', data: { task: `/reset");
  });
});
