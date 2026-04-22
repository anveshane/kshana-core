/**
 * Dynamically build a ComfyUI API-format workflow that invokes
 * GrokImageEditNode (model `grok-imagine-image-beta`) with 1 base
 * image + 0..4 reference images, aggregated through BatchImagesNode.
 *
 * Why a dynamic builder instead of parameterizing a static template:
 *   - BatchImagesNode's `images.imageN` slots are mandatory inputs in
 *     API format — "bypass" is UI-only. Omitting a slot fails submission.
 *   - Building the JSON in code lets us produce exactly-N-slot workflows
 *     per call, with no dead LoadImage nodes.
 *
 * Empirical constraints (verified via probe-grok-batch-2img.ts):
 *   - BatchImagesNode aggregates — 2-image input → 1 output (multi-ref).
 *     The older AILab_ImageToList iterated (2-image → 2 outputs), which
 *     silently broke multi-ref. BatchImagesNode is the correct choice.
 *   - `grok-imagine-image-beta` caps at 5 image refs total per call.
 *     Our builder enforces that: 1 base + up to 4 refs = 5 images.
 *   - Input keys are literal dot-notation strings ("images.image0"),
 *     not nested objects — that's ComfyUI's syntax for dynamic input
 *     groups on this node.
 *
 * Node layout (IDs match the user-tested template for visual parity):
 *   3  → SaveImage                    ← GrokImageEditNode (8) output
 *   6  → LoadImage (base)             → BatchImagesNode.images.image0
 *   8  → GrokImageEditNode            ← BatchImagesNode (9)
 *   9  → BatchImagesNode
 *   10.. → LoadImage (ref i)          → BatchImagesNode.images.image{i+1}
 */

export type GrokResolution = '1K' | '2K' | '4K';
export type GrokAspectRatio = 'auto' | '1:1' | '16:9' | '9:16' | '4:3' | '3:4';

export interface GrokEditWorkflowInput {
  /** Uploaded filename of the base image (ComfyUI input/ folder name). */
  baseImage: string;
  /** Uploaded filenames of reference images. Max 2 — GrokImageEditNode on ComfyUI Cloud caps at 3 total images. */
  refs: string[];
  /** Full edit instruction prose. */
  prompt: string;
  /** Random seed for reproducibility. */
  seed: number;
  /** Prefix for the SaveImage output filename. */
  filenamePrefix: string;
  /** Grok output resolution. Default 1K. */
  resolution?: GrokResolution;
  /** Grok aspect ratio. Default 'auto'. */
  aspectRatio?: GrokAspectRatio;
}

// GrokImageEditNode on ComfyUI Cloud rejects >3 input images with
// `ValueError: A maximum of 3 input images is supported.` — so 1 base +
// 2 refs. Verified empirically on 2026-04-22.
const MAX_REFS = 2;
const LOADIMAGE_START_ID = 10; // refs start at node 10, 11, 12, 13

export function buildGrokEditWorkflow(input: GrokEditWorkflowInput): Record<string, unknown> {
  const {
    baseImage,
    refs,
    prompt,
    seed,
    filenamePrefix,
    resolution = '1K',
    aspectRatio = 'auto',
  } = input;

  if (refs.length > MAX_REFS) {
    throw new Error(
      `Grok workflow supports up to ${MAX_REFS} refs (3 images total including base — GrokImageEditNode cap). Got ${refs.length}.`,
    );
  }

  // Common nodes: SaveImage, LoadImage(base), GrokImageEditNode
  const workflow: Record<string, unknown> = {
    '3': {
      inputs: {
        filename_prefix: filenamePrefix,
        images: ['8', 0],
      },
      class_type: 'SaveImage',
      _meta: { title: 'Save Image' },
    },
    '6': {
      inputs: { image: baseImage },
      class_type: 'LoadImage',
      _meta: { title: 'Load Image' },
    },
    '8': {
      inputs: {
        model: 'grok-imagine-image-beta',
        prompt,
        resolution,
        number_of_images: 1,
        seed,
        aspect_ratio: aspectRatio,
        // image wired below depending on whether we need BatchImagesNode
      },
      class_type: 'GrokImageEditNode',
      _meta: { title: 'Grok Image Edit' },
    },
  };

  const grokInputs = (workflow['8'] as { inputs: Record<string, unknown> }).inputs;

  if (refs.length === 0) {
    // 0-ref edit: skip BatchImagesNode. It requires images.image1 as a
    // mandatory input and fails validation with `required_input_missing`
    // when only image0 is populated. Wire the base LoadImage straight
    // into GrokImageEditNode's `image` input instead.
    grokInputs['image'] = ['6', 0];
  } else {
    // >=1 ref: BatchImagesNode aggregates base + refs into one list.
    // Dot-notation keys are literal — ComfyUI's syntax for dynamic input
    // groups on this node.
    const batchInputs: Record<string, unknown> = {
      'images.image0': ['6', 0],
    };
    workflow['9'] = {
      inputs: batchInputs,
      class_type: 'BatchImagesNode',
      _meta: { title: 'Batch Images' },
    };
    grokInputs['image'] = ['9', 0];

    refs.forEach((refFilename, i) => {
      const nodeId = String(LOADIMAGE_START_ID + i);
      workflow[nodeId] = {
        inputs: { image: refFilename },
        class_type: 'LoadImage',
        _meta: { title: 'Load Image' },
      };
      batchInputs[`images.image${i + 1}`] = [nodeId, 0];
    });
  }

  return workflow;
}
