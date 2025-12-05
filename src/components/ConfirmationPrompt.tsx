/**
 * Confirmation prompt for complex tool operations.
 */
import React from 'react';
import { Text, Box, useInput } from 'ink';

interface ConfirmationPromptProps {
  message: string;
  details?: Record<string, unknown>;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmationPrompt({
  message,
  details,
  onConfirm,
  onCancel,
}: ConfirmationPromptProps) {
  const [selected, setSelected] = React.useState<'yes' | 'no'>('yes');

  useInput((input, key) => {
    if (key.leftArrow || key.rightArrow || input === 'h' || input === 'l') {
      setSelected(prev => (prev === 'yes' ? 'no' : 'yes'));
    } else if (key.return) {
      if (selected === 'yes') {
        onConfirm();
      } else {
        onCancel();
      }
    } else if (input === 'y' || input === 'Y') {
      onConfirm();
    } else if (input === 'n' || input === 'N') {
      onCancel();
    } else if (key.escape) {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" padding={1} marginY={1}>
      <Box marginBottom={1}>
        <Text color="yellow" bold>
          Confirmation Required
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text>{message}</Text>
      </Box>

      {details && Object.keys(details).length > 0 && (
        <Box flexDirection="column" marginBottom={1} marginLeft={2}>
          {Object.entries(details).map(([key, value]) => (
            <Box key={key}>
              <Text dimColor>{key}: </Text>
              <Text>
                {typeof value === 'string'
                  ? value.length > 60
                    ? value.slice(0, 60) + '...'
                    : value
                  : JSON.stringify(value)}
              </Text>
            </Box>
          ))}
        </Box>
      )}

      <Box>
        <Text dimColor>Press </Text>
        <Box marginX={1}>
          <Text
            backgroundColor={selected === 'yes' ? 'green' : undefined}
            color={selected === 'yes' ? 'white' : 'green'}
            bold={selected === 'yes'}
          >
            {' '}
            Yes (y){' '}
          </Text>
        </Box>
        <Box marginX={1}>
          <Text
            backgroundColor={selected === 'no' ? 'red' : undefined}
            color={selected === 'no' ? 'white' : 'red'}
            bold={selected === 'no'}
          >
            {' '}
            No (n){' '}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
