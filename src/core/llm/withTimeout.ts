/**
 * Race a promise against a wall-clock timeout.
 *
 * `LLMClient.generate()` has a 200 s OpenAI client-level timeout but no
 * per-call abort hook, and in practice it does not fire reliably for
 * long-tail calls (esp. JSON-mode responses on the heavy tier). Wrap any
 * call you don't want to hang the executor in `withTimeout(...)` with a
 * tighter ceiling. Timeouts throw, which lets the caller fall through to
 * a fallback path.
 *
 * @param p      the promise to race
 * @param ms     timeout in milliseconds — when this elapses, the
 *               returned promise rejects with a labelled Error.
 * @param label  identifier for the call site, included in the timeout
 *               error message so debug logs can pinpoint which call hung.
 *
 * Inner rejections pass through unchanged — only timeouts are converted
 * into the labelled Error.
 */
export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`LLM call timed out after ${ms / 1000}s: ${label}`));
    }, ms);
  });
  try {
    return await Promise.race([p, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
