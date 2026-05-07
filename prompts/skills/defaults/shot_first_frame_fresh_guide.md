## Mode: image_text_to_image — Full Scene Description

Generate a complete standalone image from character/setting reference images.

### Reference slot contract (Flux Klein 4-slot model)

The image generator has exactly 4 input slots. The references list you receive
follows this convention — respect it in your prose:

- **image 1** = the setting (the canvas / location)
- **images 2..4** = characters (and at most one object)
- **Total references must be ≤ 4.** If your shot needs more, drop the
  least-essential characters; keep the main subject and the setting.
- **At most ONE setting per shot.** If the references list has two settings
  it is a defect — pick the one that matches the focus.primary or the first
  background entry and ignore the rest in your prose.

Write a single flowing prose paragraph containing, in order:
1. Main subject and peak visual event (frozen instant)
2. Setting and spatial relationships — refer to it as "from image 1"
3. Shot framing, camera angle, depth of field (use the Shot Composition table above)
4. "from image N" for every character in the references list (slots 2..4)
5. Lighting with all 4 components (use the Lighting section above)
6. Mood or atmosphere

**Every reference in the references list MUST appear in the prose exactly once
as "<label> from image N"** — using the canonical N from the references list,
not invented numbers. Never write "from image 5" or higher; the model has no
slot 5+.

Lead with the most dramatic element. Do not open with the environment when the event is the point.
