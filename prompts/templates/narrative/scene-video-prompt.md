# Scene Video Prompt Template

Generate a comprehensive motion/animation prompt for converting a scene image into a video clip.

## Scene Information

{{SCENE_CONTENT}}

## Source Image

Image Artifact ID: {{IMAGE_ARTIFACT_ID}}
Image Path: {{IMAGE_PATH}}

## MANDATORY Motion Specifications

The prompt MUST include ALL of the following details. This will be used with the video generation workflow (wan_single_image).

### 1. Source Reference (ALL REQUIRED)

- **Source Image ID**: The artifact ID of the image to animate
- **Duration**: Target video length (4-8 seconds typical)
- **Frame Rate**: 24fps (cinematic) or 30fps (smooth)

### 2. Camera Motion (ALL REQUIRED)

- **Movement Type**: (static, pan, tilt, zoom, dolly, tracking, crane, handheld)
- **Movement Speed**: (slow/subtle, medium, fast/dramatic)
- **Start Position**: Camera's initial state relative to scene
- **End Position**: Camera's final state
- **Easing**: (linear, ease-in, ease-out, ease-in-out)
- **Movement Motivation**: Why the camera moves (following action, revealing information, creating tension)

### 3. Subject Motion (ALL REQUIRED)

- **Character Movement**: What each character does (subtle breathing, gestures, turning head, walking, etc.)
- **Facial Animation**: Eye movements, expressions changing, mouth movement
- **Body Motion**: Posture shifts, hand gestures, weight shifts
- **Motion Intensity**: (minimal/subtle, moderate, significant)

### 4. Environmental Motion (ALL REQUIRED)

- **Atmospheric Effects**: (dust particles, fog drift, light flicker, lens flare movement)
- **Background Motion**: (swaying trees, moving clouds, distant activity)
- **Foreground Elements**: (hair movement from wind, cloth flutter, smoke wisps)
- **Lighting Changes**: (light source movement, shadow progression, flickering)

### 5. Technical Specifications (REQUIRED)

- **Workflow**: wan_single_image (single image animation)
- **Duration**: Specific seconds (default: 5 seconds)
- **Loop Consideration**: Whether end should smoothly connect to start
- **Motion Quality**: Smooth, natural, no jarring transitions

## Motion Prompt Guidelines

### Do's:
- Describe continuous, fluid motion
- Keep movements subtle and natural
- Match motion to scene mood
- Consider what would naturally move in the scene

### Don'ts:
- Don't describe drastic position changes
- Don't add elements not in the source image
- Don't request impossible physics
- Don't specify motion that would distort the image

## Output Format

Generate the prompt in this exact structure:

```
**Motion Prompt:**
[Single paragraph describing all motion elements. Be specific about direction, speed, and nature of movement. Focus on what CAN move naturally in the scene.]

**Camera Motion:**
Type: [movement type]
Direction: [specific direction]
Speed: [slow/medium/fast]
Duration: [seconds]

**Subject Motion:**
[List each character's motion]

**Environmental Motion:**
[List atmospheric and environmental movements]

**Technical Parameters:**
- Source: [image artifact ID]
- Duration: [X] seconds
- Workflow: wan_single_image
- Frame Rate: 24fps

**Motion Intensity:**
[minimal | subtle | moderate | significant]
```

## Example Output

**Motion Prompt:**
Slow push-in camera movement toward the two figures as they stand in tense confrontation. Dr. Sarah Chen's chest rises and falls with controlled breathing, her eyes narrowing slightly, a subtle tightening of her crossed arms. Marcus Webb shifts his weight almost imperceptibly from one foot to the other, his gaze steady but a slight twitch at the corner of his mouth. Golden light through the windows creates slowly drifting dust particles in the air. The flames in a distant candelabra flicker gently, casting dancing shadows on the mahogany bookshelves. A subtle breeze stirs the edge of a curtain at the window's edge.

**Camera Motion:**
Type: Slow push-in/dolly
Direction: Forward toward subjects
Speed: Slow (subtle)
Duration: 5 seconds

**Subject Motion:**
- Dr. Sarah Chen: Breathing animation, slight eye narrowing, arm tension
- Marcus Webb: Weight shift, steady gaze with mouth twitch

**Environmental Motion:**
- Floating dust particles in light beams
- Candle flame flicker and shadow dance
- Subtle curtain movement at window edge

**Technical Parameters:**
- Source: scene_01_image_001
- Duration: 5 seconds
- Workflow: wan_single_image
- Frame Rate: 24fps

**Motion Intensity:**
subtle
