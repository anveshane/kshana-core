/**
 * Vision-LLM describer used by the supervisor loop.
 *
 * Pi-agent is always the judge. This helper just turns an image
 * (path + prompt context) into a plain-text description that pi-agent
 * reads inside a `[SYSTEM EVENT]` message and acts on. Returns null
 * — never throws — when:
 *   - VLM_PROVIDER / VLM_API_KEY / VLM_MODEL aren't set in env. The
 *     first such skip logs ONE warning per process; subsequent skips
 *     are silent so a 200-asset run doesn't spam stderr.
 *   - The underlying call throws (network blip, API error, etc.).
 *     Operational failures are not warned — the missing-config
 *     warning slot is reserved for actually-fixable config errors.
 *
 * The describer is injectable for tests. Default: build an
 * `LLMClient` from `getVLMConfig()` and call `chatWithImage`.
 */
import { LLMClient } from "./LLMClient.js";
import { getVLMConfig } from "./getVLMConfig.js";

export type DescribeImageFn = (
  imagePath: string,
  prompt: string,
) => Promise<string>;

let warned = false;

const DESCRIBE_SYSTEM_PROMPT =
  "You are a vision encoder. Look at the image and describe it in 2-3 sentences, focusing on subjects, action, framing, and lighting. Note anything that conflicts with the user-provided prompt. Plain prose, no preface, no bullet points.";

function defaultDescriber(): DescribeImageFn | null {
  const config = getVLMConfig();
  if (!config) return null;
  const llm = new LLMClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
  });
  return async (imagePath, prompt) => {
    const userText = `Prompt this image was generated for: "${prompt}"\n\nDescribe what you see.`;
    return llm.chatWithImage(imagePath, userText, DESCRIBE_SYSTEM_PROMPT);
  };
}

export async function describeImageWithVLM(
  imagePath: string,
  prompt: string,
  describer?: DescribeImageFn,
): Promise<string | null> {
  const fn = describer ?? defaultDescriber();
  if (!fn) {
    if (!warned) {
      // eslint-disable-next-line no-console
      console.warn(
        "[VLM] VLM_PROVIDER / VLM_API_KEY / VLM_MODEL not set — VLM calls will be skipped. The pi-agent oversight loop runs without vision feedback for asset events.",
      );
      warned = true;
    }
    return null;
  }
  try {
    return await fn(imagePath, prompt);
  } catch {
    // Operational failure — the supervisor will run with
    // `vlm_description: (none)` for this asset. Not config-missing,
    // so don't burn the once-per-process warning.
    return null;
  }
}

/** Test-only — clear the once-per-process warning latch. */
export function __resetVLMWarningForTesting(): void {
  warned = false;
}
