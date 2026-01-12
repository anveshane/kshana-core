# Analysis Phase

## Objective

Analyze the parsed script to identify opportunities for visual and audio enhancements.

## Available Tools

- `identify_enhancement_opportunities` - Scan script for enhancement opportunities
- `extract_frame` - Extract a frame at a specific timecode
- `complete_analysis` - Mark analysis phase as complete

## Workflow

### Step 1: Identify Enhancement Opportunities

Analyze the script segments:

```
Use identify_enhancement_opportunities with optional:
- min_confidence: Minimum confidence threshold (0-1, default: 0.5)
- max_opportunities: Maximum results (default: 20)
- enhancement_types: Filter to specific types
```

### Step 2: Review Opportunities

Present the opportunities to the user:
- Group by type (images, videos, graphics, audio)
- Show confidence scores
- Explain why each was identified

### Step 3: Extract Reference Frames

For visual opportunities, extract frames to help with generation:

```
Use extract_frame with:
- time: Timecode (MM:SS or HH:MM:SS)
- time_ms: Or time in milliseconds
- output_name: Optional custom filename
```

### Step 4: Complete Analysis

Once review is complete:

```
Use complete_analysis
```

This transitions to ENHANCEMENT_PLAN phase.

## What to Look For

### Visual Opportunities (ai_image, ai_video_clip)

1. **Descriptive Passages**
   - Landscape descriptions
   - Building or location mentions
   - Nature scenes
   - Character descriptions

2. **Abstract Concepts**
   - Metaphors that could be visualized
   - Emotional states
   - Theoretical concepts

3. **Demonstrations**
   - "How to" explanations
   - Process descriptions
   - Step-by-step instructions

### Motion Graphics Opportunities

1. **Data and Statistics**
   - Percentages
   - Numbers and figures
   - Comparisons

2. **Names and Titles**
   - Speaker introductions
   - Guest names
   - Topic titles

3. **Lists and Points**
   - Bullet points
   - Key takeaways
   - Steps in a process

### Audio Opportunities

1. **Music (audio_music)**
   - Emotional moments
   - Transitions
   - Opening/closing
   - Montage sequences

2. **Sound Effects (audio_sfx)**
   - Action descriptions
   - Environmental sounds
   - Emphasis moments

## User Interaction

### Presenting Opportunities
"I've analyzed your script and found {count} potential enhancement opportunities:

**Visual Enhancements:**
{list of image/video opportunities}

**Motion Graphics:**
{list of lower thirds, infographics}

**Audio Enhancements:**
{list of music/sfx opportunities}

In the next phase, we'll go through each one to decide which to include. You can also add your own suggestions.

Ready to proceed to enhancement planning?"

### If No Opportunities Found
"I couldn't automatically identify any clear enhancement opportunities from the script. This might happen with:
- Very technical content
- Abstract discussions
- Already visually-rich descriptions

Would you like to:
1. Add your own enhancement hints manually
2. Proceed with audio-only enhancements
3. Skip to a different phase"

## Confidence Levels

- **High (0.8-1.0)**: Strong keywords detected, clear opportunity
- **Medium (0.5-0.8)**: Likely opportunity, worth reviewing
- **Low (0.3-0.5)**: Possible opportunity, user should decide

Filter by confidence based on user preference:
- Conservative: min_confidence=0.8
- Balanced: min_confidence=0.5 (default)
- Comprehensive: min_confidence=0.3
