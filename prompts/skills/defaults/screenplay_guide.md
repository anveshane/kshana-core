**PURPOSE**: Write a screenplay for AI video production. Every character named gets a reference image generated, every location gets a setting image, every scene gets shot breakdowns and video clips. Write ONLY what fits the target duration. Your screenplay MUST tell a complete story with impact.

---

## Story First

Before writing a single line, answer these three questions:

1. **What is the ending?** — The last image or line the viewer sees. This is the most important moment. Plan it first.
2. **What is the setup?** — The minimum context the viewer needs to make the ending land.
3. **What is the turn?** — The single event, choice, or revelation that connects setup to ending.

Every screenplay, even 30 seconds, must have all three. If you can't articulate the turn, your story isn't ready to write.

### Arc by Duration

| Duration | Setup | Turn | Ending |
|----------|-------|------|--------|
| 15-30s | One image establishes everything | One action or discovery | Immediate payoff — twist, reveal, or punchline |
| 31-60s | Brief situation + character want | Single complication or choice | Clear consequence or emotional shift |
| 61-120s | Character + conflict established | Rising tension, 1-2 complications | Resolution that reframes the opening |
| 121-180s | World + relationships established | Escalating conflict with stakes | Earned climax + denouement beat |
| 181-300s | Full setup with subtext | Multiple turns with cause-and-effect | Satisfying resolution that echoes the opening |

**The ending must land with impact.** End on a reveal, a powerful image, an irreversible decision, an echo of the opening that now means something different, or deliberate ambiguity that makes the viewer think. Never just stop. Never trail off. The last moment should feel inevitable.

## Format

```
FADE IN:

INT. LOCATION NAME - TIME

Action lines describe what the camera sees. Present tense. Visual only.

            CHARACTER NAME (age, brief visual description)
      Dialogue line here.

More action. Specific physical movements.

                                          CUT TO:

EXT. NEXT LOCATION - TIME

...

FADE OUT.
```

## Duration Limits (HARD)

**1 page ≈ 1 minute of screen time. ≈ 500 words per page.**

| Duration | Max Words | Max Characters | Max Locations | Max Scenes |
|----------|-----------|---------------|---------------|------------|
| 15-30s   | 250       | 1-2           | 1             | 1          |
| 31-60s   | 500       | 2-3           | 1-2           | 2-3        |
| 61-120s  | 1000      | 3-4           | 2-3           | 3-5        |
| 121-180s | 1500      | 4-5           | 3-4           | 4-6        |
| 181-300s | 2500      | 5-7           | 4-5           | 6-8        |

**These limits are absolute.** If you are near the word limit, cut dialogue or combine scenes — never add locations or characters to compensate.

Same location at different times = ONE location. Combine adjacent spaces (`kitchen` + `hallway` = `INT. APARTMENT`). Count your locations against the table above before writing. If you're at the limit, set the next scene in an existing location.

## Rules

1. **Character names in CAPS on first appearance** with visual description woven into the action line. This is MANDATORY for every character — the system cannot generate a character image without it.
   - GOOD: `DETECTIVE CHEN (40s, weathered face, grey trench coat) stands at the window.`
   - GOOD: `At the counter, MAYA (late 20s, dark curls pulled back, flour-dusted apron over a faded band tee) slides a plate across.`
   - BAD: ~~`Chen enters.`~~ — No visual description. System cannot generate this character.

2. **Scene headings**: `INT.` or `EXT.` + location + time: `INT. NOODLE BAR - NIGHT`

3. **Action lines** — ONLY what a camera can film:
   - GOOD: `His knuckles whiten around the cup.` / `Rain streaks the window.`
   - BAD: ~~`He wonders if she's telling the truth.`~~ → `He studies her face. His eyes narrow.`
   - BAD: ~~`Memories flood back.`~~ → `He stares at the photograph. His jaw tightens.`
   - BAD: ~~`She's been carrying this guilt for years.`~~ → `Her hand trembles as she sets down the letter. She pushes it away, then pulls it back.`

4. **No camera directions** — never write `we see`, `close-up on`, `the camera pans`, `wide shot of`, `POV of`, `angle on`, `the frame`, `into view`, `reveals`. Describe what happens and what exists, not how it's filmed. The shot planner decides camera work. Transitions (`CUT TO:`, `FADE OUT.`) are the only permitted editing notation.
   - BAD: ~~`We see her reflection in the blade.`~~ → `Her reflection warps across the blade's surface.`
   - BAD: ~~`The camera pulls back to reveal the empty room.`~~ → `The room is empty. Dust settles where she stood.`

5. **Show, don't tell** — emotion lives in behavior, objects, and physical detail, never in stated feelings:
   - BAD: `"I'm terrified of losing you."` → GOOD: `"Just... call me when you land." He grips the doorframe.`
   - BAD: `"Let me explain what happened that night."` → GOOD: `He sets the dented watch on the table between them. She stares at it. Doesn't pick it up.`
   - No exposition dumps. No characters explaining the plot to each other. If a viewer can follow the story with the sound off, you're showing.

6. **Dialogue economy**:
   - ≤30s: 0-2 lines. Mostly or entirely visual.
   - ≤60s: 0-4 lines max.
   - ≤120s: up to 8 lines.
   - ≤180s: up to 12 lines.
   - Every line must either advance the plot or reveal character. Cut any line that does neither.

## Design for AI Generation

- **1-2 characters per scene ideal.** Never more than 3 in frame at once.
- **Favor**: two-person conversations, quiet tension, a character alone reacting, simple physical gestures, environmental mood (rain, light, shadow), objects carrying meaning
- **Avoid**: crowds (more than 4 people), fight choreography, explosions, rapid intercutting between many locations, complex physical interactions (dancing, sports), animals, children, vehicles in motion
- **Every element you add costs generation time.** A character glancing at a clock is cheap. A car chase through a city is impossible. When in doubt, choose the simpler staging.

## Faithfulness to the Plot

When adapting a plot treatment, the screenplay MUST include every core beat, character, and setting from the plot. You may add sensory detail, specific dialogue, and visual business — but do not invent major characters, locations, or story events that aren't in the plot. Do not drop plot beats to save space; instead, tighten your prose. The plot is the blueprint. The screenplay is the construction.

## REQUIRED: Cast & Locations Lists

After `FADE OUT.`, you MUST include these exactly:

```
---
## CAST (in order of appearance)
- **DETECTIVE CHEN**: 40s, Chinese-American, weathered angular face, short grey-streaked hair, worn grey trench coat over dark shirt, unlit cigarette behind ear
- **LUNA**: Early 20s, platinum blonde pixie cut, oversized neon-green bomber jacket, cybernetic left eye with blue iris glow

## LOCATIONS
- **NOODLE BAR**: Cramped Chinatown joint, steaming kitchen through pass-through window, red paper lanterns, rain-streaked front window, worn Formica counter
- **THE ALLEY**: Narrow passage between brick buildings, wet cobblestones, rusted fire escape, single flickering pink neon sign
```

Each character MUST have: age, ethnicity/build, hair, clothing, one distinguishing feature.
Each location MUST have: interior/exterior, lighting, key objects, materials, atmosphere.

These lists are extracted by the system — without them, no character images or setting images get generated.

## Self-Check Before Output

Before writing your final screenplay, verify:

- [ ] Every character has CAPS name + visual description on first appearance
- [ ] Location count is within the duration budget (count your INT./EXT. sluglines)
- [ ] Word count is within the duration limit
- [ ] The story has a clear setup → turn → ending
- [ ] The ending lands — it's not just the last thing that happens, it's the *point*
- [ ] No internal thoughts, no camera directions, no exposition dialogue
- [ ] Cast and Locations lists are present after FADE OUT.
- [ ] Every plot beat from the treatment is accounted for

Output ONLY the screenplay with cast and locations lists.