# Ingest Phase

## Objective

Import the source video and prepare it for editing by extracting metadata and generating thumbnails.

## Available Tools

- `import_video` - Import video from local file, URL, or cloud storage
- `extract_metadata` - Extract video metadata using FFmpeg
- `generate_thumbnails` - Generate thumbnail strip for timeline
- `complete_ingest` - Mark ingest phase as complete

## Workflow

### Step 1: Import Video

Ask the user for the video source:
- Local file path
- URL (HTTP/HTTPS direct link)
- **YouTube URL** (requires yt-dlp installed)
- Cloud storage (Google Drive, Dropbox, S3)

```
Use import_video with:
- source_type: "local_file", "url", or "cloud_storage"
- path: The file path, URL, or cloud path
- cloud_provider: (if cloud_storage) "google_drive", "dropbox", or "s3"
```

**YouTube Support:**
- Accepts youtube.com and youtu.be URLs
- Automatically downloads best quality video+audio in MP4
- Requires yt-dlp to be installed (`brew install yt-dlp` or `pip install yt-dlp`)

### Step 2: Extract Metadata

Once the video is imported, extract its metadata:

```
Use extract_metadata (no parameters needed)
```

This provides:
- Duration
- Resolution (width x height)
- Frame rate (FPS)
- Video codec
- Bitrate
- Audio track information

### Step 3: Generate Thumbnails

Generate thumbnails for timeline visualization:

```
Use generate_thumbnails with optional:
- interval_seconds: How often to capture (default: 5)
- width: Thumbnail width (default: 160)
- height: Thumbnail height (default: 90)
```

### Step 4: Complete Ingest

Once all steps are done:

```
Use complete_ingest
```

This transitions to SCRIPT_PARSE phase.

## User Interaction

### Initial Prompt
"Welcome to the Video Editing Assistant! To get started, please provide your source video.

You can provide:
- A local file path (e.g., /path/to/video.mp4)
- A YouTube link (e.g., https://youtube.com/watch?v=...)
- A URL to download from (direct video link)
- A cloud storage link (Google Drive, Dropbox, S3)

What video would you like to enhance?"

### After Import
"Video imported successfully!

**Video Details:**
- Duration: {duration}
- Resolution: {width}x{height}
- Frame Rate: {fps} fps
- Format: {format}

Generating thumbnails for the timeline..."

### After Complete
"Ingest complete! Your video is ready for editing.

Next, I'll need a script or transcript for your video. This helps me identify the best places for enhancements.

Do you have a script file to provide, or would you like me to work with just the video?"

## Error Handling

### Video Import Failed
"I couldn't import the video. Please check:
- The file path is correct
- The URL is accessible
- You have permission to access the file

Would you like to try again with a different source?"

### Metadata Extraction Failed
"I couldn't extract the video metadata. The file might be:
- In an unsupported format
- Corrupted
- Still downloading

Let me try again or you can provide a different video."

### YouTube Download Failed
"I couldn't download the YouTube video. This could be because:
- yt-dlp is not installed (install with: `brew install yt-dlp` or `pip install yt-dlp`)
- The video is private or age-restricted
- The video is not available in your region
- The URL is invalid

Would you like to try a different video or provide a local file instead?"
