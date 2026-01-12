/**
 * Parser utility for image-placements.md file.
 * Extracts structured placement data from the markdown file.
 */

export interface ParsedImagePlacement {
  placementNumber: number;
  startTime: string;
  endTime: string;
  prompt: string;
  filename: string;
}

/**
 * Parse image placements from the image-placements.md file content.
 * 
 * Expected format:
 * - Placement N: startTime-endTime | prompt text | filename.png
 * 
 * @param content - The content of the image-placements.md file
 * @returns Array of parsed placements, sorted by placement number
 */
export function parseImagePlacements(content: string): ParsedImagePlacement[] {
  const placements: ParsedImagePlacement[] = [];
  
  // Split by lines and process each line
  const lines = content.split('\n');
  
  for (const line of lines) {
    // Look for lines that start with "- Placement"
    const trimmedLine = line.trim();
    if (!trimmedLine.startsWith('- Placement')) {
      continue;
    }
    
    // Match pattern: - Placement N: startTime-endTime | prompt | filename
    // Example: - Placement 1: 0:08-0:24 | A serene depiction... | image_river_ganga.png
    const placementMatch = trimmedLine.match(/^-\s+Placement\s+(\d+):\s*([^\|]+)\s*\|\s*([^\|]+)\s*\|\s*(.+)$/);
    
    if (!placementMatch || !placementMatch[1] || !placementMatch[2] || !placementMatch[3] || !placementMatch[4]) {
      // Try alternative format without leading dash or with different spacing
      const altMatch = trimmedLine.match(/Placement\s+(\d+):\s*([^\|]+)\s*\|\s*([^\|]+)\s*\|\s*(.+)$/);
      if (!altMatch || !altMatch[1] || !altMatch[2] || !altMatch[3] || !altMatch[4]) {
        continue;
      }
      
      const placementNumber = parseInt(altMatch[1], 10);
      const timeRange = altMatch[2].trim();
      const prompt = altMatch[3].trim();
      const filename = altMatch[4].trim();
      
      // Parse time range (format: "0:08-0:24" or "04:08-04:24")
      const timeMatch = timeRange.match(/^([\d:]+)-([\d:]+)$/);
      if (!timeMatch || !timeMatch[1] || !timeMatch[2]) {
        continue;
      }
      
      placements.push({
        placementNumber,
        startTime: timeMatch[1],
        endTime: timeMatch[2],
        prompt,
        filename,
      });
      continue;
    }
    
    const placementNumber = parseInt(placementMatch[1], 10);
    const timeRange = placementMatch[2].trim();
    const prompt = placementMatch[3].trim();
    const filename = placementMatch[4].trim();
    
    // Parse time range (format: "0:08-0:24" or "04:08-04:24")
    const timeMatch = timeRange.match(/^([\d:]+)-([\d:]+)$/);
    if (!timeMatch || !timeMatch[1] || !timeMatch[2]) {
      continue;
    }
    
    placements.push({
      placementNumber,
      startTime: timeMatch[1],
      endTime: timeMatch[2],
      prompt,
      filename,
    });
  }
  
  // Sort by placement number
  placements.sort((a, b) => a.placementNumber - b.placementNumber);
  
  return placements;
}
