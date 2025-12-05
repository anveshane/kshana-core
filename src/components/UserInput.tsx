/**
 * User input component for text and confirmation prompts.
 */
import React from 'react';
import { Text, Box, useInput, useApp } from 'ink';

interface UserInputProps {
  prompt?: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  isConfirmation?: boolean;
}

export function UserInput({
  prompt = '>',
  placeholder = 'Type your response...',
  onSubmit,
  isConfirmation = false,
}: UserInputProps) {
  const [value, setValue] = React.useState('');
  const { exit } = useApp();

  useInput((input, key) => {
    if (key.return) {
      if (isConfirmation) {
        // For confirmation, accept y/yes/n/no or the full text
        const normalized = value.toLowerCase().trim();
        if (normalized === 'y' || normalized === 'yes') {
          onSubmit('yes');
        } else if (normalized === 'n' || normalized === 'no') {
          onSubmit('no');
        } else if (value.trim()) {
          onSubmit(value);
        }
      } else if (value.trim()) {
        onSubmit(value);
      }
      setValue('');
    } else if (key.backspace || key.delete) {
      setValue(prev => prev.slice(0, -1));
    } else if (key.escape) {
      exit();
    } else if (input && !key.ctrl && !key.meta) {
      setValue(prev => prev + input);
    }
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      {isConfirmation ? (
        <Box>
          <Text color="cyan">{prompt} </Text>
          <Text dimColor>(y/n) </Text>
          <Text>{value}</Text>
          <Text color="cyan">▌</Text>
        </Box>
      ) : (
        <Box>
          <Text color="cyan">{prompt} </Text>
          {value ? (
            <>
              <Text>{value}</Text>
              <Text color="cyan">▌</Text>
            </>
          ) : (
            <Text dimColor>
              {placeholder}
              <Text color="cyan">▌</Text>
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}

/**
 * Simple text input without the full UserInput complexity.
 */
export function SimpleInput({
  onSubmit,
  prefix = '>',
}: {
  onSubmit: (value: string) => void;
  prefix?: string;
}) {
  const [value, setValue] = React.useState('');

  useInput((input, key) => {
    if (key.return && value.trim()) {
      onSubmit(value.trim());
      setValue('');
    } else if (key.backspace || key.delete) {
      setValue(prev => prev.slice(0, -1));
    } else if (input && !key.ctrl && !key.meta) {
      setValue(prev => prev + input);
    }
  });

  return (
    <Box>
      <Text color="cyan">{prefix} </Text>
      <Text>{value}</Text>
      <Text color="cyan">▌</Text>
    </Box>
  );
}
