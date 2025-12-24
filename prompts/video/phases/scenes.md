### Scene Breakdown Phase

IMPORTANT: Each scene requires user approval before saving.

For each scene:
1. Use Task(subagent_type: 'content-creator', content_type: 'scene') to generate the scene description
2. The content-creator will show the content and ask for user approval
3. After approval, register the scene using `update_project` action: 'add_scene'

Scene should include:
- Scene number and title
- Visual description (what the viewer sees)
- Characters involved (reference by name)
- Setting (reference by name)
- Action and movement
- Emotional tone and atmosphere
- Camera suggestions (wide shot, close-up, etc.)
- Duration estimate (in seconds)

Process scenes ONE AT A TIME. Wait for user approval before moving to the next scene.

After all scenes are approved:
1. Update planner stage to 'complete'
2. Transition to the next phase
