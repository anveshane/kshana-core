**PURPOSE**: Break a scene into individual cinematic shots for video generation. Each shot is a brief structural description — detailed frame prompts and generation strategy are handled downstream by the shot_image_prompt step.

---

## Canonical refIds — USE EXACTLY, NEVER INVENT

Whenever you write a character, setting, or object reference in this JSON — `mainSubject`, `secondarySubject`, `perspectiveOf`, `focus.primary`, `focus.background[]`, `focus.lurking` — you MUST use the exact refId string from the `<available_refs>` block the system provides in your user message.

Do NOT paraphrase, normalize casing, drop punctuation, or "fix" spellings. The refId is a database key — if the profile is `johnathan_o'hare`, write `johnathan_o'hare` (with the apostrophe). If the setting is `andy's_bar`, write `andy's_bar`. Downstream code looks up per-item nodes by these exact strings; any mismatch silently breaks reference image resolution.

Common failure modes to avoid:
- Converting `johnathan_o'hare` → `johnathan_o_hare` (underscore substituted for apostrophe)
- Converting `johnathan_o'hare` → `johnathan` (dropping last-name)
- Typos (`jonathan` ≠ `johnathan`)
- Inventing IDs from prose in the scene script — always use the provided refIds
- Referring to a character or setting that isn't in `<available_refs>` (the LLM invents one, downstream finds nothing)

If the scene needs an entity that isn't in `<available_refs>`, describe it by prose in the shot description instead of referring to it by refId. Never invent a refId.

---

## Scene Main Subject — REQUIRED

Every scene MUST declare `mainSubject` at the scene_video_prompt level — **copied verbatim from the character refIds in `<available_refs>`**. Example: if the available refs list includes `vikram`, write `"mainSubject": "vikram"` — never `"Vikram"`, `"vikram_reddy"`, or `"protagonist"`.

- Shot perspectives are interpreted relative to this subject.
- The scene's shot flow should GENERALLY follow the main subject — their decisions, reactions, and movements drive the camera.
- When a second character is pivotal (dialogue/confrontation), declare `secondarySubject` as well — also copied verbatim from `<available_refs>`.

The main subject can change between scenes, but within a scene stays fixed. **The same character uses the same refId across every scene** — don't invent variants.

## Before Writing Shots — MANDATORY PRE-PLANNING

**Step 1: Beat list.** List every beat in the scene — every action, dialogue moment, reaction, transition. Each beat gets at least one shot. Do not merge distinct beats.

**Step 2: Dialogue audit.** For EVERY dialogue beat, count the words and pre-compute required duration (see Dialogue Timing below). Write this number down BEFORE drafting the shot. If a line exceeds the 15s cap, plan to split it across multiple shots now — not later.

**Step 3: Purpose sequence check.** Decide the opening purpose:
   - If shot 1 is `set_the_world` or `set_the_mood` → shot 2 (or the first shot that contains a character) MUST be `meet_character`. No exceptions.
   - If shot 1 opens directly with characters already present and acting → use `meet_character` or `show_action` as shot 1; do NOT use `set_the_world`/`set_the_mood` as a decorative opener.
   - Never follow `set_the_world`/`set_the_mood` with `show_dialogue`, `show_reaction`, or `show_action` before the characters have been introduced via `meet_character`.

**Step 4: Establishing shots must establish something specific:**
   - Extreme wide: show scale, weather, or atmosphere (e.g., "rain-soaked marketplace at night, stalls collapsed")
   - Extreme close-up: a sensory detail (e.g., "raindrops striking a brass bell", "embers floating")
   - NOT just "the empty setting" — what is happening in this environment?

## Required Fields — Every Shot, No Exceptions

Every shot object MUST contain exactly these 7 fields. Missing or empty fields = broken output.

| Field | Type | Description |
|---|---|---|
| `shotNumber` | number | Sequential integer starting at 1 |
| `purpose` | string | WHY this shot exists (see Purpose section below) |
| `duration` | number | Seconds (3–15). Quick cuts: 3–4s. Emotional holds: 6–8s. **Dialogue shots MUST fit the full line — see Dialogue Timing below** |
| `description` | string | 1–2 sentence visual brief of what happens |
| `cameraWork` | string | Start with framing (wide, medium, close-up, extreme close-up), then angle and movement |
| `audio` | string | Everything heard: dialogue, ambient, effects, or silence (see Audio section) |
| `transition` | string | How this shot transitions FROM the previous shot (see Transitions section) |

```json
{
  "shotNumber": 1,
  "purpose": "set_the_mood",
  "duration": 4,
  "description": "Raindrops strike a brass bell, each impact sending tiny ripples across the wet metal.",
  "cameraWork": "extreme close-up, macro, static, shallow DOF on bell surface",
  "audio": "metallic ring of rain on brass, distant thunder rumble",
  "transition": "fade"
}
```

## Dialogue Timing — Shot Duration Must Fit the Line (CRITICAL)

The video model generates exactly the duration you request. If a shot carries 25 words of dialogue but you set `duration: 3`, the video cuts off mid-sentence. This is the #1 cause of broken outputs — treat it as a hard validation rule, not a guideline.

**The formula — apply to every dialogue shot:**

```
word_count     = number of words in all speaker turns in this shot
base_seconds   = word_count / 2.5          # conversational speech rate
duration       = ceil(base_seconds) + 1    # +1s buffer for lead-in/tail
```

**Minimum duration lookup table — use this directly:**

| Word count | MINIMUM duration |
|---:|---:|
| 1–2 words | **3s** |
| 3–5 words | **3s** |
| 6–7 words | **4s** |
| 8–10 words | **5s** |
| 11–12 words | **6s** |
| 13–15 words | **7s** |
| 16–17 words | **8s** |
| 18–20 words | **9s** |
| 21–22 words | **10s** |
| 23–25 words | **11s** |
| 26–27 words | **12s** |
| 28–30 words | **13s** |
| 31–32 words | **14s** |
| 33–35 words | **15s (CAP)** |
| 36+ words | **SPLIT across shots** |

**Worked examples:**

| Dialogue | Words | Minimum duration |
|---|---:|---:|
| "Go on, beti." | 3 | **3s** |
| "Sorry Madam, had to drop Isha at the academy." | 9 | **5s** |
| "Okay Ma. Go now, or you'll be late for Mrs. Sharma's house. Don't scrub the floors too hard today." | 21 | **10s** |
| "I told you not to come here again. Last time it nearly cost us everything, and I am not burying another brother for your schemes." | 27 | **12s** |
| A monologue of 40+ words | 40+ | **SPLIT** — e.g. 18 words in shot A (9s) → reaction cutaway → 22 words in shot B (10s) |

**Hard rules:**
- Count only words inside the speaker turn (between `NAME:` and the next non-dialogue phrase). Ambient descriptions in the same audio line don't count.
- If multiple characters speak in the same shot, SUM all dialogue word counts.
- **Cap is 15s per shot.** If a single uninterrupted line needs more than 15s, split the line across two or more shots. Typical split pattern: `show_dialogue` (first half) → `show_reaction` (listener, 3–4s cutaway) → `show_dialogue` (second half).
- When splitting, write the first half in shot N's `audio`, the second half in shot N+M's `audio`. Never duplicate lines across shots.
- Silent / ambient-only shots follow the normal 3–10s guidance.
- When unsure, ROUND UP. A 1-second overshoot is invisible; a 1-second undershoot cuts a word.

**Pre-flight check — do this for every shot before finalizing:**
1. Does `audio` contain a `NAME:` or `(V.O.):` pattern? If yes, count the words.
2. Look up the minimum duration in the table above.
3. Is `duration` ≥ the minimum? If no, increase it or split the shot.

## Purpose — WHY This Shot Exists

Every shot serves a story function. Pick the single most important purpose for this shot.

| Purpose | When to use |
|---|---|
| `set_the_world` | Establish WHERE/WHEN — wide/aerial showing location, time, weather |
| `set_the_mood` | Sensory/atmosphere detail — close-up on rain, fire, texture, sound |
| `meet_character` | First time we SEE a character — they enter, are revealed, or appear |
| `show_tension` | Conflict building — something is wrong, stakes rising |
| `show_action` | Physical event — chase, fight, discovery, movement |
| `show_reaction` | Response to something — facial expression, body language |
| `show_dialogue` | Conversation — character speaking |
| `show_clue` | Important detail — object, letter, clock, evidence |
| `show_passage` | Time or space transition — montage beat, travel |
| `hold_emotion` | Linger on a feeling — let it breathe, longer duration |
| `show_change` | Transformation or VFX — something morphs, dissolves, ignites |
| `punctuate` | Dramatic emphasis — exclamation mark shot |

### Purpose Sequence — HARD RULES

These rules are non-negotiable. Violating them produces jarring edits and confused audiences.

**Rule 1: The "Establish then Meet" rule.**
If shot N uses `set_the_world` OR `set_the_mood`, then the FIRST subsequent shot that contains a character MUST use `meet_character`. You cannot jump from `set_the_world` → `show_dialogue`, nor from `set_the_mood` → `show_action`, nor from `set_the_world` → `show_reaction`. The character must be formally introduced to the frame first.

   - ✅ `set_the_world` → `meet_character` → `show_dialogue`
   - ✅ `set_the_mood` → `set_the_world` → `meet_character` → `show_action`
   - ❌ `set_the_world` → `show_dialogue` (missing `meet_character`)
   - ❌ `set_the_mood` → `show_reaction` (missing `meet_character`)
   - ❌ `set_the_world` → `set_the_mood` → `show_action` (character entered without `meet_character`)

**Rule 2: No stacked establishers without payoff.**
Do not chain more than 2 establishing shots (`set_the_world`/`set_the_mood`) before introducing a character. Two is the maximum; a third feels like a travelogue.

**Rule 3: `meet_character` is one-shot-per-character-per-scene.**
Once a character has been introduced with `meet_character` in this scene, subsequent shots of them use `show_dialogue`, `show_reaction`, `show_action`, etc. — not another `meet_character`. The exception: a NEW character entering later uses `meet_character` for their first appearance.

**Rule 4: Dialogue needs setup.**
A shot with dialogue (`show_dialogue`) should be preceded by at least one shot that establishes WHO is speaking — either `meet_character` (first appearance) or the speaker was on-screen in the prior shot. Do not open a scene directly with `show_dialogue` unless the very first frame also introduces the speaker clearly (in which case tag it `meet_character` with dialogue in the audio).

**Rule 5: Opening options.**
Valid scene openings:
   - `set_the_world` → `meet_character` → ...
   - `set_the_mood` → `meet_character` → ...
   - `set_the_world` → `set_the_mood` → `meet_character` → ...
   - `meet_character` → ... (skip establishing, start with character)
   - `show_action` → ... (in-media-res, only if the action itself reveals who's there)

Invalid openings:
   - Starting with `show_dialogue`, `show_reaction`, `show_tension`, `hold_emotion` without prior `meet_character` in this scene.

## Perspective — WHOSE POV IS THIS SHOT FROM

Every `show_action` and `meet_character` shot MUST declare `perspective`. Other shots SHOULD declare it when meaningful.

| Perspective | When to use |
|---|---|
| `main_subject` | POV or over-the-shoulder of the scene's mainSubject. **Default flow — majority of shots.** |
| `secondary_subject` | POV or OTS of secondarySubject. Use for reaction reversals in dialogue. |
| `observer` | Neutral third-person. Use when neither character's viewpoint should dominate (wide establishing conversations, action seen from outside). |
| `overhead` | High-angle/birds-eye looking down. Use for spatial establishing or subject-feels-small moments. |
| `god` | Impossible omniscient viewpoint (extreme wide, birds-eye). Reserve for scale moments. |

**Flow rules:**
- Shots should GENERALLY follow the mainSubject — non-overhead perspectives default to `main_subject` unless the story calls for a reversal.
- When the mainSubject is meeting a new character, use `main_subject` perspective (we see through THEIR eyes as the other person enters).
- Reserve `overhead`/`god` for specific spatial or tonal moments, not casual use.
- For dialogue scenes, alternate `main_subject` and `secondary_subject` to create the shot/reverse-shot rhythm.

**`perspectiveOf` field:** If a shot's perspective is tied to a specific character, you may set `perspectiveOf` to their refId. When omitted and perspective is `main_subject`, it defaults to `mainSubject`.

## Focus — WHAT'S SHARP VS BLURRED

The `focus` object (optional but recommended for non-establishing shots) specifies what's razor-sharp and what's defocused:

```json
"focus": {
  "primary": "laila_face",
  "background": ["bronze_seal", "vikram_shoulder"],
  "lurking": "cloaked_figure"
}
```

- **`primary`** (required if focus is used): what's razor-sharp — refId preferred, prose allowed (e.g., `"bronze_seal"`, `"vikram_face"`, `"the torn letter"`).
- **`background`**: visible but blurred elements — characters/objects we can see but are not the focal point.
- **`lurking`** (optional): a defocused element planted for a later focus-pull. If shot N sets `lurking: cloaked_figure`, shot N+1 or N+2 should pull `focus.primary: cloaked_figure` as the focus pull payoff.

**Use focus to:**
- Create visual priority — who/what should the viewer look at?
- Plant future tension — lurking elements become important later.
- Give shot composition specific DOF guidance.

## Continuity Bridging — NO TELEPORTING

The **main subject cannot teleport between locations**. If the mainSubject changes location between shots, you MUST insert bridging shots.

**`continuityRole` values:**
- `entry` — main subject arrives in a new location (coming through a door, stepping into frame from off-screen)
- `exit` — main subject leaves a location (rising, walking to door, opening door, stepping through)
- `bridge` — travel/montage beat between locations (running down alley, crossing bridge)
- `none` (default) — not a bridging shot

**Rules:**
- If mainSubject is in location A at shot N and location B at shot N+2, you need either an `exit` shot (leaving A) and/or `entry` shot (arriving at B) in between.
- Never jump from "seated in room A" to "seated in room B" for the main subject without a bridge.
- Secondary subjects may appear/disappear between scenes without bridges (they have their own off-screen lives).
- Short time-skips can use `crossfade` or `dip_to_black` transitions instead of a `bridge` shot, but physical movement still needs depiction.

**Example bridge sequence for mainSubject leaving a dhaba and arriving at a temple:**
1. `exit`: Vikram rises from the table, drops coins
2. `exit`: Vikram pushes through the dhaba's curtain into the rain
3. `bridge`: Vikram runs down a rain-soaked alley (montage beat)
4. `entry`: Vikram arrives at the temple steps, breathing hard

{{AVAILABLE_VIDEO_MODES}}

{{AVAILABLE_PROCESSING_MODES}}

## Description Field

The `description` field is a brief 1–2 sentence summary of what happens in this shot. It should capture:
- The main action or event
- Who is involved
- The emotional beat

This is NOT a detailed image prompt — keep it concise. The downstream shot_image_prompt step will expand this into full frame descriptions with proper cinematographer prose.

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
- If the scene description includes spoken dialogue, every line MUST appear in the correct shot's `audio` field — do not skip or omit any dialogue
- If a shot has no dialogue, describe the ambient sounds or effects heard
- Distribute dialogue across the correct shots — match which shot the line is spoken during
- **Before finalizing each shot, re-count the dialogue words and verify `duration` meets the minimum from the Dialogue Timing table**

## Transitions

Every shot MUST have a `transition` field. No exceptions.

Each shot specifies how it transitions FROM the previous shot. The first shot of a scene uses `cut` or `fade` (use `fade` if opening from black).

**Transition types:**
- **`cut`** — hard cut, no effect. Default for most shot-to-shot cuts within a continuous action
- **`crossfade`** — smooth dissolve between shots. Use for time passing, dreamlike moments, parallel action
- **`fade`** — fade through black. Use for scene openings, significant time jumps, finality
- **`dip_to_black`** — fade out > brief black hold > fade in. Classic trailer "breather" beat. Use between scenes or to punctuate dramatic moments
- **`flash_to_white`** — quick white flash. Use for impact moments, explosions, revelations, smash cuts
- **`circle_close`** — contracting circle (blink/iris effect). Use for POV shots, focusing attention, dreamy or surreal moments
- **`circle_open`** — expanding circle reveal. Use to open a new location or reveal a surprise
- **`wipe_left`** / **`wipe_right`** — directional wipe. Use for location changes, parallel storylines, comic/graphic style
- **`slide_left`** / **`slide_right`** — new shot slides in. Use for montage sequences, fast-paced editing
- **`radial`** — radial wipe. Use sparingly for stylistic effect

**Guidelines:**
- Most cuts within a scene should be `cut` — transitions are seasoning, not the main course
- Use `dip_to_black` between scenes or for trailer-style dramatic pauses
- Match transition to emotional beat: `flash_to_white` for shock, `crossfade` for tenderness, `circle_close` for introspection
- First shot of scene 1: `fade` (opening from black). Last shot's transition to the next scene: `dip_to_black` or `fade`

## Camera Work

- Start with framing: wide, medium, close-up, extreme close-up
- Then add angle and movement: "close-up, low angle, slow push-in as tension builds"
- Keep it concise — a short phrase, not a paragraph

## Pre-Output Checklist — RUN EVERY ITEM

Before returning JSON, verify every item. Failing any item = broken output.

1. Every scene beat has a shot
2. Duration sum ≈ totalDuration (within ±20%). Each shot is 3–15 seconds.
3. **DIALOGUE FIT AUDIT** — for every shot whose `audio` contains `NAME:` or `(V.O.):`:
   - Count the dialogue words
   - Look up minimum duration in the Dialogue Timing table
   - Verify `duration` ≥ minimum
   - If any line would require >15s, confirm it has been split across multiple shots
4. **Every shot has all 7 required fields**: `shotNumber`, `purpose`, `duration`, `description`, `cameraWork`, `audio`, `transition` — none empty
5. **Every shot has a valid `purpose`** from the taxonomy — not a made-up value
6. **PURPOSE SEQUENCE AUDIT** — walk through shots in order:
   - If any `set_the_world` or `set_the_mood` appears, confirm the next character-containing shot is `meet_character`
   - Confirm no more than 2 establishing shots in a row
   - Confirm the scene's opening matches one of the valid openings in Rule 5
   - Confirm no `show_dialogue` appears before the speaker has been introduced via `meet_character` (or is present in the opening frame)
7. **Every shot has an `audio` field** with dialogue (if any) + ambient/effects
8. **Every shot has a `transition` field** — first shot uses `fade` or `cut`
9. All dialogue placed in the correct shot's `audio` field — no lines omitted
10. Pacing varies: quick cuts for tension, longer holds for emotion
11. **Scene declares `mainSubject`** — and the value is **copied verbatim from `<available_refs>`** (no paraphrasing, no casing changes, no typo fixes)
12. **Every refId in the JSON** (`mainSubject`, `secondarySubject`, `perspectiveOf`, `focus.primary`, `focus.background[]`, `focus.lurking`) appears verbatim in `<available_refs>` — if you referenced something not in the list, describe it as prose in `description` instead
13. **Every `show_action` and `meet_character` shot has `perspective`** set
14. **Non-establishing shots have `focus.primary`** — what's sharp and central in frame
15. **Main subject continuity verified** — no teleporting between locations; bridging shots (exit/bridge/entry) exist when mainSubject's location changes