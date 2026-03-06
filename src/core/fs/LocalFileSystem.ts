/**
 * LocalFileSystem - IFileSystem implementation using Node.js fs/promises.
 *
 * Used in co-located mode (Electron + embedded server) and CLI mode.
 * All operations go directly to the local disk.
 */

import * as fsp from 'fs/promises';
import * as fs from 'fs';
import type { IFileSystem, FileStat } from './IFileSystem.js';

export class LocalFileSystem implements IFileSystem {
  async readFile(path: string): Promise<string> {
    return fsp.readFile(path, 'utf-8');
  }

  async writeFile(path: string, content: string): Promise<void> {
    await fsp.writeFile(path, content, 'utf-8');
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fsp.access(path, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async mkdir(path: string, options?: { recursive: boolean }): Promise<void> {
    await fsp.mkdir(path, options);
  }

  async readdir(path: string): Promise<string[]> {
    return fsp.readdir(path);
  }

  async stat(path: string): Promise<FileStat> {
    const stats = await fsp.stat(path);
    return {
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      size: stats.size,
    };
  }

  async copyFile(src: string, dest: string): Promise<void> {
    await fsp.copyFile(src, dest);
  }

  async deleteFile(path: string): Promise<void> {
    await fsp.unlink(path);
  }

  async deleteDir(path: string): Promise<void> {
    await fsp.rm(path, { recursive: true, force: true });
  }

  async readFileBuffer(path: string): Promise<Buffer> {
    return fsp.readFile(path);
  }

  async writeFileBuffer(path: string, data: Buffer): Promise<void> {
    await fsp.writeFile(path, data);
  }

  async writeBatch(operations: Array<{ path: string; content: string }>): Promise<void> {
    // Local filesystem: write sequentially (atomic enough for single-machine use)
    for (const op of operations) {
      await fsp.writeFile(op.path, op.content, 'utf-8');
    }
  }
}
