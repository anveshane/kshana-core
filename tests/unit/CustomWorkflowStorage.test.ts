import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorkflowRegistry, saveCustomWorkflow } from '../../src/services/comfyui/WorkflowRegistry.js';
import { analyzeWorkflow } from '../../src/services/comfyui/WorkflowAnalyzer.js';
import type { WorkflowManifest } from '../../src/services/comfyui/WorkflowAnalyzer.js';

const SAMPLE_API_WORKFLOW: Record<string, unknown> = {
  '3': {
    class_type: 'KSampler',
    inputs: { seed: 42, steps: 20, cfg: 7 },
  },
  '6': {
    class_type: 'CLIPTextEncode',
    inputs: { text: 'a sunset', clip: ['4', 1] },
    _meta: { title: 'Positive Prompt' },
  },
  '7': {
    class_type: 'CLIPTextEncode',
    inputs: { text: 'bad quality', clip: ['4', 1] },
    _meta: { title: 'Negative Prompt' },
  },
  '5': {
    class_type: 'EmptyLatentImage',
    inputs: { width: 1024, height: 1024, batch_size: 1 },
  },
  '9': {
    class_type: 'SaveImage',
    inputs: { filename_prefix: 'output', images: ['8', 0] },
  },
};

describe('Custom Workflow Storage', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kshana-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('saveCustomWorkflow', () => {
    it('creates workflows directory and saves files', () => {
      const manifest = analyzeWorkflow(SAMPLE_API_WORKFLOW, 'test-wf', 'Test Workflow');
      const { apiWorkflowPath, manifestPath } = saveCustomWorkflow(
        tmpDir,
        'test-wf',
        SAMPLE_API_WORKFLOW,
        manifest,
      );

      expect(fs.existsSync(apiWorkflowPath)).toBe(true);
      expect(fs.existsSync(manifestPath)).toBe(true);
      expect(apiWorkflowPath).toContain('test-wf.api.json');
      expect(manifestPath).toContain('test-wf.manifest.json');
    });

    it('saves valid JSON that can be parsed back', () => {
      const manifest = analyzeWorkflow(SAMPLE_API_WORKFLOW, 'roundtrip');
      const { apiWorkflowPath, manifestPath } = saveCustomWorkflow(
        tmpDir,
        'roundtrip',
        SAMPLE_API_WORKFLOW,
        manifest,
      );

      const savedWorkflow = JSON.parse(fs.readFileSync(apiWorkflowPath, 'utf-8'));
      const savedManifest: WorkflowManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

      expect(savedWorkflow).toEqual(SAMPLE_API_WORKFLOW);
      expect(savedManifest.name).toBe('roundtrip');
      expect(savedManifest.parameterMap.positivePrompt).toBeDefined();
    });
  });

  describe('WorkflowRegistry.loadCustomWorkflows', () => {
    it('loads saved custom workflows into registry', () => {
      const manifest = analyzeWorkflow(SAMPLE_API_WORKFLOW, 'custom-loaded');
      saveCustomWorkflow(tmpDir, 'custom-loaded', SAMPLE_API_WORKFLOW, manifest);

      const registry = new WorkflowRegistry();
      registry.loadCustomWorkflows(tmpDir);

      const loaded = registry.get('custom-loaded');
      expect(loaded).toBeDefined();
      expect(loaded!.custom).toBe(true);
      expect(loaded!.displayName).toBe('custom-loaded');
      expect(loaded!.workflowType).toBe('image_generation');
      expect(loaded!.outputFormat).toBe('image');
      expect(loaded!.apiWorkflowPath).toContain('custom-loaded.api.json');
      expect(loaded!.manifestPath).toContain('custom-loaded.manifest.json');
    });

    it('skips manifests without corresponding api.json', () => {
      const manifest = analyzeWorkflow(SAMPLE_API_WORKFLOW, 'orphan');
      const workflowsDir = path.join(tmpDir, 'workflows');
      fs.mkdirSync(workflowsDir, { recursive: true });
      fs.writeFileSync(
        path.join(workflowsDir, 'orphan.manifest.json'),
        JSON.stringify(manifest),
      );
      // Intentionally don't create orphan.api.json

      const registry = new WorkflowRegistry();
      registry.loadCustomWorkflows(tmpDir);

      expect(registry.get('orphan')).toBeUndefined();
    });

    it('handles missing workflows directory gracefully', () => {
      const registry = new WorkflowRegistry();
      // Should not throw
      registry.loadCustomWorkflows(path.join(tmpDir, 'nonexistent'));
      // Built-in workflows should still be there
      expect(registry.get('zimage')).toBeDefined();
    });

    it('custom workflows appear in listAll and toDict', () => {
      const manifest = analyzeWorkflow(SAMPLE_API_WORKFLOW, 'my-custom');
      saveCustomWorkflow(tmpDir, 'my-custom', SAMPLE_API_WORKFLOW, manifest);

      const registry = new WorkflowRegistry();
      registry.loadCustomWorkflows(tmpDir);

      const all = registry.listAll();
      expect(all.some(w => w.name === 'my-custom')).toBe(true);

      const dict = registry.toDict();
      const customEntry = dict.workflows.find(w => w.name === 'my-custom');
      expect(customEntry).toBeDefined();
      expect(customEntry!.custom).toBe(true);
    });
  });
});
