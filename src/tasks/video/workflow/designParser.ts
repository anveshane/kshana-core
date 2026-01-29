/**
 * Design token parser utility (shared with remotion-infographics).
 * Extracts design tokens (colors, styles) from prompt text for infographic theming.
 */

export interface DesignTheme {
  backgroundColor: string;
  accentColor: string;
  textColor: string;
  textSecondaryColor: string;
  styleKeywords: string[];
}

export const defaultTheme: DesignTheme = {
  backgroundColor: '#0f172a',
  accentColor: '#60a5fa',
  textColor: '#f1f5f9',
  textSecondaryColor: '#94a3b8',
  styleKeywords: [],
};

const colorMap: Record<string, string> = {
  navy: '#0b1220',
  'dark navy': '#0b1220',
  'dark-navy': '#0b1220',
  darknavy: '#0b1220',
  black: '#000000',
  'dark black': '#000000',
  dark: '#0f172a',
  'dark background': '#0f172a',
  'dark bg': '#0f172a',
  white: '#ffffff',
  'light background': '#ffffff',
  'light bg': '#ffffff',
  gray: '#1e293b',
  'dark gray': '#1e293b',
  grey: '#1e293b',
  'dark grey': '#1e293b',
  cyan: '#22d3ee',
  blue: '#60a5fa',
  'light blue': '#60a5fa',
  green: '#22c55e',
  'light green': '#22c55e',
  emerald: '#10b981',
  teal: '#14b8a6',
  purple: '#a855f7',
  pink: '#ec4899',
  red: '#ef4444',
  orange: '#f97316',
  yellow: '#eab308',
  amber: '#f59e0b',
};

function extractHexColor(text: string, keyword: string): string | null {
  const patterns = [
    new RegExp(`${keyword}\\s*[:=]\\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})`, 'i'),
    new RegExp(`${keyword}\\s+(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})`, 'i'),
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1]!.toLowerCase();
    }
  }
  
  const keywordIndex = text.toLowerCase().indexOf(keyword);
  if (keywordIndex !== -1) {
    const afterKeyword = text.substring(keywordIndex + keyword.length);
    const hexMatch = afterKeyword.match(/#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}/i);
    if (hexMatch) {
      return hexMatch[0]!.toLowerCase();
    }
  }
  
  return null;
}

function extractColorName(text: string, keyword: string): string | null {
  const lowerText = text.toLowerCase();
  const keywordIndex = lowerText.indexOf(keyword);
  
  if (keywordIndex === -1) return null;
  
  // Look in a smaller window around the keyword (before and after) - only 15 chars to avoid matching unrelated colors
  const beforeKeyword = lowerText.substring(Math.max(0, keywordIndex - 15), keywordIndex).trim();
  const afterKeyword = lowerText.substring(keywordIndex + keyword.length, keywordIndex + keyword.length + 15).trim();
  
  // Sort colors by length (longest first) to match "dark navy" before "navy"
  const sortedColors = Object.keys(colorMap).sort((a, b) => b.length - a.length);
  
  // Check beforeKeyword first (e.g., "dark navy background" or "white text")
  for (const colorName of sortedColors) {
    // Check if color appears right before keyword (within a few words)
    const beforePattern = new RegExp(`\\b${colorName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s,:-]*$`, 'i');
    if (beforePattern.test(beforeKeyword)) {
      return colorMap[colorName]!;
    }
  }
  
  // Then check afterKeyword (e.g., "background: navy" or "accent: cyan")
  for (const colorName of sortedColors) {
    // Check if color appears right after keyword (within a few words, stop at comma/sentence end)
    const afterPattern = new RegExp(`^[\\s,:-]*${colorName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const afterMatch = afterKeyword.match(afterPattern);
    if (afterMatch) {
      // Make sure we're not matching colors that are part of another phrase (e.g., "white text" when searching for "background")
      const matchEnd = afterMatch[0]!.length;
      const remaining = afterKeyword.substring(matchEnd);
      // If there's a comma or the remaining text suggests it's part of another phrase, skip it
      if (remaining.trim().length === 0 || remaining.match(/^[,.]/)) {
        return colorMap[colorName]!;
      }
    }
  }
  
  return null;
}

function extractBackgroundColor(prompt: string): string {
  const hexBg = extractHexColor(prompt, 'background') || 
                extractHexColor(prompt, 'bg') ||
                extractHexColor(prompt, 'background-color');
  if (hexBg) return hexBg;
  
  const colorBg = extractColorName(prompt, 'background') ||
                  extractColorName(prompt, 'bg');
  if (colorBg) return colorBg;
  
  const lowerPrompt = prompt.toLowerCase();
  if (lowerPrompt.includes('dark background') || lowerPrompt.includes('dark bg')) {
    return '#0f172a';
  }
  if (lowerPrompt.includes('light background') || lowerPrompt.includes('light bg')) {
    return '#ffffff';
  }
  if (lowerPrompt.includes('navy background') || lowerPrompt.includes('dark navy')) {
    return '#0b1220';
  }
  
  return defaultTheme.backgroundColor;
}

function extractAccentColor(prompt: string): string {
  const hexAccent = extractHexColor(prompt, 'accent') ||
                    extractHexColor(prompt, 'highlight') ||
                    extractHexColor(prompt, 'primary');
  if (hexAccent) return hexAccent;
  
  const colorAccent = extractColorName(prompt, 'accent') ||
                      extractColorName(prompt, 'highlight') ||
                      extractColorName(prompt, 'primary');
  if (colorAccent) return colorAccent;
  
  const lowerPrompt = prompt.toLowerCase();
  if (lowerPrompt.includes('cyan accent') || lowerPrompt.includes('cyan highlight')) {
    return '#22d3ee';
  }
  if (lowerPrompt.includes('green') && (lowerPrompt.includes('check') || lowerPrompt.includes('icon'))) {
    return '#22c55e';
  }
  if (lowerPrompt.includes('blue accent') || lowerPrompt.includes('blue highlight')) {
    return '#60a5fa';
  }
  
  return defaultTheme.accentColor;
}

function extractTextColor(prompt: string): string {
  const hexText = extractHexColor(prompt, 'text') ||
                  extractHexColor(prompt, 'text-color') ||
                  extractHexColor(prompt, 'color');
  if (hexText) return hexText;
  
  const colorText = extractColorName(prompt, 'text');
  if (colorText) return colorText;
  
  const lowerPrompt = prompt.toLowerCase();
  if (lowerPrompt.includes('white text') || lowerPrompt.includes('light text')) {
    return '#ffffff';
  }
  if (lowerPrompt.includes('dark text') || lowerPrompt.includes('black text')) {
    return '#000000';
  }
  
  return defaultTheme.textColor;
}

function extractStyleKeywords(prompt: string): string[] {
  const keywords: string[] = [];
  const lowerPrompt = prompt.toLowerCase();
  
  const styleTerms = [
    'glassmorphism',
    'minimal',
    'minimalist',
    'bold',
    'modern',
    'clean',
    'crisp',
    'subtle',
    'vibrant',
    'elegant',
    'playful',
    'professional',
    'documentary',
    'sans-serif',
    'serif',
  ];
  
  for (const term of styleTerms) {
    if (lowerPrompt.includes(term)) {
      keywords.push(term);
    }
  }
  
  return keywords;
}

export function parseDesignTheme(prompt: string): DesignTheme {
  const backgroundColor = extractBackgroundColor(prompt);
  const accentColor = extractAccentColor(prompt);
  const textColor = extractTextColor(prompt);
  const styleKeywords = extractStyleKeywords(prompt);
  
  let textSecondaryColor = defaultTheme.textSecondaryColor;
  if (textColor === '#ffffff') {
    textSecondaryColor = '#94a3b8';
  } else if (textColor === '#000000') {
    textSecondaryColor = '#475569';
  } else if (textColor !== defaultTheme.textColor) {
    textSecondaryColor = textColor + 'cc';
  }
  
  return {
    backgroundColor,
    accentColor,
    textColor,
    textSecondaryColor,
    styleKeywords,
  };
}
