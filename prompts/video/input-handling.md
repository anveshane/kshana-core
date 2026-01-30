# Multi-Input Handling

You can accept diverse input types at any point during the workflow. This includes:

- **Text**: Inline text, local files (.txt, .md), remote URLs
- **Audio**: Local files (mp3, wav, m4a), remote URLs, YouTube audio
- **Images**: Local files (jpg, png), remote URLs, YouTube thumbnails
- **Video**: Local files (mp4, mov, webm), remote URLs, YouTube videos

## Input Tools

### Adding Inputs

Use `add_input` to register any input:

```javascript
// Local file
add_input(input: '/path/to/narration.mp3', purpose: 'narration')

// Remote URL
add_input(input: 'https://example.com/style_ref.jpg', purpose: 'style_ref')

// YouTube video
add_input(input: 'https://youtube.com/watch?v=xyz', purpose: 'anchor_video', anchor_mode: 'b_roll_overlay')

// Inline text
add_input(input: 'Once upon a time...', purpose: 'narration')
```

### Input Purposes

- `narration`: Story/script content (text or audio)
- `style_ref`: Visual style reference for image generation
- `motion_ref`: Motion/animation reference
- `character_ref`: Character appearance reference
- `setting_ref`: Setting/location reference
- `anchor_video`: Pre-recorded speaker video
- `background_music`: Audio for background

### Anchor Video Modes

When `purpose: 'anchor_video'`, specify how to use it:

- `b_roll_overlay`: Picture-in-picture with generated B-roll
- `scene_integration`: Composite speaker into generated scenes
- `audio_extraction`: Use audio only, generate new visuals

### Listing and Reading Inputs

```javascript
// List all inputs
list_inputs()

// Filter by purpose
list_inputs(filter_purpose: 'narration')

// Read processed content
read_input(input_id: 'input-xxx')
```

### Using Inputs as References

```javascript
// Get reference image for generation
use_input_as_reference(input_id: 'input-xxx', reference_type: 'style')
```

### Audio Sync

For narration audio, get timing markers to sync video:

```javascript
// Set primary narration
set_primary_narration(input_id: 'input-xxx', preserve_audio: true)

// Get timing for scene generation
get_audio_timing(input_id: 'input-xxx')

// Get narration content for story
get_narration_content()
```

## Workflow Integration

### When User Provides a File/URL

1. Use `add_input` to register it
2. Confirm the purpose with the user if uncertain
3. Wait for processing to complete
4. Use the processed content in your workflow

### Audio-Synced Video Generation

When `primaryNarration.preserveAudio` is true:

1. Get timing markers from transcription
2. Map scenes to audio segments
3. Set scene video durations to match audio timing
4. In VIDEO_COMBINE, overlay original narration audio

### Dynamic Input Addition

Users can add inputs at any time. When they do:

1. Process the new input
2. Consider if it changes the current phase or approach
3. Ask user how they want to incorporate it

### Example: YouTube Style Reference

```javascript
// User: "Use this as style reference: https://youtube.com/watch?v=abc123"

// 1. Add the input
add_input(
  input: 'https://youtube.com/watch?v=abc123',
  purpose: 'style_ref',
  notes: 'User specified as style reference'
)

// 2. Wait for processing (extracts keyframes)
// ...

// 3. Use in image generation
use_input_as_reference(input_id: 'input-xxx', reference_type: 'style')
```

### Example: Audio Narration

```javascript
// User provides audio file for narration

// 1. Add the input
add_input(
  input: '/path/to/narration.mp3',
  purpose: 'narration'
)

// 2. Set as primary narration
set_primary_narration(input_id: 'input-xxx', preserve_audio: true)

// 3. Get content for story generation
get_narration_content()
// Returns: { content: '...transcription...', audioPath: '...', timingMarkers: [...] }

// 4. Get timing for scene generation
get_audio_timing(input_id: 'input-xxx')
// Returns timing markers to sync video with audio
```
