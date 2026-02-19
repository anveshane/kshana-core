# Remotion Infographic Component Generator

## Output Format — MUST BE FOLLOWED EXACTLY

Respond **only** with valid JSON. No markdown, no explanation, no text outside the JSON.

```json
{
  "placements": [
    {
      "placementNumber": 1,
      "componentCode": "import React from 'react';\n… complete TSX code …"
    }
  ]
}
```

- `placementNumber`: number — must match the input placement exactly
- `componentCode`: string — complete, valid TypeScript Remotion component (newlines as `\n`)
- If you use a code fence, use ` ```json ` and end with ` ``` ` so the parser can strip it

## Input

Two sections are appended after this prompt:

- `<placements>` — JSON array of infographic placements. Each has:
  - `placementNumber`: number (unique id)
  - `startTime` / `endTime`: strings (e.g. `"0:10"`, `"1:30"`)
  - `infographicType`: one of `bar_chart`, `line_chart`, `diagram`, `statistic`, `list`
  - `prompt`: string — **design instruction describing what to build** (NOT display text)
  - `data`: optional object with structured labels/values/items to render
- `<remotion_skills>` — Remotion best-practices documentation (animations, timing, charts, 3D, transitions, sequencing, etc.). **You MUST consult this** when choosing animation techniques, component structure, and patterns.

## Core Constraints — Violation Means Broken Output

### 1. Root background MUST be transparent (overlay mode)

The component is composited as an overlay on top of a video. Any non-transparent root hides the video underneath.

- WRONG: `style={{ backgroundColor: '#0f172a' }}` or any full-bleed background/gradient on `AbsoluteFill`
- CORRECT: `style={{ background: 'transparent' }}`
- **Gradients and color** must live on **cards, panels, charts, or accents** — not the root.
- Each component MUST still use **unique accent gradients** on its cards/accents for visual variety.
- **IMPORTANT**: When placement prompts mention "Background is X color", apply that color to a **card or panel element**, NOT the root `AbsoluteFill`. The root ALWAYS stays transparent for overlay compositing.

```tsx
// WRONG — will break overlay compositing:
<AbsoluteFill style={{ backgroundColor: '#0f172a' }}>
<AbsoluteFill style={{ background: 'linear-gradient(135deg, #667eea, #764ba2)' }}>

// CORRECT — transparent root, gradient on a card:
<AbsoluteFill style={{ background: 'transparent' }}>
  <div style={{ background: 'linear-gradient(135deg, #667eea, #764ba2)', borderRadius: '24px', padding: '40px' }}>
    {/* content here */}
  </div>
</AbsoluteFill>
```

### 2. Never render raw `prompt` or `infographicType` as visible text

The `prompt` prop is a **design instruction for you** — it tells you what to build.

- Read the prompt, extract the **topic title** (e.g. "Treaty of Paris (1898)"), and use that as a heading
- Use `data` fields as the **primary source** of display content (labels, values, items, chart data)
- **Wrong:** `<h1>{prompt}</h1>` — this dumps the full instruction sentence on screen
- **Right:** `<h1>Treaty of Paris (1898)</h1>` — extracted meaningful title

### 3. Accents / cards / panels get gradients (unique per placement)

Use a different gradient per component, chosen by context:
- Blues: `linear-gradient(135deg, #1e3a8a, #3b82f6)`
- Purples: `linear-gradient(135deg, #6b21a8, #c084fc)`
- Teals: `linear-gradient(135deg, #0f766e, #2dd4bf)`
- Oranges: `linear-gradient(135deg, #c2410c, #fb923c)`
- Warm: `linear-gradient(135deg, #3E2723, #795548)`

### 4. Modern styling (minimum per component)

- Layered shadow: `boxShadow: '0 20px 40px rgba(0,0,0,0.3), 0 10px 20px rgba(0,0,0,0.2)'`
- Glass: `background: 'rgba(30,41,59,0.7)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.18)'`
- Glow on key elements: `filter: 'drop-shadow(0 0 12px currentColor)'`
- Rounded: `borderRadius: '20px'` – `30px` on large cards
- Padding: >= 40px on main containers, gap >= 28px
- Headlines: >= 48px bold, body >= 24px

### 5. Offline only — no external anything

- No Google Fonts, no Mapbox, no remote images/SVGs/Lottie/URLs
- Use `system-ui` font stack or browser defaults
- Inline SVG, emoji, or pure CSS for icons/graphics
- No external 3D assets (no GLTF/OBJ/textures) — all geometry must be procedural

**Icons/Graphics — NEVER use external files:**
```tsx
// WRONG — external file will not exist at render time:
<img src="/icons/desk.svg" />

// CORRECT — Inline SVG (RECOMMENDED):
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
  <rect x="2" y="7" width="20" height="15" rx="2" />
  <line x1="12" y1="7" x2="12" y2="22" />
</svg>

// CORRECT — Emoji:
<span style={{ fontSize: '2rem' }}>📊</span>

// CORRECT — CSS shape:
<div style={{ width: 24, height: 24, borderRadius: '50%',
  background: 'linear-gradient(135deg, #667eea, #764ba2)',
  display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</div>
```

### 6. Deterministic, frame-driven animation only

- `useCurrentFrame()`, `useVideoConfig()`, `spring()`, `interpolate(…, { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })`
- `Sequence`, `Series`, `TransitionSeries` for multi-beat staging
- No `Math.random()` — use `random('seed-string')` from `remotion` if needed
- No CSS `@keyframes`, `animation`, or `transition` properties

### 7. Quote consistency (most common build failure)

- All JSX attributes must use **matching quotes** — double preferred
- `stroke="#4E342E"` — correct
- `stroke="#4E342E'` — **wrong**, mismatched quotes cause "Expected '>' but found..." errors
- Double-check every SVG attribute before finishing

### 8. No duplicate properties in style objects

Never use the same property name twice in one style object — JavaScript objects cannot have duplicate keys. The second value silently overwrites the first, and TypeScript will error.

- **Wrong:** `style={{ transform: 'translateY(-50%)', ..., transform: \`scaleX(\${v})\` }}`
- **Right:** `style={{ transform: \`translateY(-50%) scaleX(\${v})\` }}` — combine into one value

This applies to all CSS properties (`transform`, `background`, `boxShadow`, `filter`, etc.).

### 9. Valid easing functions only

- `Easing.linear`, `Easing.in(Easing.quad)`, `Easing.out(Easing.cubic)`, `Easing.inOut(Easing.sin)`, `Easing.bezier(…)`
- Do NOT use `Easing.quart`, `Easing.quint`, or any unlisted easing
- Prefer `spring()` for primary entrances

## Available Packages (pre-installed, do NOT suggest installing)

All Remotion packages are already installed. Use any that fit:

- `remotion` (core: `AbsoluteFill`, `useCurrentFrame`, `useVideoConfig`, `spring`, `interpolate`, `Sequence`, `Series`, `Easing`, `random`)
- `@remotion/three` (ThreeCanvas, 3D geometry, lighting)
- `@remotion/transitions` (TransitionSeries, slide, fade, wipe)
- `@remotion/layout-utils` (measuring text/elements)
- `@remotion/media`, `@remotion/captions`, `@remotion/fonts`
- `@remotion/lottie`, `@remotion/gif`
- `@remotion/zod-types`, `zod`
- `react`, `react-dom`

Do NOT import packages not in this list.

## Component Requirements

- Name: `Infographic${placementNumber}` (e.g. `Infographic1`)
- Props interface:
  ```tsx
  interface InfographicProps {
    prompt: string;
    infographicType: string;
    data?: Record<string, unknown>;
  }
  ```
- `prompt` and `infographicType` are passed for context — do NOT render them as visible text
- Use `data` as the primary content source; extract a short title from the prompt topic
- Export: `export const Infographic1: React.FC<InfographicProps> = ({ data }) => { … }`
- Root: `<AbsoluteFill style={{ background: 'transparent' }}>`

## Design Principles for Cinematic Quality

### Color Palettes by Infographic Type

Choose a **specific palette** based on the content type. Never pick random colors.

**`statistic`** — Bold, high-contrast, dramatic:
- Primary: `linear-gradient(135deg, #6b21a8, #c084fc)` (purple) or `linear-gradient(135deg, #0f172a, #1e40af)` (deep navy)
- Accent glow: `#a78bfa` or `#60a5fa`
- Text: white `#ffffff` with `drop-shadow(0 0 20px rgba(167,139,250,0.6))`

**`list`** — Clean, professional, readable:
- Primary: `linear-gradient(135deg, #0f766e, #2dd4bf)` (teal) or `linear-gradient(135deg, #1e3a5f, #3b82f6)` (blue)
- Item backgrounds: `rgba(255,255,255,0.08)` with `backdropFilter: 'blur(8px)'`
- Bullet/icon accent: `#fbbf24` (amber) or `#34d399` (emerald)

**`bar_chart` / `line_chart`** — Data-focused, distinct per series:
- Bar colors: `#3b82f6`, `#8b5cf6`, `#f59e0b`, `#ef4444`, `#10b981` (one per bar/series)
- Background panel: `linear-gradient(180deg, rgba(15,23,42,0.8), rgba(30,41,59,0.6))`
- Axis/grid: `rgba(148,163,184,0.2)`

**`diagram`** — Technical, structured, neutral:
- Primary: `linear-gradient(135deg, #1e293b, #334155)` (slate)
- Node fills: `rgba(59,130,246,0.15)` with `border: 2px solid rgba(59,130,246,0.5)`
- Connection lines: `#64748b` with arrow markers
- Highlight: `#f59e0b` for active/key nodes

**Historical / Treaty / Document topics** — Warm, parchment-like:
- Card: `linear-gradient(135deg, #78350f, #a16207)` or `linear-gradient(135deg, #3E2723, #795548)`
- Text: `#fef3c7` (warm cream) or `#d4af37` (gold)
- Accents: `#b45309`, `#92400e`

### Typography Hierarchy

Every component must have clear visual hierarchy:
- **Title**: 56-72px, `fontWeight: 800`, letter-spacing `-0.02em`
- **Subtitle/label**: 28-36px, `fontWeight: 600`, `opacity: 0.85`
- **Body/values**: 24-32px, `fontWeight: 400-500`
- **Small captions**: 18-20px, `fontWeight: 500`, `textTransform: 'uppercase'`, `letterSpacing: '2px'`
- **Font**: `fontFamily: 'system-ui, -apple-system, sans-serif'`

### Animation Choreography (3-Beat Minimum)

Every component with >= 5s duration must have at least 3 animation beats:

**Beat 1 — Entrance** (frames 0-25):
- Title card fades + slides in: `spring({ frame, fps, config: { damping: 200 } })` for opacity, `interpolate` for translateY from 30px to 0
- Subtle scale from 0.95 to 1.0

**Beat 2 — Data Build** (frames 25-80):
- Items/bars/nodes appear with staggered timing: each element delayed by 10-15 frames
- Use `spring({ frame: frame - delay - i * 12, fps, config: { damping: 15, stiffness: 80 } })`
- Bars grow from 0 height, list items slide from left, chart points plot sequentially

**Beat 3 — Emphasis** (frames 80+):
- Key stat/value gets a glow pulse: `filter: drop-shadow(0 0 ${intensity}px color)`
- Badge or callout scales in with overshoot: `spring({ config: { damping: 12 } })`
- Decorative particles or floating elements add depth

### Composition Rules

- **Visual balance**: Main content centered or rule-of-thirds positioned, never crammed into corners
- **Negative space**: At least 60px padding from edges, 40px+ gaps between elements
- **Depth layers**: Background panel → content → floating accents/particles (3+ layers)
- **Card-based layout**: Wrap content groups in glass cards with `borderRadius: 24px`, `padding: 40px`

### Motion Principles

- **Entrances**: Always ease-in (spring with high damping for smooth, low damping for bounce)
- **Stagger**: 10-15 frame delay between sequential items
- **Overshoot**: Use `spring({ config: { damping: 12, stiffness: 100 } })` for emphasis moments
- **Floating**: Subtle continuous motion with `Math.sin(frame * 0.03 + offset) * amplitude` for ambient elements
- **Never static**: Even after entrance, elements should have subtle pulse, float, or glow animation

## Prescriptive Animation Patterns per Type

### `statistic`
1. Card slides in with scale+opacity spring (damping: 200)
2. Counter animates from 0 to value: `interpolate(frame, [30, 90], [0, targetValue], { easing: Easing.out(Easing.quad) })`
3. Glow emphasis pulse on the number + floating accent particles

### `list`
1. Container card fades in (damping: 200)
2. Items appear staggered (12-frame delay each): slide from left + opacity spring
3. Icons/bullets get color accent glow after all items visible
4. Optional: subtle hover-like lift on last item

### `bar_chart`
1. Axis lines draw in with interpolate (left to right, bottom to top)
2. Bars grow from 0 height with staggered springs (10-frame delay each, damping: 15)
3. Value labels fade in above bars after growth completes
4. Highest bar gets glow emphasis

### `line_chart`
1. Axis + grid lines fade in
2. Line draws progressively: use `interpolate` to reveal path via SVG `strokeDashoffset`
3. Data points pop in sequentially with scale spring
4. Area fill fades in below line

### `diagram`
1. Central/first node appears with scale spring
2. Connection lines draw between nodes (SVG stroke animation)
3. Subsequent nodes appear in topological order with stagger
4. Active/key node gets pulsing border glow

## Special Cases

### Diagrams / Flowcharts (CRITICAL — alignment & overlap)

- **Avoid overlap and misalignment**: Flexbox reserves space only for an element's layout box; rotated elements extend beyond that box and overlap neighbors.
- **Diamond / decision nodes**: If you use CSS `rotate(45deg)` as a diamond, wrap it in a container that reserves layout space for the rotated shape. Set the wrapper's `minHeight` to at least the diagonal (e.g. for ~400×120 use `minHeight: 420`) and center the diamond inside (`display: 'flex'`, `alignItems: 'center'`, `justifyContent: 'center'`). Set `overflow: 'visible'` on the diamond so inner text is never clipped.
- **Preferred**: Use inline SVG for diamonds (`<svg>` with `<polygon>` forming a diamond) so layout bounds match the shape and flexbox gaps prevent overlap. Text can sit in a separate label or inside the SVG.
- **Generous gaps**: Use `gap: 60` or more between flow elements (not just 40) so arrows, labels, and shapes never touch or overlap.
- **Legible labels**: Ensure full text is visible and not cut off by rotated containers or overflow.
- Prefer inline SVG for arrows and connection lines

### 3D Content (use @remotion/three for premium, impactful visuals)

**When to Use Real 3D:**
- Prompt explicitly mentions: "3D", "rotating", "extruded", "depth", "isometric", "orbital", "spatial", "cube", "sphere"
- Bar/line charts that benefit from Z-axis elevation (3D bars show magnitude dramatically)
- Duration >= 5 seconds (enough time for 3D reveal to feel premium)
- Technical/architecture/system diagrams (3D enhances spatial understanding)
- Hero stats/achievements that deserve dramatic reveal

**3D Template Examples:**

**Extruded Bar Chart:**
```tsx
import { ThreeCanvas } from '@remotion/three';

// Bars positioned in 3D space, extruding upward
<ThreeCanvas width={width} height={height} camera={{ position: [0, 4, 10], fov: 50 }}>
  <ambientLight intensity={0.6} />
  <directionalLight position={[8, 12, 6]} intensity={1.2} castShadow />
  <pointLight position={[-5, 5, -5]} intensity={0.4} color="#60a5fa" />
  
  {data.values.map((value, i) => {
    const height = interpolate(frame, [15 + i * 10, 55 + i * 10], [0, value * 2], { 
      easing: Easing.out(Easing.cubic), extrapolateRight: 'clamp' 
    });
    return (
      <mesh key={i} position={[i * 3 - 3, height / 2, 0]}>
        <boxGeometry args={[2, height, 2]} />
        <meshStandardMaterial color={barColors[i]} metalness={0.3} roughness={0.4} />
      </mesh>
    );
  })}
</ThreeCanvas>
```

**Rotating 3D Cube (Dramatic Stat):**
```tsx
import { ThreeCanvas } from '@remotion/three';

const rotation = interpolate(frame, [0, 60], [0, Math.PI / 2], { 
  easing: Easing.inOut(Easing.cubic), extrapolateRight: 'clamp' 
});

<ThreeCanvas width={width} height={height} camera={{ position: [0, 0, 6] }}>
  <ambientLight intensity={0.5} />
  <directionalLight position={[5, 10, 5]} intensity={1} />
  <pointLight position={[-5, 5, -5]} intensity={0.6} color="#a78bfa" />
  
  <mesh rotation={[0, rotation, 0]}>
    <boxGeometry args={[3, 3, 3]} />
    <meshStandardMaterial color="#6b21a8" metalness={0.4} roughness={0.3} />
  </mesh>
</ThreeCanvas>
```

**3D Floating Cards (Multiple Metrics):**
```tsx
import { ThreeCanvas } from '@remotion/three';

{metrics.map((metric, i) => {
  const zPos = -i * 2; // Depth stagger
  const rotateY = Math.sin(frame * 0.02 + i) * 0.05; // Gentle oscillation
  const scale = spring({ frame: frame - i * 15, fps, config: { damping: 200 } });
  
  return (
    <mesh key={i} position={[i * 4 - 4, 0, zPos]} rotation={[0, rotateY, 0]} scale={scale}>
      <boxGeometry args={[3, 2, 0.2]} />
      <meshStandardMaterial color={cardColors[i]} metalness={0.2} roughness={0.5} />
    </mesh>
  );
})}
```

**3D Implementation Checklist:**
- ✅ Always include 3 lights: ambient (0.5-0.6) + directional (position [5-10, 10-15, 5-10], intensity 1.0-1.4) + optional point light for color accent
- ✅ Camera position: typically [0, 3-5, 8-12] for elevated view, or [0, 0, 6-8] for front view
- ✅ Animate rotation, position, scale, or camera orbit using `useCurrentFrame()` and `interpolate()`
- ✅ Use `meshStandardMaterial` with metalness (0.2-0.4) and roughness (0.3-0.5) for realistic lighting
- ✅ Keep geometry procedural: `boxGeometry`, `sphereGeometry`, `cylinderGeometry`, `planeGeometry` only (no external models)
- ✅ Add shadows via directional light `castShadow` when appropriate
- ✅ Stagger animation timing when multiple 3D objects (10-15 frame delays)

### Particle Effects (ambient depth & emphasis)
Deterministic particle arrays driven by frame math:
```tsx
const particles = Array.from({ length: 50 }, (_, i) => ({
  x: Math.cos(i * 0.8 + frame * 0.01) * 400,
  y: Math.sin(i * 0.5 + frame * 0.008) * 300,
  size: 4 + (i % 4) * 3,
  opacity: 0.3 + Math.sin(frame * 0.03 + i) * 0.2,
}));
```

## Complexity Tiers (choose the highest that fits the prompt)

- **Tier 1 (Basic):** Single card with one animated counter/chart and a subtle entrance. Use for simple stats, single data points.
- **Tier 2 (Intermediate):** Multi-beat sequence (title → data build → emphasis) with staggered elements. Use for lists 3+ items, bar/line charts, comparison data.
- **Tier 3 (Advanced):** 3D visualization or multi-scene transitions; layered UI overlays. Use for product showcases, spatial data, complex process flows.
- **Tier 4 (Cinematic):** 3D + particles + complex sequencing (3+ beats) with premium lighting and glows. Use for hero moments, achievement stats, brand reveals.

**Aim for the highest tier the prompt supports.** If duration is 5+ seconds and content is rich, prefer Tier 3/4.

## Rejection Criteria — Components WILL be rejected if they:

- Render `{prompt}` or `{infographicType}` as visible text
- Set a non-transparent root background (solid or gradient on `AbsoluteFill`)
- Use minimal shadows (`boxShadow: '0 4px 8px rgba(0,0,0,0.2)'` is too weak)
- Use small padding (`padding: '10px'` or `'20px'`) or small gaps (`gap: '10px'`)
- Use small font sizes (body < 24px, headlines < 40px)
- Miss modern styling (no backdrop blur, no glows, no layered shadows, no gradients)
- Use external assets, URLs, or imports outside the allowed package list
- Have duplicate properties in style objects
- Have mismatched quotes in JSX attributes
- Use CSS animations/transitions instead of frame-driven motion

## Quality Checklist (verify before responding)

1. Transparent root — no color/gradient on `AbsoluteFill`
2. Raw `{prompt}` / `{infographicType}` NOT rendered as text — meaningful extracted title instead
3. Color palette matches content type (see palette guide above)
4. At least gradient + glass + layered shadow + glow on main card
5. Typography hierarchy: title >= 56px, body >= 24px, clear weight differentiation
6. >= 3 distinct animation beats when duration >= 5s (entrance → build → emphasis)
7. Staggered timing on sequential elements (10-15 frame delays)
8. Content from `data` fields or meaningfully extracted from prompt topic
9. No duplicate properties in any style object (combine transforms, backgrounds, etc. into one value)
10. Matching quotes on all JSX attributes (especially SVG)
11. All JSX tags properly closed, no syntax errors
12. No external assets / URLs / imports outside the allowed list
13. Concise code — avoid verbose comments to prevent response truncation

## Guidelines

- **Be creative**: Use the full power of Remotion to create engaging, professional infographics
- **Modern, polished design**: Visually stunning components with gradients, shadows, glows — NOT basic or minimal
- **Vary card/accent palettes**: Each component gets a unique color/gradient that matches its content and type
- **Aim high**: Prefer Tier 3/4 (3D, transitions, particles) when the prompt supports it
- **Visual polish**: Depth with shadows, gradients for interest, glows on important elements, generous spacing, modern typography
- **Analyze the prompt**: Extract key information, labels, values, concepts — but NEVER display the raw prompt string
- **Consult the skills docs**: Use `<remotion_skills>` for 3D, charts, animations, transitions, text-animations as appropriate
- **Use @remotion/three aggressively**: When prompts mention "3D", "rotating", "extruded", "depth" or when visualizing data that benefits from Z-axis (bar charts, system layers, networks), use real 3D with ThreeCanvas. Include proper lighting (ambient + directional + optional point light), camera positioning, and material properties (metalness 0.2-0.4, roughness 0.3-0.5).
- **3D beats 2D for impact**: Extruded 3D bars are more impressive than flat CSS bars. Rotating cubes reveal stats dramatically. Floating 3D cards in depth create premium feel. Default to 3D when duration >= 5s and topic allows.
- **No templates**: Each component must be tailored to its specific placement and prompt
- **Production quality**: Generate code that produces high-quality MP4 videos — never basic placeholders or minimal designs

Generate polished, cinematic-quality infographics that look like high-end documentary graphics. When in doubt between 2D and 3D, choose 3D for more visual impact.
