/**
 * TruncatedText component - truncates text to a specified number of lines.
 * Shows a hint to expand with Ctrl+O when truncated.
 */
import React from 'react';
import { Text, Box } from 'ink';

interface TruncatedTextProps {
  /** The text content to display */
  text: string;
  /** Maximum number of lines to show when collapsed (default: 3) */
  maxLines?: number;
  /** Whether to show expanded view */
  expanded?: boolean;
  /** Text color */
  color?: string;
  /** Whether text is dimmed */
  dimColor?: boolean;
  /** Whether text is bold */
  bold?: boolean;
  /** Custom wrapper for the text (e.g., for markdown rendering) */
  children?: React.ReactNode;
}

/**
 * Truncate text to a maximum number of lines.
 * Returns the truncated text and whether truncation occurred.
 */
function truncateToLines(text: string, maxLines: number): { truncated: string; wasTruncated: boolean } {
  const lines = text.split('\n');
  if (lines.length <= maxLines) {
    return { truncated: text, wasTruncated: false };
  }
  const truncated = lines.slice(0, maxLines).join('\n');
  return { truncated, wasTruncated: true };
}

export function TruncatedText({
  text,
  maxLines = 3,
  expanded = false,
  color,
  dimColor,
  bold,
  children,
}: TruncatedTextProps) {
  // Always show full content - truncation disabled
  return (
    <Box flexDirection="column">
      {children ?? <Text color={color} dimColor={dimColor} bold={bold}>{text}</Text>}
    </Box>
  );
}

/**
 * Hook to get line count of text.
 */
export function getLineCount(text: string): number {
  return text.split('\n').length;
}

/**
 * Check if text would be truncated at given maxLines.
 */
export function wouldTruncate(text: string, maxLines: number): boolean {
  return text.split('\n').length > maxLines;
}
