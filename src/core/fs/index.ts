/**
 * File system abstraction module.
 *
 * Provides IFileSystem interface, LocalFileSystem implementation,
 * RemoteClientFileSystem for WebSocket-proxied ops,
 * ProjectStateCache for server-side caching,
 * and SessionContext for per-session state management.
 */

export type { IFileSystem, FileStat } from './IFileSystem.js';
export { LocalFileSystem } from './LocalFileSystem.js';
export { RemoteClientFileSystem } from './RemoteClientFileSystem.js';
export { ProjectStateCache, type ProjectSnapshot } from './ProjectStateCache.js';
export {
  type SessionContext,
  type SessionMode,
  getCurrentSession,
  requireSession,
  getSessionFs,
  getSessionProjectDir,
  setSessionProjectDir,
  runInSession,
  runInSessionAsync,
  createLocalSession,
  createRemoteSession,
  setDefaultProjectDir,
  getDefaultProjectDir,
} from './SessionContext.js';
