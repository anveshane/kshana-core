## Mode: edit_previous_shot — DELTA ONLY (2-3 sentences max)

You are editing the previous shot's last frame. The base image ALREADY CONTAINS the setting, lighting, atmosphere, and all existing characters.

### Reference slot contract (Flux Klein 4-slot model)

- **image 1** = the base image (the previous shot's last frame, which itself
  is anchored on the setting). Refer to the location as "the setting from image 1"
  when you must mention it.
- **images 2..4** = characters layered on top. Use the canonical numbers from
  the references list — never invent slot 5+.
- Total references ≤ 4. At most one setting reference. If a returning
  character is on screen, they are listed in the references array — write
  "<name> from image N" for them too, using the N from the list.

**ALWAYS USE "from image N" for every character visible in the shot** — even characters already in the base image. This is required for character consistency. Include all referenced images in the `references` array.

**WRITE ONLY what is NEW or CHANGED:**
- A character moved to a different position ("Vikram from image 1 now turned to face the door")
- A new character appearing ("Laila from image 2 now visible at the edge of the frame")
- Camera angle shifted
- An element appeared or disappeared
- Expression or pose changes ("the girl from image 3, expression now frozen in shock")

**DO NOT WRITE any of these (already in base image):**
- Setting description (city, alley, street, environment, debris, ruins)
- Lighting (firelight, golden, warm, glow, shadows, illuminated)
- Atmosphere (mood, tense, chaotic, eerie)
- Full character appearance descriptions (clothing, hair color, etc.)

**LENGTH: 2-3 sentences MAXIMUM.** Longer = you are describing the base image = FAIL.

**GOOD examples:**
- "The phantom from image 1 now visible on the right side of the frame, its form semi-transparent with glitch artifacts. The girl from image 2 has shifted to the far left edge."
- "Camera angle shifted to close-up on the girl from image 2. Her expression now frozen in shock, mouth open."
- "Vikram from image 1 now standing with right hand yanking the pocket edge back. Laila from image 2 leaning forward, henna-patterned fingers outstretched toward the pocket."

**BAD examples (WILL FAIL):**
- "A medium shot of the girl in the apocalyptic city, lit by warm golden firelight from overhead, with debris scattered across the ground..." ← This is a FULL SCENE DESCRIPTION. The base image already has all of this.
- "Laila now positioned close to Vikram" ← Missing "from image N" references. Must say "Laila from image 2" and "Vikram from image 1".
- Any output longer than 4 sentences
