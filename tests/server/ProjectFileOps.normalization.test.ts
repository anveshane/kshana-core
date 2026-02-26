/**
 * Tests for ProjectFileOps path normalization in remote mode.
 *
 * The critical invariant: paths sent to the desktop via the WebSocket sender
 * must ALWAYS use forward slashes, regardless of the platform running the server.
 * The desktop's IPC handler (project:write-file in main.ts) uses path.normalize()
 * on receipt, so forward-slash paths work correctly on both macOS and Windows.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectFileOps } from '../../src/server/ProjectFileOps.js';

function makeRemoteFileOps() {
    const sent: Array<{ type: string; data: Record<string, unknown> }> = [];
    const sender = (type: string, data: Record<string, unknown>) => {
        sent.push({ type, data });
    };
    const ops = new ProjectFileOps();
    ops.setRemoteMode(sender, 'test-session');
    return { ops, sent };
}

describe('ProjectFileOps — path normalization in remote mode', () => {
    describe('writeFileSync', () => {
        it('sends forward-slash path for text content even when input has backslashes', () => {
            const { ops, sent } = makeRemoteFileOps();
            // Simulate a Windows-style path reaching the server
            ops.writeFileSync('C:\\Users\\demo\\.kshana\\context\\index.json', 'content');
            expect(sent).toHaveLength(1);
            expect(sent[0].type).toBe('file_write');
            expect(sent[0].data.path as string).not.toContain('\\');
            expect(sent[0].data.path as string).toContain('/');
        });

        it('sends forward-slash path for binary content even when input has backslashes', () => {
            const { ops, sent } = makeRemoteFileOps();
            const buf = Buffer.from('hello');
            ops.writeFileSync('C:\\Users\\demo\\.kshana\\agent\\image.png', buf);
            expect(sent).toHaveLength(1);
            expect(sent[0].type).toBe('file_write_binary');
            expect(sent[0].data.path as string).not.toContain('\\');
            expect(sent[0].data.path as string).toContain('/');
        });

        it('preserves forward-slash paths unchanged (macOS/Linux paths)', () => {
            const { ops, sent } = makeRemoteFileOps();
            const path = '/Users/indhicdev/Documents/Demo-3/.kshana/context/index.json';
            ops.writeFileSync(path, 'content');
            expect(sent[0].data.path).toBe(path);
        });

        it('preserves linux paths unchanged', () => {
            const { ops, sent } = makeRemoteFileOps();
            const path = '/home/demo/project/.kshana/context/index.json';
            ops.writeFileSync(path, 'content');
            expect(sent[0].data.path).toBe(path);
        });
    });

    describe('mkdirSync', () => {
        it('sends forward-slash path even when input has backslashes', () => {
            const { ops, sent } = makeRemoteFileOps();
            ops.mkdirSync('C:\\Users\\demo\\.kshana\\context', { recursive: true });
            expect(sent).toHaveLength(1);
            expect(sent[0].type).toBe('file_mkdir');
            expect(sent[0].data.path as string).not.toContain('\\');
        });

        it('preserves forward-slash paths unchanged', () => {
            const { ops, sent } = makeRemoteFileOps();
            ops.mkdirSync('/Users/demo/.kshana/context', { recursive: true });
            expect(sent[0].data.path).toBe('/Users/demo/.kshana/context');
        });
    });

    describe('rmSync', () => {
        it('sends forward-slash path even when input has backslashes', () => {
            const { ops, sent } = makeRemoteFileOps();
            // Pre-populate cache so the file "exists"
            ops.populateCache([{ path: 'C:\\Users\\demo\\.kshana\\old.md', content: '', isBinary: false }]);
            ops.rmSync('C:\\Users\\demo\\.kshana\\old.md');
            expect(sent).toHaveLength(1);
            expect(sent[0].type).toBe('file_rm');
            expect(sent[0].data.path as string).not.toContain('\\');
        });
    });

    describe('unlinkSync', () => {
        it('sends forward-slash path even when input has backslashes', () => {
            const { ops, sent } = makeRemoteFileOps();
            ops.populateCache([{ path: 'C:\\Users\\demo\\.kshana\\file.md', content: '', isBinary: false }]);
            ops.unlinkSync('C:\\Users\\demo\\.kshana\\file.md');
            expect(sent).toHaveLength(1);
            expect(sent[0].type).toBe('file_rm');
            expect(sent[0].data.path as string).not.toContain('\\');
        });
    });
});
