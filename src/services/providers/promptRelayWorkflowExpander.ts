/**
 * Stamp out an N-segment prompt-relay workflow from the canonical
 * 4-segment one.
 *
 * The 4-seg JSON at workflows/built-in/ltx23_promptrelay_4seg_local.json
 * is the source of truth for sampler config, model loaders, NAG, video
 * combine, and so on. Everything that scales with segment count —
 * LoadImage nodes, per-segment INTConstant frame counts, resize chains,
 * cumulative-frame-index math, the two LTXVAddGuideMulti slot tables —
 * is rebuilt here for N segments.
 *
 * Cap: 1 ≤ N ≤ 20. Upper bound is from kijai's LTXVAddGuideMulti
 * (`for num_guides in range(1, 21)` in ComfyUI-KJNodes/ltxv_nodes.py).
 *
 * Default per-segment frame counts: 8M+1 for segment 1, 8M for the
 * rest, so total = 1 (mod 8) — which LTX latent space requires. The
 * caller can override via the `segment_N_frames` parameter mappings.
 */

const MAX_GUIDES = 20;

type NodeMap = Record<string, { inputs?: Record<string, unknown>; class_type?: string; _meta?: Record<string, unknown> }>;
export type ParameterMapping = { input: string; nodeId: string; field: string };

export interface ExpandResult {
  workflow: Record<string, unknown>;
  parameterMappings: ParameterMapping[];
}

const BASE_LOADIMAGE_IDS = ['820', '1072', '1082', '1092'];
const BASE_FRAMES_IDS    = ['950', '1074', '1084', '1094'];
// Resize chain entry points (the LTXVPreprocess output node) for the
// existing 4 segments, in segment order.
const BASE_PREPROC_IDS   = ['954:830', '1071:1067', '1081:1077', '1091:1087'];

/** Default frame count for a given segment index (1-based), LTX-aligned. */
function defaultSegmentFrames(seg1Idx: number): number {
  return seg1Idx === 1 ? 81 : 80;
}

/** Allocate fresh, collision-free node IDs for the new segments. */
function newId(prefix: string, n: number): string {
  // Use a 4-digit numeric range starting at 3000 — well clear of the
  // existing 800/1000-range IDs and the 2000-range we already used in
  // the 9-seg variant.
  return String(3000 + prefix.charCodeAt(0) * 100 + n);
}

export function expandPromptRelayWorkflow(base: NodeMap, n: number): ExpandResult {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`expandPromptRelayWorkflow: N must be an integer >= 1 (got ${n})`);
  }
  if (n > MAX_GUIDES) {
    throw new Error(`expandPromptRelayWorkflow: N must be <= ${MAX_GUIDES} (kijai LTXVAddGuideMulti cap), got ${n}`);
  }

  // Deep clone — never mutate the caller's workflow.
  const wf: NodeMap = JSON.parse(JSON.stringify(base));

  // ── 1. Per-segment LoadImage / INTConstant / resize chain ─────────
  // Reuse the existing 4 chains for the first min(N, 4) segments; for
  // N > 4 stamp out new chains; for N < 4 leave the unused base nodes
  // alone (they're orphaned but harmless — ComfyUI ignores nodes not
  // reachable from the output).
  const loadImageIds: string[] = [];
  const framesIds: string[] = [];
  const preprocIds: string[] = [];
  for (let i = 0; i < n; i++) {
    if (i < 4) {
      loadImageIds.push(BASE_LOADIMAGE_IDS[i]!);
      framesIds.push(BASE_FRAMES_IDS[i]!);
      preprocIds.push(BASE_PREPROC_IDS[i]!);
    } else {
      const seg = i + 1;
      const loadId = newId('I', seg);
      const framesId = newId('F', seg);
      const rzMaskId = newId('M', seg);
      const rzEdgeId = newId('E', seg);
      const preprocId = newId('P', seg);
      wf[loadId] = {
        inputs: { image: `placeholder_seg${seg}.png` },
        class_type: 'LoadImage',
        _meta: { title: `SEGMENT ${seg}` },
      };
      wf[framesId] = {
        inputs: { value: defaultSegmentFrames(seg) },
        class_type: 'INTConstant',
        _meta: { title: `SEGMENT ${seg} - FRAMES` },
      };
      wf[rzMaskId] = {
        inputs: {
          resize_type: 'scale dimensions',
          'resize_type.width': ['699', 0],
          'resize_type.height': ['701', 0],
          'resize_type.crop': 'center',
          scale_method: 'lanczos',
          input: [loadId, 0],
        },
        class_type: 'ResizeImageMaskNode',
        _meta: { title: `Resize Image/Mask seg${seg}` },
      };
      wf[rzEdgeId] = {
        inputs: { longer_edge: 1536, images: [rzMaskId, 0] },
        class_type: 'ResizeImagesByLongerEdge',
        _meta: { title: `Resize Images by Longer Edge seg${seg}` },
      };
      wf[preprocId] = {
        inputs: { img_compression: 18, image: [rzEdgeId, 0] },
        class_type: 'LTXVPreprocess',
        _meta: { title: `LTXVPreprocess seg${seg}` },
      };
      loadImageIds.push(loadId);
      framesIds.push(framesId);
      preprocIds.push(preprocId);
    }
  }

  // ── 2. Cumulative-offset math chain for frame_idx_3..N ────────────
  // frame_idx_1 = 0
  // frame_idx_2 = framesIds[0]                                            (sum seg 1..1)
  // frame_idx_3 = framesIds[0] + framesIds[1]                             (sum seg 1..2)
  // frame_idx_K = frame_idx_{K-1} + framesIds[K-2]
  //
  // The base workflow already provides 934 = 950 + 1074 (frame_idx_3)
  // and 935 = 934 + 1084 (frame_idx_4). Reuse them for N <= 4. For
  // N > 4, extend with new ComfyMathExpression nodes 2060+.
  // Slot N's frame_idx wiring lives at frameIdxRefs[N-1].
  const frameIdxRefs: Array<unknown> = [];
  frameIdxRefs.push(0);                                  // slot 1
  if (n >= 2) frameIdxRefs.push([framesIds[0], 0]);      // slot 2 = ['950', 0]
  if (n >= 3) frameIdxRefs.push(['934', 1]);             // slot 3 = base node 934
  if (n >= 4) frameIdxRefs.push(['935', 1]);             // slot 4 = base node 935

  let prevCum = '935';
  let prevSegFrames = framesIds[3] ?? '';   // SEG_4_FRAMES = '1094'
  // build slots 5..N
  for (let slot = 5; slot <= n; slot++) {
    const mathId = newId('C', slot);
    wf[mathId] = {
      inputs: {
        expression: 'a + b',
        'values.a': [prevCum, prevCum.match(/^\d+$/) && Number(prevCum) >= 3000 ? 1 : (prevCum === '934' || prevCum === '935' ? 1 : 0)],
        'values.b': [prevSegFrames, 0],
      },
      class_type: 'ComfyMathExpression',
      _meta: { title: `Math Expression frame_idx_${slot}` },
    };
    frameIdxRefs.push([mathId, 1]);
    prevCum = mathId;
    prevSegFrames = framesIds[slot - 1]!;
  }

  // ── 3. Rewrite both LTXVAddGuideMulti slot tables ─────────────────
  // Pass 2: node 928 (strength bus = 1118)
  // Pass 1: node 1059:1057 (strength bus = 1059:1117)
  function rewriteGuideMulti(nodeId: string, strengthBus: [string, number]) {
    const node = wf[nodeId];
    if (!node?.inputs) throw new Error(`expander: workflow missing node ${nodeId}`);
    // Drop all existing num_guides.* keys, then rebuild.
    const inp = node.inputs;
    for (const k of Object.keys(inp)) {
      if (k === 'num_guides' || k.startsWith('num_guides.')) delete inp[k];
    }
    inp['num_guides'] = String(n);
    for (let s = 1; s <= n; s++) {
      inp[`num_guides.frame_idx_${s}`] = frameIdxRefs[s - 1] as never;
      inp[`num_guides.strength_${s}`] = strengthBus as never;
      inp[`num_guides.image_${s}`] = [preprocIds[s - 1]!, 0] as never;
    }
  }
  rewriteGuideMulti('928',      ['1118', 0]);
  rewriteGuideMulti('1059:1057', ['1059:1117', 0]);

  // ── 4. Total frames on EmptyLTXVLatentVideo + LTXVEmptyLatentAudio
  const defaults = Array.from({ length: n }, (_, i) => defaultSegmentFrames(i + 1));
  const totalFrames = defaults.reduce((a, b) => a + b, 0);
  const setField = (nodeId: string, field: string, value: unknown) => {
    const node = wf[nodeId];
    if (!node?.inputs) throw new Error(`expander: workflow missing node ${nodeId}`);
    node.inputs[field] = value;
  };
  setField('1136', 'length', totalFrames);
  setField('1137', 'frames_number', totalFrames);

  // ── 5. PromptRelayEncode default segment_lengths
  setField('948', 'segment_lengths', defaults.join(', '));
  // Re-stamp default per-segment frame values for any base INTConstant
  // we still own (segments 1..min(N,4)). New ones got their default at
  // construction.
  for (let i = 0; i < Math.min(n, 4); i++) {
    setField(framesIds[i]!, 'value', defaults[i]);
  }

  // ── 6. Parameter mappings — per-segment image + frames, plus the
  // standard global/local/seed/etc passthrough.
  const parameterMappings: ParameterMapping[] = [
    { input: 'global_prompt',   nodeId: '948',  field: 'global_prompt' },
    { input: 'local_prompts',   nodeId: '948',  field: 'local_prompts' },
    { input: 'segment_lengths', nodeId: '948',  field: 'segment_lengths' },
    { input: 'negative_prompt', nodeId: '818',  field: 'text' },
    { input: 'total_frames',    nodeId: '1136', field: 'length' },
    { input: 'total_frames',    nodeId: '1137', field: 'frames_number' },
    { input: 'seed_pass1',      nodeId: '774',  field: 'noise_seed' },
    { input: 'seed_pass2',      nodeId: '773',  field: 'noise_seed' },
    { input: 'width',           nodeId: '699',  field: 'value' },
    { input: 'height',          nodeId: '701',  field: 'value' },
    { input: 'fps',             nodeId: '697',  field: 'value' },
    { input: 'image_strength',  nodeId: '1118', field: 'value' },
    { input: 'filenamePrefix',  nodeId: '757',  field: 'filename_prefix' },
  ];
  for (let s = 1; s <= n; s++) {
    parameterMappings.push({ input: `segment_${s}_image`,  nodeId: loadImageIds[s - 1]!, field: 'image' });
    parameterMappings.push({ input: `segment_${s}_frames`, nodeId: framesIds[s - 1]!,    field: 'value' });
  }

  return { workflow: wf as Record<string, unknown>, parameterMappings };
}
