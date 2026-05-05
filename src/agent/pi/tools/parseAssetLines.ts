/**
 * Pure helper that extracts asset-path "events" from a stream of text.
 *
 * scripts/run-to.ts writes lines like `    → assets/images/...png` to stdout
 * when the executor finishes a node that produced an artifact. The runScript
 * helper feeds chunks of stdout through this parser to decide which paths
 * to surface as `media_generated` chat events.
 *
 * The parser is line-aware: it buffers a partial line across chunks and only
 * emits when a newline arrives, so a path split across two chunks isn't lost
 * or duplicated.
 */

const ASSET_LINE = /^[ \t]*(?:→|->)\s+(assets\/[^\s]+\.(?:png|jpg|jpeg|webp|mp4|webm|mov))\b/i;

export interface AssetEvent {
  kind: "image" | "video";
  /** Path relative to the project root, e.g. assets/images/s1shot1_first_frame_klein_xxx.png. */
  path: string;
}

export interface AssetParserState {
  /** Partial line buffered across chunks. */
  buffer: string;
  /** Asset paths already emitted (so we don't double-fire when stdout repeats). */
  seen: Set<string>;
}

export function createAssetParser(): AssetParserState {
  return { buffer: "", seen: new Set() };
}

/**
 * Feed a chunk into the parser. Returns the asset events newly observed in
 * this chunk (in order). Mutates state so subsequent calls don't re-emit.
 */
export function feedChunk(state: AssetParserState, chunk: string): AssetEvent[] {
  const combined = state.buffer + chunk;
  const events: AssetEvent[] = [];
  // Split on newlines; the last fragment may be incomplete and goes back into the buffer.
  const lines = combined.split(/\r?\n/);
  state.buffer = lines.pop() ?? "";
  for (const line of lines) {
    const ev = parseAssetLine(line);
    if (ev && !state.seen.has(ev.path)) {
      state.seen.add(ev.path);
      events.push(ev);
    }
  }
  return events;
}

export function parseAssetLine(line: string): AssetEvent | null {
  const m = ASSET_LINE.exec(line);
  if (!m) return null;
  const path = m[1]!;
  const kind = /\.(mp4|webm|mov)$/i.test(path) ? "video" : "image";
  return { kind, path };
}
