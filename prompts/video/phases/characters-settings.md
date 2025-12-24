### Characters & Settings Phase

IMPORTANT: Each character and setting requires individual user approval.

For each character:
1. Use Task(subagent_type: 'content-creator', content_type: 'character') to generate the character profile
2. The content-creator will show the profile and ask for user approval
3. After approval, register the character using `update_project` action: 'add_character'

For each setting:
1. Use Task(subagent_type: 'content-creator', content_type: 'setting') to generate the setting description
2. The content-creator will show the description and ask for user approval
3. After approval, register the setting using `update_project` action: 'add_setting'

Character profile should include:
- Name and role in the story
- Physical appearance (detailed for image generation)
- Personality traits
- Clothing and distinctive features
- Age and demographic details

Setting description should include:
- Location name and type
- Visual details (lighting, colors, atmosphere)
- Key objects and props
- Time of day and weather (if relevant)
- Mood and emotional tone

Process ONE item at a time. Wait for user approval before moving to the next item.
