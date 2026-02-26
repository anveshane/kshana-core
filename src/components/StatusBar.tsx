/**
 * Status bar component showing agent state and context usage.
 */
import React from 'react';
import { Text, Box } from 'ink';
import { Spinner } from './Spinner.js';
import type { ContextUsageInfo } from '../hooks/useAgent.js';

type StatusType = 'idle' | 'thinking' | 'waiting' | 'completed' | 'error';

interface StatusBarProps {
  agentName?: string;
  status: StatusType;
  message?: string;
  contextUsage?: ContextUsageInfo | null;
  notification?: string | null;
}

const STATUS_CONFIG: Record<StatusType, { color: string; icon: string; label: string }> = {
  idle: { color: 'gray', icon: '○', label: 'Ready' },
  thinking: { color: 'yellow', icon: '💭', label: 'Thinking' },
  waiting: { color: 'cyan', icon: '?', label: 'Waiting for input' },
  completed: { color: 'green', icon: '✓', label: 'Completed' },
  error: { color: 'red', icon: '✗', label: 'Error' },
};

/**
 * Build a visual context usage bar.
 * e.g. "CTX [████████░░░░░░░░░░░░] 42% #5"
 */
function ContextBar({ usage }: { usage: ContextUsageInfo }) {
  const barWidth = 20;
  const filled = Math.round((usage.percentage / 100) * barWidth);
  const empty = barWidth - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);

  // Color based on usage level
  let color: string;
  if (usage.percentage >= 55) {
    color = 'red';
  } else if (usage.percentage >= 40) {
    color = 'yellow';
  } else {
    color = 'green';
  }

  return (
    <Box>
      <Text dimColor>CTX </Text>
      <Text color={color}>[{bar}]</Text>
      <Text dimColor> {usage.percentage}%</Text>
      <Text dimColor> #{usage.iteration}</Text>
    </Box>
  );
}

export const StatusBar = React.memo(function StatusBar({
  agentName = 'Agent',
  status,
  message,
  contextUsage,
  notification,
}: StatusBarProps) {
  const config = STATUS_CONFIG[status];

  return (
    <Box flexDirection="column">
      <Box borderStyle="single" borderColor="gray" paddingX={1} marginBottom={0}>
        <Box marginRight={2}>
          <Text color="cyan" bold>
            {agentName}
          </Text>
        </Box>
        <Box flexGrow={1}>
          {status === 'thinking' ? (
            <>
              <Text>{config.icon} </Text>
              <Spinner color={config.color} />
              <Text> {config.label}</Text>
            </>
          ) : (
            <Text color={config.color}>
              {config.icon} {config.label}
            </Text>
          )}
        </Box>
        {contextUsage && <ContextBar usage={contextUsage} />}
        {message && (
          <Box marginLeft={2}>
            <Text dimColor>- {message}</Text>
          </Box>
        )}
      </Box>
      {notification && (
        <Box paddingX={1} marginBottom={1}>
          <Text color="yellow">⚡ {notification}</Text>
        </Box>
      )}
      {!notification && <Box marginBottom={1} />}
    </Box>
  );
});
