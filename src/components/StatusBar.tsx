/**
 * Status bar component showing agent state.
 */
import React from 'react';
import { Text, Box } from 'ink';
import { Spinner } from './Spinner.js';

type StatusType = 'idle' | 'thinking' | 'waiting' | 'completed' | 'error';

interface StatusBarProps {
  agentName?: string;
  status: StatusType;
  message?: string;
}

const STATUS_CONFIG: Record<StatusType, { color: string; icon: string; label: string }> = {
  idle: { color: 'gray', icon: '○', label: 'Ready' },
  thinking: { color: 'yellow', icon: '💭', label: 'Thinking' },
  waiting: { color: 'cyan', icon: '?', label: 'Waiting for input' },
  completed: { color: 'green', icon: '✓', label: 'Completed' },
  error: { color: 'red', icon: '✗', label: 'Error' },
};

export const StatusBar = React.memo(function StatusBar({
  agentName = 'Agent',
  status,
  message,
}: StatusBarProps) {
  const config = STATUS_CONFIG[status];

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} marginBottom={1}>
      <Box marginRight={2}>
        <Text color="cyan" bold>
          {agentName}
        </Text>
      </Box>
      <Box>
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
      {message && (
        <Box marginLeft={2}>
          <Text dimColor>- {message}</Text>
        </Box>
      )}
    </Box>
  );
});
