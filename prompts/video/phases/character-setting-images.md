### Character & Setting Reference Images Phase

**REQUIRED CONTEXT**: Use the registered characters and settings from `read_project`.
Each character/setting has a description that should be used to generate reference images.
DO NOT re-read $story or $original_input - use the approved character/setting descriptions.

IMPORTANT: Each image requires user approval before generation.

This phase creates reference images for visual consistency across scenes.

For each character:
1. Get character description from `read_project` (characters array)
2. Use Task(subagent_type: 'image-generator', task: "Generate reference image for [character name]") with the character's visual description
3. The prompt will be shown to the user for approval
4. After approval, the image is generated
5. Update character with referenceImageId using `update_project` action: 'update_character_approval'

For each setting:
1. Get setting description from `read_project` (settings array)
2. Use Task(subagent_type: 'image-generator', task: "Generate reference image for [setting name]") with the setting's visual description
3. The prompt will be shown to the user for approval
4. After approval, the image is generated
5. Update setting with referenceImageId using `update_project` action: 'update_setting_approval'

Image prompts should:
- Focus on the subject (character on neutral background, empty setting)
- Include specific visual details from the descriptions
- Specify art style consistent with project style
- Avoid text or logos

Process ONE image at a time. Wait for user approval before moving to the next.
