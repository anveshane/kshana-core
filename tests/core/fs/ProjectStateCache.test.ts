/**
 * Tests for ProjectStateCache.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ProjectStateCache } from '../../../src/core/fs/ProjectStateCache.js';

describe('ProjectStateCache', () => {
  let cache: ProjectStateCache;

  beforeEach(() => {
    cache = new ProjectStateCache();
  });

  it('loads a snapshot and retrieves files', () => {
    cache.loadSnapshot({
      files: { '/proj/project.json': '{"id":"1"}', '/proj/plans/story.md': '# Story' },
      directories: ['/proj', '/proj/plans'],
      projectRoot: '/proj',
    });

    expect(cache.getFile('/proj/project.json')).toBe('{"id":"1"}');
    expect(cache.getFile('/proj/plans/story.md')).toBe('# Story');
  });

  it('hasFile returns true for cached files', () => {
    cache.loadSnapshot({
      files: { '/proj/a.txt': 'a' },
      directories: ['/proj'],
      projectRoot: '/proj',
    });

    expect(cache.hasFile('/proj/a.txt')).toBe(true);
    expect(cache.hasFile('/proj/b.txt')).toBeUndefined(); // unknown
  });

  it('hasFile returns true for directories', () => {
    cache.loadSnapshot({
      files: {},
      directories: ['/proj/assets'],
      projectRoot: '/proj',
    });

    expect(cache.hasFile('/proj/assets')).toBe(true);
  });

  it('setFile updates cache and clears nonExistent', () => {
    cache.markNonExistent('/proj/new.txt');
    expect(cache.hasFile('/proj/new.txt')).toBe(false);

    cache.setFile('/proj/new.txt', 'content');
    expect(cache.hasFile('/proj/new.txt')).toBe(true);
    expect(cache.getFile('/proj/new.txt')).toBe('content');
  });

  it('removeFile marks path as non-existent', () => {
    cache.setFile('/proj/a.txt', 'data');
    cache.removeFile('/proj/a.txt');
    expect(cache.hasFile('/proj/a.txt')).toBe(false);
    expect(cache.getFile('/proj/a.txt')).toBeUndefined();
  });

  it('removePath clears all entries under prefix', () => {
    cache.setFile('/proj/dir/a.txt', 'a');
    cache.setFile('/proj/dir/b.txt', 'b');
    cache.setFile('/proj/other.txt', 'c');

    cache.removePath('/proj/dir');

    expect(cache.getFile('/proj/dir/a.txt')).toBeUndefined();
    expect(cache.getFile('/proj/dir/b.txt')).toBeUndefined();
    expect(cache.getFile('/proj/other.txt')).toBe('c');
  });

  it('getStats returns correct counts', () => {
    cache.loadSnapshot({
      files: { '/a': '1', '/b': '2' },
      directories: ['/dir1', '/dir2', '/dir3'],
      assetHashes: { '/img.png': 'abc123' },
      projectRoot: '/',
    });

    const stats = cache.getStats();
    expect(stats.fileCount).toBe(2);
    expect(stats.dirCount).toBe(3);
    expect(stats.assetCount).toBe(1);
  });

  it('clear empties the entire cache', () => {
    cache.setFile('/a', 'data');
    cache.markDirectory('/dir');
    cache.clear();

    const stats = cache.getStats();
    expect(stats.fileCount).toBe(0);
    expect(stats.dirCount).toBe(0);
  });
});
