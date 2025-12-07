/**
 * Text input component with cursor support and multi-line display.
 * Supports arrow keys for cursor movement and full text editing.
 */
import React from 'react';
import { Text, Box, useInput } from 'ink';

interface TextInputProps {
  /** Current value */
  value: string;
  /** Called when value changes */
  onChange: (value: string) => void;
  /** Called when Enter is pressed */
  onSubmit?: (value: string) => void;
  /** Prompt/prefix shown before input */
  prompt?: string;
  /** Placeholder when empty */
  placeholder?: string;
  /** Whether the input is focused */
  focus?: boolean;
  /** Show cursor */
  showCursor?: boolean;
}

export function TextInput({
  value,
  onChange,
  onSubmit,
  prompt = '>',
  placeholder = '',
  focus = true,
  showCursor = true,
}: TextInputProps) {
  const [cursorPos, setCursorPos] = React.useState(value.length);
  const [lastEscapeTime, setLastEscapeTime] = React.useState(0);

  // Keep cursor in bounds when value changes externally
  React.useEffect(() => {
    if (cursorPos > value.length) {
      setCursorPos(value.length);
    }
  }, [value, cursorPos]);

  useInput(
    (input, key) => {
      if (!focus) return;

      // Double Escape to clear input
      if (key.escape) {
        const now = Date.now();
        if (now - lastEscapeTime < 500) {
          // Double escape within 500ms - clear input
          onChange('');
          setCursorPos(0);
          setLastEscapeTime(0);
        } else {
          setLastEscapeTime(now);
        }
        return;
      }

      if (key.return) {
        onSubmit?.(value);
        return;
      }

      if (key.leftArrow) {
        setCursorPos(prev => Math.max(0, prev - 1));
        return;
      }

      if (key.rightArrow) {
        setCursorPos(prev => Math.min(value.length, prev + 1));
        return;
      }

      // Home - go to start
      if (key.ctrl && input === 'a') {
        setCursorPos(0);
        return;
      }

      // End - go to end
      if (key.ctrl && input === 'e') {
        setCursorPos(value.length);
        return;
      }

      if (key.backspace || key.delete) {
        if (cursorPos > 0) {
          const newValue = value.slice(0, cursorPos - 1) + value.slice(cursorPos);
          onChange(newValue);
          setCursorPos(prev => prev - 1);
        }
        return;
      }

      // Delete key (forward delete)
      if (key.ctrl && input === 'd') {
        if (cursorPos < value.length) {
          const newValue = value.slice(0, cursorPos) + value.slice(cursorPos + 1);
          onChange(newValue);
        }
        return;
      }

      // Regular character input - filter out control characters and newlines
      if (input && !key.ctrl && !key.meta) {
        // Replace newlines and all control characters with spaces for single-line input
        // Also collapse multiple spaces into one
        const sanitized = input
          .replace(/[\r\n\t\x00-\x1F\x7F]/g, ' ')  // Replace control chars with space
          .replace(/\s+/g, ' ');  // Collapse multiple spaces
        if (sanitized) {
          const newValue = value.slice(0, cursorPos) + sanitized + value.slice(cursorPos);
          onChange(newValue);
          setCursorPos(prev => prev + sanitized.length);
        }
      }
    },
    { isActive: focus }
  );

  // Render the text with cursor
  const renderWithCursor = () => {
    if (!value && placeholder) {
      return (
        <Text dimColor>
          {showCursor && <Text backgroundColor="cyan"> </Text>}
          {placeholder}
        </Text>
      );
    }

    const beforeCursor = value.slice(0, cursorPos);
    const atCursor = value[cursorPos] || ' ';
    const afterCursor = value.slice(cursorPos + 1);

    return (
      <Text>
        {beforeCursor}
        {showCursor ? (
          <Text backgroundColor="cyan" color="black">{atCursor}</Text>
        ) : (
          atCursor !== ' ' ? atCursor : ''
        )}
        {afterCursor}
      </Text>
    );
  };

  return (
    <Box>
      <Text color="cyan">{prompt} </Text>
      {renderWithCursor()}
    </Box>
  );
}

/**
 * Simple wrapper that manages its own state.
 */
export function SimpleTextInput({
  onSubmit,
  prompt = '>',
  placeholder,
}: {
  onSubmit: (value: string) => void;
  prompt?: string;
  placeholder?: string;
}) {
  const [value, setValue] = React.useState('');

  const handleSubmit = React.useCallback(
    (val: string) => {
      if (val.trim()) {
        onSubmit(val.trim());
        setValue('');
      }
    },
    [onSubmit]
  );

  return (
    <TextInput
      value={value}
      onChange={setValue}
      onSubmit={handleSubmit}
      prompt={prompt}
      placeholder={placeholder}
    />
  );
}
