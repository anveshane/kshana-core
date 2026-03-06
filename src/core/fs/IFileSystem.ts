/**
 * IFileSystem - Abstract file system interface.
 *
 * Allows swapping between LocalFileSystem (direct disk access)
 * and RemoteClientFileSystem (WebSocket-proxied file ops).
 */

export interface FileStat {
  isFile: boolean;
  isDirectory: boolean;
  size: number;
}

export interface IFileSystem {
  /** Read a text file */
  readFile(path: string): Promise<string>;

  /** Write a text file */
  writeFile(path: string, content: string): Promise<void>;

  /** Check if a path exists */
  exists(path: string): Promise<boolean>;

  /** Create a directory (optionally recursive) */
  mkdir(path: string, options?: { recursive: boolean }): Promise<void>;

  /** List directory contents */
  readdir(path: string): Promise<string[]>;

  /** Get file/directory stats */
  stat(path: string): Promise<FileStat>;

  /** Copy a file */
  copyFile(src: string, dest: string): Promise<void>;

  /** Delete a file */
  deleteFile(path: string): Promise<void>;

  /** Delete a directory recursively */
  deleteDir(path: string): Promise<void>;

  /** Read a file as Buffer (for binary data) */
  readFileBuffer(path: string): Promise<Buffer>;

  /** Write a Buffer to a file (for binary data) */
  writeFileBuffer(path: string, data: Buffer): Promise<void>;

  /** Atomic batch write — all files written or none */
  writeBatch(operations: Array<{ path: string; content: string }>): Promise<void>;
}
