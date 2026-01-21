/**
 * Parser utility for image-placements.md file.
 * Extracts structured placement data from the markdown file.
 */

export interface ParsedImagePlacement {
  placementNumber: number;
  startTime: string;
  endTime: string;
  prompt: string;
  
}

/**
 * Parse image placements from the image-placements.md file content.
 * 
 * Expected format (filename-free, preferred):
 * - Placement N: startTime-endTime | prompt text
 * 
 * Legacy format (with filename, still supported but filename is ignored):
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
    
    // Try filename-free format first: - Placement N: startTime-endTime | prompt
    const noFilenameMatch = trimmedLine.match(/^-\s+Placement\s+(\d+):\s*([^\|]+)\s*\|\s*([^\|]+)$/);
    
    if (noFilenameMatch && noFilenameMatch[1] && noFilenameMatch[2] && noFilenameMatch[3]) {
      const placementNumber = parseInt(noFilenameMatch[1], 10);
      const timeRange = noFilenameMatch[2].trim();
      const prompt = noFilenameMatch[3].trim();
      
      // Parse time range (format: "0:08-0:24" or "04:08-04:24")
      const timeMatch = timeRange.match(/^([\d:]+)-([\d:]+)$/);
      if (timeMatch && timeMatch[1] && timeMatch[2]) {
        placements.push({
          placementNumber,
          startTime: timeMatch[1],
          endTime: timeMatch[2],
          prompt,
        });
        continue;
      }
    }
    
    // Try format with filename (legacy support, filename is ignored)
    const withFilenameMatch = trimmedLine.match(/^-\s+Placement\s+(\d+):\s*([^\|]+)\s*\|\s*([^\|]+)\s*\|\s*(.+)$/);
    
    if (withFilenameMatch && withFilenameMatch[1] && withFilenameMatch[2] && withFilenameMatch[3]) {
      const placementNumber = parseInt(withFilenameMatch[1], 10);
      const timeRange = withFilenameMatch[2].trim();
      const prompt = withFilenameMatch[3].trim();
      // filename is ignored (withFilenameMatch[4])
      
      // Parse time range (format: "0:08-0:24" or "04:08-04:24")
      const timeMatch = timeRange.match(/^([\d:]+)-([\d:]+)$/);
      if (timeMatch && timeMatch[1] && timeMatch[2]) {
        placements.push({
          placementNumber,
          startTime: timeMatch[1],
          endTime: timeMatch[2],
          prompt,
        });
        continue;
      }
    }
    
    // Try alternative format without leading dash
    const altMatch = trimmedLine.match(/Placement\s+(\d+):\s*([^\|]+)\s*\|\s*([^\|]+)$/);
    if (altMatch && altMatch[1] && altMatch[2] && altMatch[3]) {
      const placementNumber = parseInt(altMatch[1], 10);
      const timeRange = altMatch[2].trim();
      const prompt = altMatch[3].trim();
      
      const timeMatch = timeRange.match(/^([\d:]+)-([\d:]+)$/);
      if (timeMatch && timeMatch[1] && timeMatch[2]) {
        placements.push({
          placementNumber,
          startTime: timeMatch[1],
          endTime: timeMatch[2],
          prompt,
        });
      }
    }
  }
  
  // Sort by placement number
  placements.sort((a, b) => a.placementNumber - b.placementNumber);
  
  return placements;
}
