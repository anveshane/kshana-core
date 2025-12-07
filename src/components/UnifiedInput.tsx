/**
 * Unified input component that handles both text input and option selection.
 * This is the single source of user input for the entire application.
 */
import React from 'react';
import { Text, Box, useInput } from 'ink';
import type { QuestionOption } from './QuestionPrompt.js';

export type InputMode = 'text' | 'selection' | 'confirmation';

interface UnifiedInputProps {
  /** Current input mode */
  mode: InputMode;
  /** Called when user submits input (text or selected option) */
  onSubmit: (value: string) => void;
  /** Options for selection mode */
  options?: QuestionOption[];
  /** Prompt/prefix shown before input */
  prompt?: string;
  /** Placeholder when empty */
  placeholder?: string;
  /** Hint text shown below input */
  hint?: string;
  /** Callback when selection index changes (for parent to update QuestionPrompt) */
  onSelectionChange?: (index: number) => void;
}

export function UnifiedInput({
  mode,
  onSubmit,
  options = [],
  prompt = '>',
  placeholder = '',
  hint,
  onSelectionChange,
}: UnifiedInputProps) {
  const [textValue, setTextValue] = React.useState('');
  const [cursorPos, setCursorPos] = React.useState(0);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [lastEscapeTime, setLastEscapeTime] = React.useState(0);

  // Reset selection when options change
  React.useEffect(() => {
    setSelectedIndex(0);
    onSelectionChange?.(0);
  }, [options, onSelectionChange]);

  // Keep cursor in bounds
  React.useEffect(() => {
    if (cursorPos > textValue.length) {
      setCursorPos(textValue.length);
    }
  }, [textValue, cursorPos]);

  // Notify parent of selection changes
  const updateSelection = React.useCallback((newIndex: number) => {
    setSelectedIndex(newIndex);
    onSelectionChange?.(newIndex);
  }, [onSelectionChange]);

  useInput((input, key) => {
    // Handle confirmation mode (y/n)
    if (mode === 'confirmation') {
      if (input === 'y' || input === 'Y') {
        onSubmit('yes');
        return;
      }
      if (input === 'n' || input === 'N') {
        onSubmit('no');
        return;
      }
      return;
    }

    // Handle selection mode
    if (mode === 'selection' && options.length > 0) {
      // Arrow keys for navigation
      if (key.upArrow) {
        const newIndex = selectedIndex > 0 ? selectedIndex - 1 : options.length - 1;
        updateSelection(newIndex);
        return;
      }
      if (key.downArrow) {
        const newIndex = selectedIndex < options.length - 1 ? selectedIndex + 1 : 0;
        updateSelection(newIndex);
        return;
      }

      // Number keys for quick selection
      if (input >= '1' && input <= '9') {
        const idx = parseInt(input, 10) - 1;
        if (idx < options.length) {
          updateSelection(idx);
          // Submit immediately on number press
          const selected = options[idx];
          if (selected) {
            onSubmit(selected.label);
            setTextValue('');
            setCursorPos(0);
          }
        }
        return;
      }

      // Enter to confirm selection
      if (key.return) {
        // If there's text, submit the text (allows custom input)
        if (textValue.trim()) {
          onSubmit(textValue.trim());
          setTextValue('');
          setCursorPos(0);
          return;
        }
        // Otherwise submit the selected option
        const selected = options[selectedIndex];
        if (selected) {
          onSubmit(selected.label);
        }
        return;
      }
    }

    // Text input handling (works in both text and selection mode for custom input)

    // Double Escape to clear
    if (key.escape) {
      const now = Date.now();
      if (now - lastEscapeTime < 500) {
        setTextValue('');
        setCursorPos(0);
        setLastEscapeTime(0);
      } else {
        setLastEscapeTime(now);
      }
      return;
    }

    // Enter in text mode
    if (key.return && mode === 'text') {
      if (textValue.trim()) {
        onSubmit(textValue.trim());
        setTextValue('');
        setCursorPos(0);
      }
      return;
    }

    // Cursor movement
    if (key.leftArrow) {
      setCursorPos(prev => Math.max(0, prev - 1));
      return;
    }
    if (key.rightArrow) {
      setCursorPos(prev => Math.min(textValue.length, prev + 1));
      return;
    }

    // Home (Ctrl+A)
    if (key.ctrl && input === 'a') {
      setCursorPos(0);
      return;
    }
    // End (Ctrl+E)
    if (key.ctrl && input === 'e') {
      setCursorPos(textValue.length);
      return;
    }

    // Backspace
    if (key.backspace || key.delete) {
      if (cursorPos > 0) {
        const newValue = textValue.slice(0, cursorPos - 1) + textValue.slice(cursorPos);
        setTextValue(newValue);
        setCursorPos(prev => prev - 1);
      }
      return;
    }

    // Forward delete (Ctrl+D)
    if (key.ctrl && input === 'd') {
      if (cursorPos < textValue.length) {
        const newValue = textValue.slice(0, cursorPos) + textValue.slice(cursorPos + 1);
        setTextValue(newValue);
      }
      return;
    }

    // Regular character input
    if (input && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow) {
      // Replace newlines and all control characters with spaces, collapse multiple spaces
      const sanitized = input
        .replace(/[\r\n\t\x00-\x1F\x7F]/g, ' ')
        .replace(/\s+/g, ' ');
      if (sanitized) {
        const newValue = textValue.slice(0, cursorPos) + sanitized + textValue.slice(cursorPos);
        setTextValue(newValue);
        setCursorPos(prev => prev + sanitized.length);
      }
    }
  });

  // Render text with cursor
  const renderTextWithCursor = () => {
    if (!textValue && placeholder) {
      return (
        <Text dimColor>
          <Text backgroundColor="cyan"> </Text>
          {placeholder}
        </Text>
      );
    }

    const beforeCursor = textValue.slice(0, cursorPos);
    const atCursor = textValue[cursorPos] || ' ';
    const afterCursor = textValue.slice(cursorPos + 1);

    return (
      <Text>
        {beforeCursor}
        <Text backgroundColor="cyan" color="black">{atCursor}</Text>
        {afterCursor}
      </Text>
    );
  };

  // Get appropriate hint text
  const getHintText = () => {
    if (hint) return hint;

    switch (mode) {
      case 'selection':
        return 'Use ↑↓ to navigate, 1-9 to quick select, Enter to confirm, or type custom response';
      case 'confirmation':
        return 'Press y for Yes, n for No';
      default:
        return 'Type your response and press Enter';
    }
  };

  return (
    <Box flexDirection="column">
      <Text dimColor>{getHintText()}</Text>
      <Box>
        <Text color="cyan">{prompt} </Text>
        {renderTextWithCursor()}
      </Box>
    </Box>
  );
}
