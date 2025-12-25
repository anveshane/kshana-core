/**
 * User input component for text and confirmation prompts.
 */
import React from 'react';
import { Text, Box, useInput, useApp } from 'ink';

/**
 * Format input value for display:
 * - Collapse newlines to single space (for single-line display)
 * - No truncation - show full content
 */
function formatForDisplay(value: string): string {
  // Replace all whitespace sequences (newlines, tabs, multiple spaces) with single space
  return value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

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
      // Filter out newlines, control chars and normalize whitespace when adding input
      const sanitized = input
        .replace(/[\r\n\t\x00-\x1F\x7F]/g, ' ')
        .replace(/\s+/g, ' ');
      if (sanitized) {
        setValue(prev => prev + sanitized);
      }
    }
  });

  // Format for display (collapse newlines)
  const displayValue = formatForDisplay(value);

  return (
    <Box flexDirection="column" marginTop={1}>
      {isConfirmation ? (
        <Box>
          <Text color="cyan">{prompt} </Text>
          <Text dimColor>(y/n) </Text>
          <Text>{displayValue}</Text>
          <Text color="cyan">▌</Text>
        </Box>
      ) : (
        <Box>
          <Text color="cyan">{prompt} </Text>
          {value ? (
            <>
              <Text>{displayValue}</Text>
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
  placeholder,
}: {
  onSubmit: (value: string) => void;
  prefix?: string;
  placeholder?: string;
}) {
  const [value, setValue] = React.useState('');

  useInput((input, key) => {
    if (key.return && value.trim()) {
      onSubmit(value.trim());
      setValue('');
    } else if (key.backspace || key.delete) {
      setValue(prev => prev.slice(0, -1));
    } else if (input && !key.ctrl && !key.meta) {
      // Filter out newlines, control chars and normalize whitespace when adding input
      const sanitized = input
        .replace(/[\r\n\t\x00-\x1F\x7F]/g, ' ')
        .replace(/\s+/g, ' ');
      if (sanitized) {
        setValue(prev => prev + sanitized);
      }
    }
  });

  // Format for display (collapse newlines)
  const displayValue = formatForDisplay(value);

  return (
    <Box>
      <Text color="cyan">{prefix} </Text>
      {value ? (
        <>
          <Text>{displayValue}</Text>
          <Text color="cyan">▌</Text>
        </>
      ) : placeholder ? (
        <Text dimColor>
          {placeholder}
          <Text color="cyan">▌</Text>
        </Text>
      ) : (
        <Text color="cyan">▌</Text>
      )}
    </Box>
  );
}
