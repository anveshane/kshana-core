/**
 * Scrollable history component with keyboard navigation.
 * Allows users to scroll through history with arrow keys.
 * Supports text truncation with Ctrl+O toggle.
 */
import React from 'react';
import { Text, Box, useInput } from 'ink';
import { ToolCallDisplay, HIDDEN_TOOLS } from './ToolCallDisplay.js';
import { TruncatedText } from './TruncatedText.js';
import type { HistoryEntry } from '../hooks/useAgent.js';

/** Maximum lines to show before truncation */
const MAX_LINES_TRUNCATED = 3;

interface ScrollableHistoryProps {
  history: HistoryEntry[];
  maxVisible?: number;
  expanded?: boolean;
  /** Whether scroll controls are active (agent not actively working) */
  scrollEnabled?: boolean;
}

export function ScrollableHistory({
  history,
  maxVisible = 10,
  expanded = false,
  scrollEnabled = false,
}: ScrollableHistoryProps) {
  const [scrollOffset, setScrollOffset] = React.useState(0);
  const [isUserScrolled, setIsUserScrolled] = React.useState(false);

  // Filter out hidden tools
  const filteredHistory = React.useMemo(() => {
    return history.filter(entry => {
      if (entry.type === 'tool_completed' && entry.toolName) {
        return !HIDDEN_TOOLS.has(entry.toolName);
      }
      return true;
    });
  }, [history]);

  const totalItems = filteredHistory.length;
  const maxOffset = Math.max(0, totalItems - maxVisible);

  // Auto-scroll to bottom when new items added (unless user manually scrolled)
  React.useEffect(() => {
    if (!isUserScrolled) {
      setScrollOffset(maxOffset);
    }
  }, [totalItems, maxOffset, isUserScrolled]);

  // Reset user scroll when history is cleared
  React.useEffect(() => {
    if (totalItems === 0) {
      setIsUserScrolled(false);
      setScrollOffset(0);
    }
  }, [totalItems]);

  // Handle keyboard navigation
  useInput((input, key) => {
    if (!scrollEnabled || totalItems <= maxVisible) return;

    if (key.upArrow || input === 'k') {
      setScrollOffset(prev => Math.max(0, prev - 1));
      setIsUserScrolled(true);
    } else if (key.downArrow || input === 'j') {
      const newOffset = Math.min(maxOffset, scrollOffset + 1);
      setScrollOffset(newOffset);
      // If scrolled to bottom, reset user scroll flag
      if (newOffset === maxOffset) {
        setIsUserScrolled(false);
      }
    } else if (key.pageUp) {
      setScrollOffset(prev => Math.max(0, prev - 5));
      setIsUserScrolled(true);
    } else if (key.pageDown) {
      const newOffset = Math.min(maxOffset, scrollOffset + 5);
      setScrollOffset(newOffset);
      if (newOffset === maxOffset) {
        setIsUserScrolled(false);
      }
    } else if (input === 'g') {
      // Go to top
      setScrollOffset(0);
      setIsUserScrolled(true);
    } else if (input === 'G') {
      // Go to bottom
      setScrollOffset(maxOffset);
      setIsUserScrolled(false);
    }
  }, { isActive: scrollEnabled });

  // Calculate visible items
  const visibleHistory = filteredHistory.slice(scrollOffset, scrollOffset + maxVisible);
  const hiddenAbove = scrollOffset;
  const hiddenBelow = Math.max(0, totalItems - scrollOffset - maxVisible);

  if (totalItems === 0) {
    return null;
  }

  return (
    <Box flexDirection="column">
      {/* Scroll indicator - top */}
      {hiddenAbove > 0 && (
        <Box>
          <Text dimColor>
            ↑ {hiddenAbove} earlier {hiddenAbove === 1 ? 'action' : 'actions'}
            {scrollEnabled && ' (↑/k to scroll)'}
          </Text>
        </Box>
      )}

      {/* Visible history items */}
      {visibleHistory.map((entry) => {
        if (entry.type === 'user_input') {
          return (
            <Box key={entry.id} marginBottom={1} borderStyle="round" borderColor="green" paddingX={1} flexDirection="column">
              <Text color="green" bold>👤 You: </Text>
              <TruncatedText text={entry.content} maxLines={MAX_LINES_TRUNCATED} expanded={expanded} />
            </Box>
          );
        }
        if (entry.type === 'tool_completed' && entry.toolName) {
          return (
            <ToolCallDisplay
              key={entry.id}
              toolName={entry.toolName}
              args={entry.toolArgs}
              status="completed"
              result={entry.toolResult}
              duration={entry.duration}
              compact
              expanded={expanded}
              agentName={entry.agentName}
            />
          );
        }
        if (entry.type === 'agent_text') {
          return (
            <Box key={entry.id} marginBottom={1} flexDirection="column">
              {entry.agentName && (
                <Text color="cyan" dimColor>[{entry.agentName}]</Text>
              )}
              <TruncatedText text={entry.content} maxLines={MAX_LINES_TRUNCATED} expanded={expanded} dimColor />
            </Box>
          );
        }
        return null;
      })}

      {/* Scroll indicator - bottom */}
      {hiddenBelow > 0 && (
        <Box>
          <Text dimColor>
            ↓ {hiddenBelow} more {hiddenBelow === 1 ? 'action' : 'actions'}
            {scrollEnabled && ' (↓/j to scroll)'}
          </Text>
        </Box>
      )}

      {/* Scroll controls hint */}
      {scrollEnabled && totalItems > maxVisible && (
        <Box marginTop={1}>
          <Text dimColor italic>
            Scroll: ↑↓/jk | Page: PgUp/PgDn | Jump: g/G
          </Text>
        </Box>
      )}
    </Box>
  );
}
