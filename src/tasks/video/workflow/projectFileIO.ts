import * as fs from 'fs';
import * as path from 'path';

import { getCurrentSession, getSessionFs } from '../../../core/fs/index.js';
import { getActiveProjectDir } from './activeProject.js';

interface RemoteProjectCacheLike {
  getFile(path: string): string | undefined;
  setFile(path: string, content: string): void;
  hasFile(path: string): boolean | undefined;
  markDirectory(path: string): void;
}

interface RemoteSocketLike {
  readyState?: number;
  send(payload: string): void;
}

interface RemoteProjectFsLike {
  getCache?: () => RemoteProjectCacheLike | null;
  socket?: RemoteSocketLike;
}

function looksAbsolute(targetPath: string): boolean {
  return path.isAbsolute(targetPath) || /^[A-Za-z]:[\\/]/.test(targetPath);
}

function getRemoteProjectFs(): RemoteProjectFsLike | null {
  const session = getCurrentSession();
  if (session?.mode !== 'remote') {
    return null;
  }

  return getSessionFs() as RemoteProjectFsLike;
}

function getRemoteProjectCache(): RemoteProjectCacheLike | null {
  return getRemoteProjectFs()?.getCache?.() ?? null;
}

function normalizeProjectRelativePath(
  targetPath: string,
  basePath: string = process.cwd(),
): string {
  const trimmed = targetPath.trim();
  if (!trimmed) {
    return '';
  }

  const projectRoot = getProjectRoot(basePath);
  const normalizedTarget = trimmed.replace(/\\/g, '/');
  const relativePath = looksAbsolute(trimmed)
    ? path.relative(projectRoot, trimmed)
    : normalizedTarget;
  const normalizedRelative = path.posix
    .normalize(relativePath.replace(/\\/g, '/'))
    .replace(/^\.\/+/, '');

  if (
    normalizedRelative === '..' ||
    normalizedRelative.startsWith('../') ||
    normalizedRelative === '.' ||
    normalizedRelative === ''
  ) {
    if (normalizedRelative === '' || normalizedRelative === '.') {
      return '';
    }
    throw new Error(`Path escapes project root: ${targetPath}`);
  }

  return normalizedRelative;
}

function markRemoteDirectory(relativeDir: string): void {
  const cache = getRemoteProjectCache();
  if (!cache || !relativeDir) {
    return;
  }

  const segments = relativeDir.split('/').filter(Boolean);
  let current = '';
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    cache.markDirectory(current);
  }
}

function sendRemoteProjectCommand(type: string, data: Record<string, unknown>): void {
  const remoteFs = getRemoteProjectFs();
  const socket = remoteFs?.socket;
  if (!socket || socket.readyState !== 1) {
    throw new Error(`Remote project filesystem is not connected for ${type}`);
  }

  socket.send(JSON.stringify({ type, data }));
}

function ensureProjectParent(relativePath: string, basePath: string = process.cwd()): void {
  const parentDir = path.posix.dirname(relativePath);
  if (parentDir && parentDir !== '.') {
    ensureProjectDir(parentDir, basePath);
  }
}

export function getProjectRoot(basePath: string = process.cwd()): string {
  const activeProjectDir = getActiveProjectDir();
  if (looksAbsolute(activeProjectDir)) {
    return activeProjectDir;
  }
  return path.join(basePath, activeProjectDir);
}

export function projectPath(
  relativePath: string,
  basePath: string = process.cwd(),
): string {
  const normalizedRelative = normalizeProjectRelativePath(relativePath, basePath);
  return normalizedRelative
    ? path.join(getProjectRoot(basePath), normalizedRelative)
    : getProjectRoot(basePath);
}

export function projectRelativePath(
  targetPath: string,
  basePath: string = process.cwd(),
): string {
  return normalizeProjectRelativePath(targetPath, basePath);
}

export function isWithinProjectRoot(
  targetPath: string,
  basePath: string = process.cwd(),
): boolean {
  try {
    normalizeProjectRelativePath(targetPath, basePath);
    return true;
  } catch {
    return false;
  }
}

export function ensureProjectDir(
  relativeDir: string,
  basePath: string = process.cwd(),
): void {
  const normalizedRelative = normalizeProjectRelativePath(relativeDir, basePath);
  const remoteFs = getRemoteProjectFs();

  if (!remoteFs) {
    fs.mkdirSync(projectPath(normalizedRelative, basePath), { recursive: true });
    return;
  }

  if (!normalizedRelative) {
    return;
  }

  markRemoteDirectory(normalizedRelative);
  sendRemoteProjectCommand('file_mkdir_command', {
    path: normalizedRelative,
    options: { recursive: true },
  });
}

export function writeProjectText(
  relativePath: string,
  content: string,
  basePath: string = process.cwd(),
): void {
  const normalizedRelative = normalizeProjectRelativePath(relativePath, basePath);
  if (!normalizedRelative) {
    throw new Error('writeProjectText requires a file path inside the project root');
  }

  ensureProjectParent(normalizedRelative, basePath);

  const remoteFs = getRemoteProjectFs();
  if (!remoteFs) {
    fs.writeFileSync(projectPath(normalizedRelative, basePath), content, 'utf-8');
    return;
  }

  getRemoteProjectCache()?.setFile(normalizedRelative, content);
  sendRemoteProjectCommand('file_write_command', {
    path: normalizedRelative,
    content,
  });
}

export function readProjectText(
  relativePath: string,
  basePath: string = process.cwd(),
): string | null {
  const normalizedRelative = normalizeProjectRelativePath(relativePath, basePath);
  if (!normalizedRelative) {
    return null;
  }

  const remoteFs = getRemoteProjectFs();
  if (!remoteFs) {
    const resolvedPath = projectPath(normalizedRelative, basePath);
    if (!fs.existsSync(resolvedPath)) {
      return null;
    }
    return fs.readFileSync(resolvedPath, 'utf-8');
  }

  return getRemoteProjectCache()?.getFile(normalizedRelative) ?? null;
}

export function writeProjectBuffer(
  relativePath: string,
  data: Buffer,
  basePath: string = process.cwd(),
): void {
  const normalizedRelative = normalizeProjectRelativePath(relativePath, basePath);
  if (!normalizedRelative) {
    throw new Error('writeProjectBuffer requires a file path inside the project root');
  }

  ensureProjectParent(normalizedRelative, basePath);

  const remoteFs = getRemoteProjectFs();
  if (!remoteFs) {
    fs.writeFileSync(projectPath(normalizedRelative, basePath), data);
    return;
  }

  sendRemoteProjectCommand('file_write_buffer_command', {
    path: normalizedRelative,
    data: data.toString('base64'),
  });
}

export function ensureProjectPathDir(
  targetDir: string,
  basePath: string = process.cwd(),
): boolean {
  if (!isWithinProjectRoot(targetDir, basePath)) {
    return false;
  }

  ensureProjectDir(projectRelativePath(targetDir, basePath), basePath);
  return true;
}

export function writeProjectBufferAtPath(
  targetPath: string,
  data: Buffer,
  basePath: string = process.cwd(),
): boolean {
  if (!isWithinProjectRoot(targetPath, basePath)) {
    return false;
  }

  writeProjectBuffer(projectRelativePath(targetPath, basePath), data, basePath);
  return true;
}

export function projectExists(
  relativePath: string,
  basePath: string = process.cwd(),
): boolean {
  const normalizedRelative = normalizeProjectRelativePath(relativePath, basePath);
  if (!normalizedRelative) {
    return fs.existsSync(getProjectRoot(basePath));
  }

  const remoteFs = getRemoteProjectFs();
  if (!remoteFs) {
    return fs.existsSync(projectPath(normalizedRelative, basePath));
  }

  return getRemoteProjectCache()?.hasFile(normalizedRelative) ?? false;
}
