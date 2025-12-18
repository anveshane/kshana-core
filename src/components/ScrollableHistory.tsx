/**
 * Scrollable history component using Ink's Static for stable rendering.
 * Uses Static to render history items once, preventing re-renders that
 * break text selection and cause scroll jumping.
 */
import React from 'react';
import { Text, Box, Static } from 'ink';
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

/**
 * Render a single history entry.
 */
function HistoryItem({ entry, expanded }: { entry: HistoryEntry; expanded: boolean }) {
  if (entry.type === 'user_input') {
    return (
      <Box marginBottom={1} borderStyle="round" borderColor="green" paddingX={1} flexDirection="column">
        <Text color="green" bold>You: </Text>
        <TruncatedText text={entry.content} maxLines={MAX_LINES_TRUNCATED} expanded={expanded} />
      </Box>
    );
  }

  if (entry.type === 'tool_completed' && entry.toolName) {
    return (
      <ToolCallDisplay
        toolName={entry.toolName}
        args={entry.toolArgs}
        status="completed"
        result={entry.toolResult}
        duration={entry.duration}
        compact
        expanded={expanded}
        agentName={entry.agentName}
        streamingContent={entry.streamingContent}
      />
    );
  }

  if (entry.type === 'agent_text') {
    return (
      <Box marginBottom={1} flexDirection="column">
        {entry.agentName && (
          <Text color="cyan">[{entry.agentName}]</Text>
        )}
        <TruncatedText text={entry.content} maxLines={MAX_LINES_TRUNCATED} expanded={expanded} />
      </Box>
    );
  }

  return null;
}

export function ScrollableHistory({
  history,
  maxVisible = 10,
  expanded = false,
  scrollEnabled = false,
}: ScrollableHistoryProps) {
  // Filter out hidden tools
  const filteredHistory = React.useMemo(() => {
    return history.filter(entry => {
      if (entry.type === 'tool_completed' && entry.toolName) {
        return !HIDDEN_TOOLS.has(entry.toolName);
      }
      return true;
    });
  }, [history]);

  if (filteredHistory.length === 0) {
    return null;
  }

  // Use Static to render history items - they won't re-render once rendered
  // This allows text selection and prevents scroll jumping
  return (
    <Box flexDirection="column">
      <Static items={filteredHistory}>
        {(entry) => (
          <Box key={entry.id} flexDirection="column">
            <HistoryItem entry={entry} expanded={expanded} />
          </Box>
        )}
      </Static>
    </Box>
  );
}
