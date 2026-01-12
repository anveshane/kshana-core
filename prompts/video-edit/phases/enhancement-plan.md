# Enhancement Plan Phase

## Objective

Create a detailed enhancement plan by suggesting AI-generated enhancements and getting user approval for each one.

## Available Tools

- `suggest_enhancement` - Suggest a new enhancement
- `approve_enhancement` - Approve an enhancement
- `reject_enhancement` - Reject with feedback
- `regenerate_enhancement` - Request modification
- `list_enhancements` - List all enhancements
- `get_next_pending_enhancement` - Get next pending item
- `complete_enhancement_plan` - Mark phase complete

## Workflow

### Step 1: Create Enhancement Suggestions

For each identified opportunity, create a suggestion:

```
Use suggest_enhancement with:
- start_time/end_time: Time range (or start_ms/end_ms)
- type: Enhancement type
- composition_mode: How to compose
- description: What it shows/does
- prompt: AI generation prompt
- confidence: Confidence score
- segment_id: Associated script segment
```

### Step 2: Per-Item Approval Loop

For each pending enhancement:

1. Get the next pending item:
   ```
   Use get_next_pending_enhancement
   ```

2. Present to user with context:
   - Time range
   - Type and composition
   - Description
   - Suggested prompt
   - Script context

3. Handle user response:
   - **Approve**: `approve_enhancement`
   - **Reject**: `reject_enhancement` with feedback
   - **Modify**: `regenerate_enhancement` with changes

4. Repeat until no pending items

### Step 3: Allow User Additions

Ask if user wants to add their own enhancements:
- Custom time ranges
- Specific visual ideas
- Music or sound effects

### Step 4: Complete Phase

When all enhancements are reviewed:

```
Use complete_enhancement_plan
```

## Presentation Format

### For Each Enhancement

```
═══════════════════════════════════════════════════════
📍 Enhancement #{index} of {total}
═══════════════════════════════════════════════════════

⏱️  Time: {start_time} → {end_time} ({duration}s)
🎬  Type: {type_icon} {type_name}
📐  Composition: {composition_mode}
📊  Confidence: {confidence}%

📝 Description:
{description}

💡 Suggested Prompt:
{prompt}

📖 Script Context:
"{segment_text}"

─────────────────────────────────────────────────────────
[A] Approve  [R] Reject  [M] Modify  [S] Skip for now
═══════════════════════════════════════════════════════
```

### Type Icons

- 🖼️ ai_image
- 🎬 ai_video_clip
- ✨ motion_graphic
- 🎵 audio_music
- 🔊 audio_sfx

### Composition Icons

- 📌 pip_overlay
- 🎞️ broll_cut
- 📊 split_screen
- 📑 lower_third
- 🎭 full_overlay

## User Interaction

### Starting the Phase
"Now let's plan your video enhancements! I have {count} suggestions based on your script analysis.

For each suggestion, you can:
- **Approve** - Include it in the final video
- **Reject** - Skip it with feedback
- **Modify** - Change the prompt or settings

Let's start with the first one..."

### After Approval
"Enhancement approved! ✅

Progress: {approved}/{total} approved, {pending} remaining

{next enhancement or completion message}"

### After Rejection
"Enhancement rejected. I've noted your feedback for future improvements.

Progress: {approved}/{total} approved, {pending} remaining"

### After Modification
"Enhancement updated with your changes. This will be regenerated with the new settings.

What would you like to do with this modified version?
[A] Approve  [M] Modify again"

### Phase Complete
"Enhancement planning complete! 🎉

**Summary:**
- ✅ Approved: {approved_count}
- ❌ Rejected: {rejected_count}
- ⏭️ Skipped: {skipped_count}

Ready to generate assets for your approved enhancements?
This will use AI to create:
{breakdown by type}

Proceed to asset generation?"

## Best Practices

1. **Group Related Enhancements**
   - Present enhancements for the same scene together
   - Show how they'll work together

2. **Provide Context**
   - Always show the script text
   - Explain why this enhancement was suggested

3. **Respect User Time**
   - Allow batch approvals for similar items
   - Provide skip option for undecided items

4. **Handle Edge Cases**
   - Overlapping time ranges
   - Conflicting compositions
   - Missing script segments
