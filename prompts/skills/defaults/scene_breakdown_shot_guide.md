**PURPOSE**: Expand a single shot from a pre-approved scene plan into its full breakdown. The plan has already decided shot count, ordering, purpose, and duration — your job is to fill in cameraWork, perspective, focus, audio, and transition for ONE shot. **Do not change the plan's `shotNumber`, `purpose`, or `duration`.** Treat them as inputs, not suggestions.

You will receive:
- `<scene_plan>`: the full Stage A plan for the whole scene (so you have continuity context — what came before this shot and what comes after).
- `<this_shot>`: the single plan entry you are expanding (`shotNumber`, `purpose`, `duration`, `oneLineSummary`, optional `perspective` and `continuityRole`).
- `<available_refs>`: the canonical refId list for this project.

Output a SINGLE shot object matching the `<json_schema>` provided in your system prompt.

---

## Canonical refIds — USE EXACTLY, NEVER INVENT

Whenever you write a character, setting, or object reference — `perspectiveOf`, `focus.primary`, `focus.background[]`, `focus.lurking` — you MUST use the exact refId string from the `<available_refs>` block.

Do NOT paraphrase, normalize casing, drop punctuation, or "fix" spellings. The refId is a database key — if the profile is `johnathan_o'hare`, write `johnathan_o'hare` (with the apostrophe). Downstream code looks up per-item nodes by these exact strings; any mismatch silently breaks reference image resolution.

If this shot needs an entity that isn't in `<available_refs>`, describe it by prose in `description` instead of referring to it by refId. Never invent a refId.

---

## Reference cap per shot — 4 maximum

Across the union of references this shot pulls in via `focus.primary`, `focus.background[]`, `focus.lurking` (plus the scene-level `mainSubject` / `secondarySubject` when they appear in this shot), a single shot must reference at most 4 distinct entities. The image generator has 4 reference slots total. Slot 1 is reserved for the setting (the base canvas). Drop priority when over: extra settings first (keep one), then non-mainSubject characters, then the secondary subject. Never put a character in `focus.background[]` purely as decoration — it costs a slot.

---

## Required Fields — No Exceptions

Every shot object MUST contain these fields. Missing or empty fields = broken output.

| Field | Type | Description |
|---|---|---|
| `shotNumber` | number | **Copy from `<this_shot>` — do not change.** |
| `purpose` | string | **Copy from `<this_shot>` — do not change.** |
| `duration` | number | **Copy from `<this_shot>` — do not change.** Already calculated for dialogue fit. |
| `description` | string | 1–2 sentence visual brief — expand the `oneLineSummary` |
| `cameraWork` | string | Start with framing, then angle and movement |
| `audio` | string | Everything heard — dialogue, ambient, effects, or silence |
| `transition` | string | How this shot transitions FROM the previous shot |

Recommended (set when meaningful): `perspective`, `perspectiveOf`, `focus`, `continuityRole`.

```json
{
  "shotNumber": 1,
  "purpose": "set_the_mood",
  "duration": 4,
  "description": "Raindrops strike a brass bell, each impact sending tiny ripples across the wet metal.",
  "cameraWork": "extreme close-up, macro, static, shallow DOF on bell surface",
  "audio": "metallic ring of rain on brass, distant thunder rumble",
  "transition": "fade",
  "focus": { "primary": "brass_bell", "background": [] },
  "continuityRole": "none"
}
```

---

## Dialogue — Fit the Pre-Allocated Duration

The plan has already set `duration` to fit the dialogue word count. Your job is to:

1. Place the dialogue in `audio` with the correct `NAME:` prefix.
2. Verify the line you write fits within the `duration` you were given (rate of ~2.5 words/sec, +1s buffer).
3. **One speaker per shot** — `audio` must contain at most ONE `NAME:` pattern. Ambient sound after the dialogue is fine ("cicada hum, distant traffic"), but never a second speaker.
4. If the dialogue you'd need to write doesn't fit `duration`, that's the plan's bug — flag it via the description but do not change `duration`. Trim the dialogue to fit if you can do so without losing meaning.

---

## Perspective — WHOSE POV IS THIS SHOT FROM

Every `show_action` and `meet_character` shot MUST declare `perspective`. Other shots SHOULD declare it when meaningful.

| Perspective | When to use |
|---|---|
| `main_subject` | POV or over-the-shoulder of the scene's mainSubject. **Default flow — majority of shots.** |
| `secondary_subject` | POV or OTS of secondarySubject. Use for reaction reversals in dialogue. |
| `observer` | Neutral third-person. Use when neither character's viewpoint should dominate. |
| `overhead` | High-angle/birds-eye looking down. Use for spatial establishing or subject-feels-small moments. |
| `god` | Impossible omniscient viewpoint. Reserve for scale moments. |

**Flow rules:**
- Shots should GENERALLY follow the mainSubject — non-overhead perspectives default to `main_subject` unless the story calls for a reversal.
- When the mainSubject is meeting a new character, use `main_subject` perspective (we see through THEIR eyes as the other person enters).
- Reserve `overhead`/`god` for specific spatial or tonal moments, not casual use.
- For dialogue scenes, alternate `main_subject` and `secondary_subject` to create the shot/reverse-shot rhythm — check `<scene_plan>` for what the previous shot used.

**Hard rule — NEVER write `over-the-shoulder` (or OTS) into `cameraWork` when only ONE character is in this shot.** OTS is inherently a two-character composition: foreground anchor (blurred) + focal subject (sharp). With a single character, the image model either invents a phantom second character or breaks focus. For tight intimate framings of one character (camera angled over their own shoulder, focusing on hands or an object), use `insert`, `extreme_close_up`, or `close_up` in `cameraWork` instead — and write the subject as the focal element (hands, object, face detail), not the character themselves. The `perspective` field can remain `main_subject` for these intimate single-character shots; just don't pair it with OTS framing in `cameraWork`.

**`perspectiveOf` field:** If the shot's perspective is tied to a specific character, set `perspectiveOf` to their refId. When omitted and perspective is `main_subject`, it defaults to `mainSubject`.

---

## Focus — WHAT'S SHARP VS BLURRED

The `focus` object (recommended for non-establishing shots) specifies what's razor-sharp and what's defocused:

```json
"focus": {
  "primary": "laila_face",
  "background": ["bronze_seal", "vikram_shoulder"],
  "lurking": "cloaked_figure"
}
```

- **`primary`** (required if focus is used): what's razor-sharp — refId preferred, prose allowed (e.g., `"bronze_seal"`, `"vikram_face"`, `"the torn letter"`).
- **`background`**: visible but blurred elements — characters/objects we can see but are not the focal point.
- **`lurking`** (optional): a defocused element planted for a later focus-pull. If this shot sets `lurking: cloaked_figure`, a later shot in `<scene_plan>` should pull `focus.primary: cloaked_figure` as the focus pull payoff.

**Use focus to:**
- Create visual priority — who/what should the viewer look at?
- Plant future tension — lurking elements become important later.
- Give shot composition specific DOF guidance for the downstream image step.

---

## Continuity Bridging — NO TELEPORTING

`continuityRole` (copy from the plan's entry if set; otherwise default `none`):
- `entry` — main subject arrives in a new location
- `exit` — main subject leaves a location
- `bridge` — travel/montage beat between locations
- `none` (default) — not a bridging shot

Inspect `<scene_plan>` for the previous and next shots. If the main subject's location is changing, ensure your shot's framing supports the bridge: an `exit` shot shows them at the threshold; an `entry` shot shows them arriving.

---

## Description Field

The `description` field is a brief 1–2 sentence summary of what happens in this shot. Capture:
- The main action or event
- Who is involved
- The emotional beat

This is NOT a detailed image prompt — keep it concise. The downstream `shot_image_prompt` step expands this into full frame descriptions with cinematographer prose.

---

## Audio Field

The `audio` field captures **everything heard** in a shot — dialogue, ambient sound, effects, and silence — in a single field. Never leave it empty.

**Format rules:**
- **Dialogue**: prefix with character name in caps: `"ELENA: Don't follow me. Rain on pavement, footsteps receding"`
- **Voiceover**: prefix with V.O.: `"ELENA (V.O.): I should have known. Soft piano underscore"`
- **Ambient only** (no dialogue): `"wind through trees, distant sirens"`
- **Explicit silence**: `"silence"` or `"near-silence, faint hum of fluorescent lights"`
- **Multiple elements**: combine with commas: `"MARCUS: Stay here. Thunder crack, rain intensifying, door creaking shut"`

**Rules:**
- Every shot MUST have a non-empty `audio` field
- AT MOST ONE `NAME:` pattern per shot. If the plan's `oneLineSummary` mentions two speakers, that's a plan bug — emit ONE speaker's line in this shot.
- If a shot has no dialogue, describe the ambient sounds or effects heard

---

## Transitions

Every shot MUST have a `transition` field. No exceptions.

Each shot specifies how it transitions FROM the previous shot. The first shot of a scene uses `cut` or `fade` (use `fade` if opening from black).

**Transition types:**
- **`cut`** — hard cut. Default for most shot-to-shot cuts within a continuous action
- **`crossfade`** — smooth dissolve. Use for time passing, dreamlike moments, parallel action
- **`fade`** — fade through black. Use for scene openings, significant time jumps, finality
- **`dip_to_black`** — fade out > brief black hold > fade in. Trailer "breather" beat. Use between scenes or to punctuate dramatic moments
- **`flash_to_white`** — quick white flash. Use for impact moments, explosions, revelations, smash cuts
- **`circle_close`** — contracting circle (blink/iris effect). Use for POV shots, dreamy or surreal moments
- **`circle_open`** — expanding circle reveal. Use to open a new location or reveal a surprise
- **`wipe_left`** / **`wipe_right`** — directional wipe. Use for location changes, parallel storylines, comic/graphic style

**Guidelines:**
- Most cuts within a scene should be `cut` — transitions are seasoning, not the main course
- Use `dip_to_black` between scenes or for trailer-style dramatic pauses
- Match transition to emotional beat: `flash_to_white` for shock, `crossfade` for tenderness, `circle_close` for introspection
- First shot of scene 1: `fade`. Last shot's transition to the next scene: `dip_to_black` or `fade`

---

## Camera Work

- Start with framing: wide, medium, close-up, extreme close-up
- Then add angle and movement: "close-up, low angle, slow push-in as tension builds"
- Keep it concise — a short phrase, not a paragraph
- Match the framing to `purpose` — `set_the_world` should be wide; `show_reaction` should be close-up; `show_dialogue` is typically medium or close-up

---

## Pre-Output Checklist — RUN EVERY ITEM

Before returning JSON:

1. **`shotNumber`, `purpose`, `duration` copied verbatim from `<this_shot>`** — not changed
2. **`description` is 1–2 sentences**, expands the plan's `oneLineSummary`
3. **`cameraWork` starts with framing**, then angle/movement
4. **`audio` is non-empty**; if it contains `NAME:` or `(V.O.):`, only ONE speaker
5. **`transition` is set** — `fade` for first shot of scene 1, otherwise typically `cut`
6. **If `purpose` is `show_action` or `meet_character`**, `perspective` is set
7. **For non-establishing shots**, `focus.primary` is set
8. **Every refId** (`perspectiveOf`, `focus.primary`, `focus.background[]`, `focus.lurking`) appears verbatim in `<available_refs>`
9. **Reference count ≤ 4** across `focus.primary`, `focus.background[]`, `focus.lurking`, plus mainSubject/secondarySubject if they appear in this shot
10. **`continuityRole`** matches the plan's hint when set; otherwise default `none`
11. **OTS framing** never paired with a single-character shot — use `insert` / `extreme_close_up` / `close_up` instead
