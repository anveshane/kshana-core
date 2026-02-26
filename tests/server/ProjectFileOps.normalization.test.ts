/**
 * Tests for ProjectFileOps path normalization in remote mode.
 *
 * Protocol v3 invariant:
 * - outbound payloads must include relativePath (project-relative POSIX path)
 * - path is a temporary compatibility mirror of relativePath
 */

import { describe, expect, it } from 'vitest';
import { ProjectFileOps } from '../../src/server/ProjectFileOps.js';

function makeRemoteFileOps(projectRoot: string) {
  const sent: Array<{ type: string; data: Record<string, unknown> }> = [];
  const sender = (type: string, data: Record<string, unknown>) => {
    sent.push({ type, data });
  };
  const ops = new ProjectFileOps();
  ops.setRemoteMode(sender, 'test-session', undefined, { projectRoot });
  return { ops, sent };
}

describe('ProjectFileOps — path normalization in remote mode', () => {
  describe('writeFileSync', () => {
    it('sends project-relative POSIX path for windows absolute input', () => {
      const { ops, sent } = makeRemoteFileOps('C:/Users/demo');
      ops.writeFileSync(
        'C:\\Users\\demo\\.kshana\\context\\index.json',
        'content',
      );
      expect(sent).toHaveLength(1);
      expect(sent[0].type).toBe('file_write');
      expect(sent[0].data.relativePath).toBe('.kshana/context/index.json');
      expect(sent[0].data.path).toBe('.kshana/context/index.json');
    });

    it('sends project-relative POSIX path for binary content', () => {
      const { ops, sent } = makeRemoteFileOps('/Users/demo/project');
      const buf = Buffer.from('hello');
      ops.writeFileSync('/Users/demo/project/.kshana/agent/image.png', buf);
      expect(sent).toHaveLength(1);
      expect(sent[0].type).toBe('file_write_binary');
      expect(sent[0].data.relativePath).toBe('.kshana/agent/image.png');
      expect(sent[0].data.path).toBe('.kshana/agent/image.png');
    });

    it('preserves relative POSIX paths unchanged', () => {
      const { ops, sent } = makeRemoteFileOps('/Users/demo/project');
      ops.writeFileSync('.kshana/context/index.json', 'content');
      expect(sent[0].data.relativePath).toBe('.kshana/context/index.json');
    });

    it('converts linux absolute paths to project-relative paths', () => {
      const { ops, sent } = makeRemoteFileOps('/home/demo/project');
      ops.writeFileSync('/home/demo/project/.kshana/context/index.json', 'content');
      expect(sent[0].data.relativePath).toBe('.kshana/context/index.json');
    });

    it('rejects outbound writes outside project root', () => {
      const { ops } = makeRemoteFileOps('/home/demo/project');
      expect(() =>
        ops.writeFileSync('/etc/passwd', 'content'),
      ).toThrow(/outside project root/i);
    });
  });

  describe('mkdirSync', () => {
    it('sends relativePath for directory creation', () => {
      const { ops, sent } = makeRemoteFileOps('/Users/demo/project');
      ops.mkdirSync('/Users/demo/project/.kshana/context', { recursive: true });
      expect(sent).toHaveLength(1);
      expect(sent[0].type).toBe('file_mkdir');
      expect(sent[0].data.relativePath).toBe('.kshana/context');
      expect(sent[0].data.path).toBe('.kshana/context');
    });
  });

  describe('rmSync', () => {
    it('sends relativePath for removals', () => {
      const { ops, sent } = makeRemoteFileOps('/Users/demo/project');
      ops.populateCache([
        {
          path: '/Users/demo/project/.kshana/old.md',
          content: '',
          isBinary: false,
        },
      ]);
      ops.rmSync('/Users/demo/project/.kshana/old.md');
      expect(sent).toHaveLength(1);
      expect(sent[0].type).toBe('file_rm');
      expect(sent[0].data.relativePath).toBe('.kshana/old.md');
    });
  });

  describe('unlinkSync', () => {
    it('sends relativePath for unlink', () => {
      const { ops, sent } = makeRemoteFileOps('/Users/demo/project');
      ops.populateCache([
        {
          path: '/Users/demo/project/.kshana/file.md',
          content: '',
          isBinary: false,
        },
      ]);
      ops.unlinkSync('/Users/demo/project/.kshana/file.md');
      expect(sent).toHaveLength(1);
      expect(sent[0].type).toBe('file_rm');
      expect(sent[0].data.relativePath).toBe('.kshana/file.md');
    });
  });
});
