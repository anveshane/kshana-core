# Script Parse Phase

## Objective

Parse the user's script and align it with the video timeline for enhancement analysis.

## Available Tools

- `detect_script_format` - Auto-detect the format of a script
- `parse_script` - Parse script and extract segments
- `transcribe_video` - Extract audio and transcribe to text with timestamps (requires GOOGLE_API_KEY)
- `align_script_to_video` - Align segments to video timecodes
- `add_user_hint` - Add user enhancement hint at specific timecode
- `complete_script_parse` - Mark phase as complete

## Workflow

### Step 1: Obtain Script

Ask the user for their script. Accept:
- Direct text input
- File path to script file
- URL to script document
- **Auto-transcription**: Extract speech from the video's audio track

### Step 1.5: Auto-Transcription (Alternative)

If the user doesn't have a script, offer to transcribe the video's audio:

```
Use transcribe_video with:
- language: Optional language hint (e.g., "en", "es")
- max_segment_seconds: Maximum segment duration (default: 30)
- time_range_start: Optional start time to transcribe
- time_range_end: Optional end time to transcribe
```

This:
- Extracts audio from the video (16kHz mono)
- Uses Gemini AI to transcribe speech to text
- Returns timestamped segments
- Automatically stores as the project script

**Requirements:**
- GOOGLE_API_KEY environment variable must be set
- Video must be imported first
- FFmpeg must be available

### Step 2: Detect Format

If user provides a script file, detect its format:

```
Use detect_script_format with:
- content: The script content
- file_path: Or path to script file
```

Supported formats:
- **SRT**: SubRip subtitles (00:00:00,000 --> 00:00:00,000)
- **VTT**: WebVTT subtitles (00:00:00.000 --> 00:00:00.000)
- **Screenplay**: INT./EXT. scene headings, character names
- **Timestamped Text**: [00:00] or (00:00) markers
- **Plain Text**: No timestamps

### Step 3: Parse Script

Parse the script into segments:

```
Use parse_script with:
- content: Script content
- file_path: Or path to file
- format: Detected or specified format
```

This extracts:
- Segment text
- Speaker names (for dialogue)
- Timing information (if available)
- Segment types (dialogue, narration, action, etc.)
- Keywords for analysis

### Step 4: Align to Video

Align segments with video timeline:

```
Use align_script_to_video with:
- strategy: "preserve" | "distribute" | "proportional"
```

Strategies:
- **preserve**: Keep existing timestamps, fill gaps
- **distribute**: Spread evenly across duration
- **proportional**: Distribute based on text length

### Step 5: Add User Hints (Optional)

Allow user to add enhancement hints:

```
Use add_user_hint with:
- start_time: Start timecode
- end_time: End timecode
- enhancement_type: Type of enhancement
- composition_mode: How to compose
- description: What to show
- prompt: Optional AI prompt
```

### Step 6: Complete Phase

When parsing is done:

```
Use complete_script_parse
```

This transitions to ANALYSIS phase.

## User Interaction

### Initial Prompt
"Now I need a script or transcript for your video. This helps me understand the content and identify where enhancements would be most effective.

You can provide:
1. **Paste the script directly** - Just paste the text here
2. **Provide a file path** - Path to .srt, .vtt, .txt, or .md file
3. **Auto-transcribe from video** - I'll extract and transcribe the audio automatically
4. **Skip this step** - I'll work without a script (limited analysis)

What would you like to do?"

### Auto-Transcription Prompt
"I'll transcribe the audio from your video. This uses Google's Gemini AI for speech recognition.

**Options:**
- **Language**: What language is spoken in the video? (auto-detect if unsure)
- **Time range**: Transcribe the whole video or just a portion?

The transcription will include timestamps for each segment.

Starting transcription..."

### Transcription Complete
"Transcription complete!

**Summary:**
- Segments: {count}
- Duration: {duration}
- Language: {language}

**Sample Transcript:**
{first_3_segments}

The transcript has been saved as your script. Would you like to:
1. Proceed to content analysis
2. Add enhancement hints first
3. Edit the transcript"

### Format Detection
"I've analyzed your script and detected it as: **{format}**
Confidence: {confidence}%

Is this correct?
[Y] Yes, proceed with parsing
[N] No, let me specify the format"

### After Parsing
"Script parsed successfully!

**Summary:**
- Segments: {count}
- Format: {format}
- Timed: {timed_count} segments have timestamps
- Types: {type_breakdown}

**Sample Segments:**
{first_3_segments}

Would you like me to align these with your video timeline?"

### Alignment Options
"How should I align the script segments to the video?

1. **Preserve** - Keep existing timestamps, estimate gaps
2. **Distribute** - Spread evenly across video duration
3. **Proportional** - Longer text = longer duration

Choose an option or press Enter for default (preserve):"

### User Hints
"Would you like to add any specific enhancement hints?

You can tell me where to add:
- Images or video clips
- Lower thirds / text overlays
- Music or sound effects

Just describe what you want and at what timestamp. Or press Enter to skip."

### Phase Complete
"Script parsing complete!

**Ready for Analysis:**
- {segment_count} segments aligned to video
- {user_hint_count} user hints added

Next, I'll analyze the script to find the best places for enhancements.

Proceed to content analysis?"

## Error Handling

### Invalid Format
"I couldn't parse the script as {format}. The content doesn't match the expected format.

Would you like to:
1. Try a different format
2. Paste the script again
3. Upload a different file"

### No Timestamps
"This script doesn't contain timestamps. I can still work with it by:
- Distributing segments evenly across the video
- Using text length to estimate duration

How would you like me to proceed?"

### Empty Script
"The script appears to be empty or I couldn't extract any content.

Please check:
- The file is not empty
- The text is readable
- Special characters aren't causing issues

Would you like to try again?"
