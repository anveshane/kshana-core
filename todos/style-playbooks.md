# Style Playbooks — Machine-Readable Visual Design Specifications

## Problem

Visual styles are currently unstructured markdown hints consumed by the LLM (e.g., "anime", "cinematic realism"). The `StyleConfig` type has `aspectRatio`, `resolution`, and some string fields, but there are no machine-readable specs for typography, color palette, motion styles, or asset generation constraints. This means:

- Remotion infographics can't auto-apply consistent theming
- Image generation prompts don't get structured negative prompts or style anchors
- There's no way to enforce visual consistency across all generated assets
- Style information is lost between LLM calls

## Feature

A `StylePlaybook` system — structured, typed design specifications that define the visual language of a video and feed into every generation and rendering step.

## Playbook Structure

```typescript
interface StylePlaybook {
  id: string;
  name: string;                    // "Cinematic Realism"
  description: string;

  typography: {
    headingFont: string;           // "Inter"
    bodyFont: string;              // "Source Sans Pro"
    monoFont?: string;             // "JetBrains Mono"
    headingWeight: number;         // 700
    bodyWeight: number;            // 400
    sizeScale: 'minor_third' | 'major_third' | 'perfect_fourth';
    lineHeight: number;            // 1.5
  };

  colorPalette: {
    primary: string;               // "#2563EB"
    secondary: string;             // "#7C3AED"
    accent: string;                // "#F59E0B"
    background: string;            // "#0F172A"
    surface: string;               // "#1E293B"
    text: string;                  // "#F8FAFC"
    muted: string;                 // "#94A3B8"
  };

  motionStyle: {
    transitionTypes: string[];     // ['fade', 'slide', 'dissolve']
    defaultTransitionMs: number;   // 500
    entranceAnimation: string;     // 'fade-up'
    exitAnimation: string;         // 'fade-out'
    pacingBpm?: number;            // for rhythm-aligned cuts
    cameraMovement: string[];      // ['slow-pan', 'zoom-in']
    holdDuration: { min: number; max: number }; // seconds per shot
  };

  assetGeneration: {
    promptPrefix: string;          // "cinematic lighting, shallow depth of field"
    negativePrompt: string;        // "cartoon, anime, low quality, watermark"
    consistencyAnchors: string[];  // ["warm color grading", "natural skin tones"]
    preferredAspectRatio: string;  // "16:9"
  };

  audioProfile?: {
    musicMood: string;             // "ambient electronic"
    musicVolume: number;           // 0.15
    duckingDb: number;             // -14
    sfxStyle: string;              // "subtle, organic"
  };
}
```

## Built-in Playbooks

| ID | Name | Key Characteristics |
|---|---|---|
| `cinematic-realism` | Cinematic Realism | Shallow DOF, warm grading, slow pans, fade transitions |
| `anime` | Anime / Animation | Bold outlines, vibrant colors, snap transitions, flat lighting |
| `clean-professional` | Clean Professional | Sans-serif typography, blue palette, minimal motion, corporate |
| `flat-motion-graphics` | Flat Motion Graphics | Bold colors, spring physics, bouncy entrances, geometric shapes |
| `watercolor` | Watercolor / Artistic | Soft edges, pastel palette, gentle dissolves, organic textures |
| `minimalist-diagram` | Minimalist Diagram | Monochrome + accent, precise lines, simple fades, technical |

## Implementation Approach

### New File: `src/core/templates/StylePlaybook.ts`

Define the type and built-in playbooks. Export `getPlaybook(id)` and `listPlaybooks()`.

### Integration Points

1. **Remotion themes** — Map `colorPalette` and `typography` to the theme system in `remotion-infographics/src/shared/themes.ts`. When rendering infographics, apply the active playbook's theme automatically.

2. **Image generation prompts** — Inject `assetGeneration.promptPrefix` and `assetGeneration.negativePrompt` into image generation tool calls. The prompt builder in `src/core/prompts/` should append these when a playbook is active.

3. **Video generation** — Use `motionStyle.cameraMovement` hints in video generation prompts. Use `motionStyle.holdDuration` to validate shot durations in the timeline.

4. **FFmpeg assembly** — Use `motionStyle.transitionTypes` and `motionStyle.defaultTransitionMs` when building transition filters between segments.

5. **Subtitle styling** — If subtitle generation is implemented, use `typography` and `colorPalette` for subtitle font, size, and colors.

6. **LLM context** — Serialize the active playbook to a concise markdown block and inject into the system prompt so the LLM's creative decisions align with the visual language.

7. **Template integration** — Add optional `defaultPlaybook` field to `VideoTemplate`. Add optional `playbook` override to project config.

8. **Web UI** — Playbook selector in project creation, with a visual preview showing color swatches and sample typography.

### Precedence

Project playbook override > Template default playbook > No playbook (current behavior)
