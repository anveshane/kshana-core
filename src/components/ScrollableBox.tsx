/**
 * Scrollable container component with manual scroll support.
 * Allows keyboard navigation through content that exceeds visible height.
 */
import React from 'react';
import { Box, Text, useInput } from 'ink';

interface ScrollableBoxProps {
  /** Maximum height in lines */
  maxHeight: number;
  /** Content to display */
  children: React.ReactNode;
  /** Auto-scroll to bottom when new content is added */
  autoScroll?: boolean;
  /** Whether this component should capture keyboard input for scrolling */
  active?: boolean;
  /** Callback when scroll position changes */
  onScroll?: (offset: number) => void;
}

/**
 * A scrollable container that supports manual keyboard navigation.
 *
 * When active:
 * - Arrow Up/Down: Scroll one line
 * - Page Up/Down: Scroll 5 lines
 * - Home: Scroll to top
 * - End: Scroll to bottom
 */
export function ScrollableBox({
  maxHeight,
  children,
  autoScroll = true,
  active = false,
  onScroll,
}: ScrollableBoxProps) {
  const [scrollOffset, setScrollOffset] = React.useState(0);
  const childArray = React.Children.toArray(children);

  // Estimate total content height (each child ~1-3 lines)
  // This is a simplification - for precise scrolling we'd need to measure
  const totalItems = childArray.length;

  // Calculate how many items can be visible
  // Reserve 2 lines for scroll indicators if needed
  const visibleHeight = maxHeight - 2;
  const itemsPerPage = Math.max(1, visibleHeight);

  // Max scroll offset
  const maxOffset = Math.max(0, totalItems - itemsPerPage);

  // Auto-scroll to bottom when content changes
  React.useEffect(() => {
    if (autoScroll && !active) {
      setScrollOffset(maxOffset);
    }
  }, [totalItems, maxOffset, autoScroll, active]);

  // Handle keyboard input for scrolling
  useInput((input, key) => {
    if (!active) return;

    let newOffset = scrollOffset;

    if (key.upArrow) {
      newOffset = Math.max(0, scrollOffset - 1);
    } else if (key.downArrow) {
      newOffset = Math.min(maxOffset, scrollOffset + 1);
    } else if (key.pageUp) {
      newOffset = Math.max(0, scrollOffset - 5);
    } else if (key.pageDown) {
      newOffset = Math.min(maxOffset, scrollOffset + 5);
    } else if (input === 'g' && key.ctrl) {
      // Ctrl+G: Go to top
      newOffset = 0;
    } else if (input === 'G') {
      // Shift+G: Go to bottom
      newOffset = maxOffset;
    }

    if (newOffset !== scrollOffset) {
      setScrollOffset(newOffset);
      onScroll?.(newOffset);
    }
  }, { isActive: active });

  // Slice children to show only visible portion
  const visibleChildren = childArray.slice(scrollOffset, scrollOffset + itemsPerPage);

  // Check if there's more content above/below
  const hasMoreAbove = scrollOffset > 0;
  const hasMoreBelow = scrollOffset < maxOffset;

  // Don't show anything if no children
  if (childArray.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" height={maxHeight} overflow="hidden">
      {/* Scroll up indicator */}
      {hasMoreAbove && (
        <Box>
          <Text dimColor>↑ {scrollOffset} more above {active ? '(↑/PgUp to scroll)' : ''}</Text>
        </Box>
      )}

      {/* Visible content */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {visibleChildren}
      </Box>

      {/* Scroll down indicator */}
      {hasMoreBelow && (
        <Box>
          <Text dimColor>↓ {maxOffset - scrollOffset} more below {active ? '(↓/PgDn to scroll)' : ''}</Text>
        </Box>
      )}
    </Box>
  );
}
