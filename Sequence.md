# Video Generation Sequence

## Overview

The sequence for video generation follows a structured workflow from initial user input through final video production.

### State Transitions

The workflow always follows this progression:

```text
plot → story → scenes → images → video
```

## Brand New Project

1. Ask for user input
2. User input can be:
   - Plot
   - Full story
   - Chapter of a story

## Phase 1: Plot Phase

1. The user can enter a plot, a story, or a chapter of a story
2. If the user inputs a plot:
   - Plan the story
   - Get approval for the plan
   - If approved, transition to story phase
3. Update the project with the generated plot content / artifact IDs
4. Mark the plot phase as complete

## Phase 2: Story Phase

1. Generate the story based on the plan using the content agent
2. Get approval for the story
3. **Direct input handling:**
   - If the user inputs a story → directly in the story approved step
   - If the user inputs a chapter of a story → directly in the story approved step
   - If the user inputs a full story → directly in the story approved step
4. Update the project with the generated story content / artifact IDs
5. Mark the story phase as complete

## Phase 3: Characters and Settings Descriptions Phase

1. Use a planning agent to plan the characters and settings
2. Create a todo list with each character and setting
3. Spawn a new content agent for each character and setting to develop them
4. For each character or setting:
   - Generate their profiles and descriptions
   - Get approval from the user
5. Update the project with the generated character and settings content / artifact IDs
6. Mark the characters and settings phase as complete

## Phase 4: Scenes Phase

1. Create a plan for the scenes
2. Create a todo list for each scene
3. Spawn a new content agent for each scene to develop them
4. For each scene:
   - Generate scene descriptions
   - Get approval from the user
5. Update the project with the generated scene content / artifact IDs
6. Mark the scenes phase as complete

## Phase 5: Character and Settings Images Phase

1. Create a plan for the character and settings images ( using plan from character and settings descriptions )
2. Create a todo list for each character and settings image
3. For each character and settings image:
   - Trigger generation using the `generate_image` tool call
   - Pass the generated character and settings profile and description
   - Wait for the image generation to complete
4. Update the project with the generated character and settings image artifact IDs
5. Mark the characters and settings images phase as complete

## Phase 6: Scene Images Phase

1. Create a plan for the scene images
2. Create a todo list for each scene image
3. For each scene image:
   - Trigger generation using the `generate_image_from_image` tool call - which will use existing generated character and settings
   - Pass the generated scene description to the tool call and also existing character and setting images ( previously generated )
   - Wait for the image generation to complete
   - Get approval from user of the newly generated scene image. 
   - If not approved, regenerate with user input until approval.
4. Update the project with the generated scene image artifact ids.
5. Mark the scene images phase as complete. 

## Phase 7: Video Generation Phase.

1. Create a plan for the video generation phase. ( using scene plan from previous stage )
2. For each scene image:
    - Using scene images ( generated from previous phase ) and video action description, we create a video using the `generate_video`.
    - Wait for the video generation to complete.
    - Get approval from user of the newly generated scene video. 
   - If not approved, regenerate with user input until approval.
3. Mark video generation as complete.


## Phase 8: Video Combine Phase

1. Once all video is generated and user approved - call `video_combine` to combine videos of all scenes in sequence
2. Present combined video to user. 