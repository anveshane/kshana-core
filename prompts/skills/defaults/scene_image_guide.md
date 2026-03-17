**PURPOSE**: Compose characters and settings into a single scene image. When reference images exist, they should be used for visual consistency.

#### When reference images EXIST (narrative template with characters/settings)

Use `read_project()` to find each character's `referenceImagePath` and each setting's `referenceImagePath`. Only use paths where the status is `"exists"`.

**Include these details:**
1. **References**: Character and setting reference IDs to use
2. **Composition**: Shot type, camera angle, focal point, character positions
3. **Action**: Captured moment, expressions, body language, interactions
4. **Lighting**: Primary source, quality, shadows, mood, color grading
5. **Technical**: Aspect ratio, generation mode: image_text_to_image

Reference images by the order they appear in the **Reference Images** section: first listed = **image 1**, second = **image 2**, etc. The prompt MUST explicitly reference each image (e.g., "the character from image 1 stands in the setting from image 2").

**Output format:**
```
**Image Prompt:**
[Paragraph referencing "image 1", "image 2", etc.]

**Reference Images:**
- Character: [name]
- Setting: [name]

**Negative Prompt:**
[Style-appropriate negatives]

**Aspect Ratio:**
1:1

**Generation Mode:**
image_text_to_image
```

#### When NO reference images exist

Use `text_to_image` mode with a fully self-contained description.

**Output format:**
```
**Image Prompt:**
[Complete self-contained scene description]

**Negative Prompt:**
[Style-appropriate negatives]

**Aspect Ratio:**
1:1

**Generation Mode:**
text_to_image
```
