/**
 * Parser utility for video-placements.md file.
 * Extracts structured placement data from the markdown file.
 */

export interface ParsedVideoPlacement {
  placementNumber: number;
  startTime: string;
  endTime: string;
  videoType: 'animation' | 'stock_footage' | 'motion_graphics';
  prompt: string;
  duration: number; // Calculated from timestamps, rounded to 5, 10, or 15
  filename: string;
}

/**
 * Convert time string (e.g., "0:15", "7:41", "1:10") to seconds.
 */
function timeToSeconds(timeStr: string): number {
  const parts = timeStr.split(':');
  if (parts.length === 2) {
    const minutes = parseInt(parts[0], 10) || 0;
    const seconds = parseInt(parts[1], 10) || 0;
    return minutes * 60 + seconds;
  }
  // If it's just seconds (e.g., "15")
  return parseInt(timeStr, 10) || 0;
}

/**
 * Round duration to nearest valid value (4 or 5 seconds for optimization).
 */
function roundDuration(seconds: number): number {
  // Optimized for speed: prefer 4-5 seconds instead of longer durations
  if (seconds <= 4.5) return 4;
  return 5;
}

/**
 * Parse video placements from the video-placements.md file content.
 * 
 * Expected format:
 * - Placement N: startTime-endTime | type=video_type | prompt text | filename.mp4
 * 
 * @param content - The content of the video-placements.md file
 * @returns Array of parsed placements, sorted by placement number
 */
export function parseVideoPlacements(content: string): ParsedVideoPlacement[] {
  const placements: ParsedVideoPlacement[] = [];
  
  // Split by lines and process each line
  const lines = content.split('\n');
  
  for (const line of lines) {
    // Look for lines that start with "- Placement" or "• Placement" or just "Placement"
    const trimmedLine = line.trim();
    if (!trimmedLine.includes('Placement')) {
      continue;
    }
    
    // Match pattern: - Placement N: startTime-endTime | type=video_type | prompt | filename
    // Also handle: • Placement N: ... (bullet point)
    // Example: - Placement 1: 0:15-0:24 | type=animation | Animated map... | video.mp4
    const placementMatch = trimmedLine.match(/^[•\-]\s*Placement\s+(\d+):\s*([^\|]+)\s*\|\s*type=([^\|]+)\s*\|\s*([^\|]+)\s*\|\s*(.+)$/);
    
    if (!placementMatch || !placementMatch[1] || !placementMatch[2] || !placementMatch[3] || !placementMatch[4] || !placementMatch[5]) {
      // Try alternative format without leading dash/bullet
      const altMatch = trimmedLine.match(/Placement\s+(\d+):\s*([^\|]+)\s*\|\s*type=([^\|]+)\s*\|\s*([^\|]+)\s*\|\s*(.+)$/);
      if (!altMatch || !altMatch[1] || !altMatch[2] || !altMatch[3] || !altMatch[4] || !altMatch[5]) {
        continue;
      }
      
      const placementNumber = parseInt(altMatch[1], 10);
      const timeRange = altMatch[2].trim();
      const videoTypeStr = altMatch[3].trim();
      const prompt = altMatch[4].trim();
      const filename = altMatch[5].trim();
      
      // Parse time range (format: "0:15-0:24" or "7:41-7:56")
      const timeMatch = timeRange.match(/^([\d:]+)-([\d:]+)$/);
      if (!timeMatch || !timeMatch[1] || !timeMatch[2]) {
        continue;
      }
      
      const startTime = timeMatch[1];
      const endTime = timeMatch[2];
      const startSeconds = timeToSeconds(startTime);
      const endSeconds = timeToSeconds(endTime);
      const duration = roundDuration(endSeconds - startSeconds);
      
      // Normalize video type
      const normalizedType = videoTypeStr.toLowerCase().trim();
      let videoType: 'animation' | 'stock_footage' | 'motion_graphics';
      if (normalizedType === 'animation' || normalizedType === 'anim') {
        videoType = 'animation';
      } else if (normalizedType === 'stock_footage' || normalizedType === 'stock') {
        videoType = 'stock_footage';
      } else if (normalizedType === 'motion_graphics' || normalizedType === 'motiongraphics' || normalizedType === 'motion') {
        videoType = 'motion_graphics';
      } else {
        // Default to animation if unknown
        videoType = 'animation';
      }
      
      placements.push({
        placementNumber,
        startTime,
        endTime,
        videoType,
        prompt,
        duration,
        filename,
      });
      continue;
    }
    
    const placementNumber = parseInt(placementMatch[1], 10);
    const timeRange = placementMatch[2].trim();
    const videoTypeStr = placementMatch[3].trim();
    const prompt = placementMatch[4].trim();
    const filename = placementMatch[5].trim();
    
    // Parse time range (format: "0:15-0:24" or "7:41-7:56")
    const timeMatch = timeRange.match(/^([\d:]+)-([\d:]+)$/);
    if (!timeMatch || !timeMatch[1] || !timeMatch[2]) {
      continue;
    }
    
    const startTime = timeMatch[1];
    const endTime = timeMatch[2];
    const startSeconds = timeToSeconds(startTime);
    const endSeconds = timeToSeconds(endTime);
    const duration = roundDuration(endSeconds - startSeconds);
    
    // Normalize video type
    const normalizedType = videoTypeStr.toLowerCase().trim();
    let videoType: 'animation' | 'stock_footage' | 'motion_graphics';
    if (normalizedType === 'animation' || normalizedType === 'anim') {
      videoType = 'animation';
    } else if (normalizedType === 'stock_footage' || normalizedType === 'stock') {
      videoType = 'stock_footage';
    } else if (normalizedType === 'motion_graphics' || normalizedType === 'motiongraphics' || normalizedType === 'motion') {
      videoType = 'motion_graphics';
    } else {
      // Default to animation if unknown
      videoType = 'animation';
    }
    
    placements.push({
      placementNumber,
      startTime,
      endTime,
      videoType,
      prompt,
      duration,
      filename,
    });
  }
  
  // Sort by placement number
  placements.sort((a, b) => a.placementNumber - b.placementNumber);
  
  return placements;
}
