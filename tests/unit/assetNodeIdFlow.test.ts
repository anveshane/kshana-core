/**
 * Tests for the asset nodeId data flow: server → frontend store → Sidebar.
 *
 * Verifies that nodeId is not lost at any step in the chain.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Asset nodeId data flow', () => {
  it('webui-routes enriches assets with nodeId from executor state', () => {
    const code = readFileSync(join(process.cwd(), 'src/server/webui-routes.ts'), 'utf-8');
    expect(code).toContain('asset.nodeId');
    expect(code).toContain('pathToNode');
  });

  it('ProjectSelector type annotation includes nodeId', () => {
    const code = readFileSync(join(process.cwd(), 'frontend/src/components/ProjectSelector.tsx'), 'utf-8');
    // The map type MUST include nodeId or the spread will lose it
    expect(code).toMatch(/\.map\(\(a:.*nodeId/);
  });

  it('store asset type includes nodeId', () => {
    const code = readFileSync(join(process.cwd(), 'frontend/src/lib/store.ts'), 'utf-8');
    expect(code).toMatch(/assets:.*nodeId\?.*string/s);
  });

  it('Sidebar reads nodeId from asset', () => {
    const code = readFileSync(join(process.cwd(), 'frontend/src/components/Sidebar.tsx'), 'utf-8');
    expect(code).toContain('asset.nodeId');
  });

  it('Sidebar gates edit/redo on nodeId being truthy', () => {
    const code = readFileSync(join(process.cwd(), 'frontend/src/components/Sidebar.tsx'), 'utf-8');
    expect(code).toMatch(/nodeId && !isBusy/);
  });
});
