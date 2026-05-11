/**
 * Classify a JSON-output validation error as "structural" or "semantic".
 *
 * Why we care:
 *
 * The executor's retry flow today is:
 *
 *   broken output → json_repair LLM call → still broken → full retry
 *
 * `json_repair`'s prompt is literally "fix the broken JSON". That's
 * useful when the failure is structural (`JSON parse error`,
 * `Unterminated string`, schema-level "shots: Required") — the JSON
 * is malformed and another LLM pass can patch the syntax.
 *
 * It's useless when the failure is semantic — the JSON is perfectly
 * formed but violates a project rule the schema enforces beyond the
 * type level. Examples:
 *
 *   - "No reference to any known character / setting / object found …"
 *     (LLM hallucinated unrelated content)
 *   - "OTS-with-single-character violation. last_frame: …"
 *   - "shotNumber mismatch: expected 3, got 5"
 *   - "ref-mention check failed: …"
 *
 * json_repair has no way to fix these — the JSON syntax is already
 * valid; the content needs a different LLM roll, not a syntax patch.
 * Wasting a json_repair call just to get the same semantic error back
 * is a tax on every hallucination.
 *
 * Routing structural→json_repair-then-retry and semantic→retry-only
 * cuts one LLM call out of every semantic-failure path and lets us
 * inject the actual validation error into the retry prompt as
 * corrective guidance, instead of the generic "your output MUST be
 * valid JSON" the structural retry uses.
 *
 * Pure — string in, label out.
 */

export type ValidationErrorClass = 'structural' | 'semantic';

/**
 * Patterns that indicate a JSON-syntax or schema-shape failure. Match
 * any of these and the output isn't even well-formed JSON of the
 * expected shape — json_repair can plausibly fix it.
 *
 * Listed explicitly (rather than "everything not on the semantic
 * list") because the validation surface keeps growing — better to
 * over-classify-as-semantic-and-skip-repair than over-classify-as-
 * structural-and-waste-a-call.
 */
const STRUCTURAL_PATTERNS: RegExp[] = [
  /^JSON parse error/i,
  /SyntaxError:/i,
  /Unexpected token/i,
  /Unterminated string/i,
  /Unexpected end of JSON/i,
  /Expected double-quoted property name/i,
  // Zod-level "field is missing" / "expected type X, received Y" —
  // these are about JSON SHAPE, which a structural fix can address.
  /: Required$/m,
  /^Required$/m,
  /Expected \w+, received \w+/i,
  /Invalid input/i,
  /must contain at least/i,
];

/**
 * Classify a validation error string.
 *
 * Defaults to 'semantic' for unrecognised errors. That's the safe
 * choice: a semantic classification skips one LLM call (json_repair)
 * and goes directly to the full retry with the error injected into
 * the prompt — the retry still has the same shot at fixing things,
 * just one call cheaper.
 */
export function classifyValidationError(error: string): ValidationErrorClass {
  if (!error) return 'semantic';
  for (const pattern of STRUCTURAL_PATTERNS) {
    if (pattern.test(error)) return 'structural';
  }
  return 'semantic';
}

/**
 * Build the system-prompt suffix to use for a retry attempt. For
 * structural failures we use the existing "your output MUST be valid
 * JSON" line (the LLM doesn't know what shape we want from the error
 * alone, the schema in the system prompt is what guides it). For
 * semantic failures we inject the actual error message so the LLM has
 * targeted corrective guidance — "you forgot character X" beats
 * "make sure it's valid JSON" every time.
 */
export function buildRetrySystemSuffix(
  errorClass: ValidationErrorClass,
  error: string,
): string {
  if (errorClass === 'structural') {
    return '\n\nCRITICAL: Your output MUST be valid JSON. Do not include markdown, backticks, or any text outside the JSON object.';
  }
  // Semantic — inject the error verbatim, plus a short directive to
  // address it specifically. The error messages from validators are
  // already user-facing prose (e.g. "No reference to any known
  // character / setting / object found in the imagePrompt or
  // references[]. Expected at least one of: character_image:protagonist.")
  // so they read well in the prompt.
  return `\n\nCRITICAL: Your previous attempt was REJECTED for the following reason — fix it and try again:\n\n${error}\n\nOutput ONLY valid JSON.`;
}
