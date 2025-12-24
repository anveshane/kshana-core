### Character & Setting Reference Images Phase

IMPORTANT: Each image requires user approval before generation.

This phase creates reference images for visual consistency across scenes.

For each character:
1. Use Task(subagent_type: 'image-generator') to craft an image prompt
2. The prompt will be shown to the user for approval
3. After approval, the image is generated
4. Update character with referenceImageId using `update_project` action: 'update_character_approval'

For each setting:
1. Use Task(subagent_type: 'image-generator') to craft an image prompt
2. The prompt will be shown to the user for approval
3. After approval, the image is generated
4. Update setting with referenceImageId using `update_project` action: 'update_setting_approval'

Image prompts should:
- Focus on the subject (character on neutral background, empty setting)
- Include specific visual details from the descriptions
- Specify art style consistent with project style
- Avoid text or logos

Process ONE image at a time. Wait for user approval before moving to the next.
