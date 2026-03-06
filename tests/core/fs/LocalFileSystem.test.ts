/**
 * Tests for LocalFileSystem — verifies the IFileSystem implementation works correctly.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { LocalFileSystem } from '../../../src/core/fs/LocalFileSystem.js';

const TEST_DIR = join(process.cwd(), '.test-localfs');

describe('LocalFileSystem', () => {
  let fs: LocalFileSystem;

  beforeEach(() => {
    fs = new LocalFileSystem();
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('writes and reads a text file', async () => {
    const filePath = join(TEST_DIR, 'hello.txt');
    await fs.writeFile(filePath, 'hello world');
    const content = await fs.readFile(filePath);
    expect(content).toBe('hello world');
  });

  it('exists returns true for existing file', async () => {
    const filePath = join(TEST_DIR, 'exists.txt');
    writeFileSync(filePath, 'data');
    expect(await fs.exists(filePath)).toBe(true);
  });

  it('exists returns false for missing file', async () => {
    expect(await fs.exists(join(TEST_DIR, 'nope.txt'))).toBe(false);
  });

  it('mkdir creates nested directories', async () => {
    const dir = join(TEST_DIR, 'a', 'b', 'c');
    await fs.mkdir(dir, { recursive: true });
    expect(await fs.exists(dir)).toBe(true);
  });

  it('readdir lists directory contents', async () => {
    writeFileSync(join(TEST_DIR, 'one.txt'), '1');
    writeFileSync(join(TEST_DIR, 'two.txt'), '2');
    const entries = await fs.readdir(TEST_DIR);
    expect(entries.sort()).toEqual(['one.txt', 'two.txt']);
  });

  it('stat returns correct info', async () => {
    const filePath = join(TEST_DIR, 'stat.txt');
    writeFileSync(filePath, 'content');
    const stat = await fs.stat(filePath);
    expect(stat.isFile).toBe(true);
    expect(stat.isDirectory).toBe(false);
    expect(stat.size).toBeGreaterThan(0);
  });

  it('deleteFile removes a file', async () => {
    const filePath = join(TEST_DIR, 'delete-me.txt');
    writeFileSync(filePath, 'bye');
    await fs.deleteFile(filePath);
    expect(await fs.exists(filePath)).toBe(false);
  });

  it('copyFile copies content', async () => {
    const src = join(TEST_DIR, 'src.txt');
    const dest = join(TEST_DIR, 'dest.txt');
    writeFileSync(src, 'copied');
    await fs.copyFile(src, dest);
    expect(await fs.readFile(dest)).toBe('copied');
  });

  it('writeBatch writes multiple files', async () => {
    await fs.writeBatch([
      { path: join(TEST_DIR, 'a.txt'), content: 'aaa' },
      { path: join(TEST_DIR, 'b.txt'), content: 'bbb' },
    ]);
    expect(await fs.readFile(join(TEST_DIR, 'a.txt'))).toBe('aaa');
    expect(await fs.readFile(join(TEST_DIR, 'b.txt'))).toBe('bbb');
  });

  it('readFileBuffer and writeFileBuffer handle binary', async () => {
    const filePath = join(TEST_DIR, 'binary.bin');
    const data = Buffer.from([0x00, 0xff, 0x42, 0x13]);
    await fs.writeFileBuffer(filePath, data);
    const read = await fs.readFileBuffer(filePath);
    expect(Buffer.compare(read, data)).toBe(0);
  });
});
