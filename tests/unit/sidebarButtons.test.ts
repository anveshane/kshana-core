/**
 * Tests that edit/redo buttons on asset thumbnails are always visible
 * when nodeId exists, regardless of agent busy status.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Sidebar asset buttons visibility', () => {
  it('edit/redo buttons are NOT gated on isBusy', () => {
    const code = readFileSync(join(process.cwd(), 'frontend/src/components/Sidebar.tsx'), 'utf-8');
    // The hover overlay buttons should check nodeId but NOT isBusy
    // Find the line with nodeId check near the edit/redo buttons
    // The condition should be just {nodeId && ( — NOT {nodeId && !isBusy && (
    expect(code).toContain('{nodeId && (');
    expect(code).not.toMatch(/\{nodeId && !isBusy/);
  });

  it('edit button requires onRedoNodeWithPrompt prop', () => {
    const code = readFileSync(join(process.cwd(), 'frontend/src/components/Sidebar.tsx'), 'utf-8');
    expect(code).toContain('onRedoNodeWithPrompt && (');
  });

  it('redo button requires onRedoNode prop', () => {
    const code = readFileSync(join(process.cwd(), 'frontend/src/components/Sidebar.tsx'), 'utf-8');
    expect(code).toContain('onRedoNode && (');
  });
});
