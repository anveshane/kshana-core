/**
 * Unified input component that handles both text input and option selection.
 * This is the single source of user input for the entire application.
 * Uses useStdin for raw input to properly handle paste events.
 */
import React from 'react';
import { Text, Box, useStdin } from 'ink';
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
  /** Called when any key is pressed (before processing) - used to stop countdown timer */
  onAnyKeyPress?: () => void;
}

export function UnifiedInput({
  mode,
  onSubmit,
  options = [],
  prompt = '>',
  placeholder = '',
  hint,
  onSelectionChange,
  onAnyKeyPress,
}: UnifiedInputProps) {
  const [textValue, setTextValue] = React.useState('');
  const [cursorPos, setCursorPos] = React.useState(0);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [lastEscapeTime, setLastEscapeTime] = React.useState(0);
  const { stdin, setRawMode } = useStdin();

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

  // Set raw mode on mount
  React.useEffect(() => {
    setRawMode(true);
    return () => setRawMode(false);
  }, [setRawMode]);

  // Handle raw stdin data - receives full paste as single chunk
  React.useEffect(() => {
    if (!stdin) return;

    const handleData = (data: Buffer) => {
      const input = data.toString();

      // Notify parent that user pressed a key (for stopping countdown timer)
      onAnyKeyPress?.();

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

      // Up arrow
      if (input === '\x1b[A') {
        if (mode === 'selection' && options.length > 0) {
          const newIndex = selectedIndex > 0 ? selectedIndex - 1 : options.length - 1;
          updateSelection(newIndex);
        }
        return;
      }

      // Down arrow
      if (input === '\x1b[B') {
        if (mode === 'selection' && options.length > 0) {
          const newIndex = selectedIndex < options.length - 1 ? selectedIndex + 1 : 0;
          updateSelection(newIndex);
        }
        return;
      }

      // Left arrow
      if (input === '\x1b[D') {
        setCursorPos(prev => Math.max(0, prev - 1));
        return;
      }

      // Right arrow
      if (input === '\x1b[C') {
        setCursorPos(prev => Math.min(textValue.length, prev + 1));
        return;
      }

      // Escape key - double escape to clear
      if (input === '\x1b' || input === '\u001b') {
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

      // Enter/Return
      if (input === '\r' || input === '\n') {
        if (mode === 'selection' && options.length > 0) {
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
        // Text mode - submit if there's text
        if (textValue.trim()) {
          onSubmit(textValue.trim());
          setTextValue('');
          setCursorPos(0);
        }
        return;
      }

      // Ctrl+A - go to start
      if (input === '\x01') {
        setCursorPos(0);
        return;
      }

      // Ctrl+E - go to end
      if (input === '\x05') {
        setCursorPos(textValue.length);
        return;
      }

      // Backspace (0x7f or 0x08)
      if (input === '\x7f' || input === '\x08') {
        if (cursorPos > 0) {
          const newValue = textValue.slice(0, cursorPos - 1) + textValue.slice(cursorPos);
          setTextValue(newValue);
          setCursorPos(prev => prev - 1);
        }
        return;
      }

      // Ctrl+D - forward delete
      if (input === '\x04') {
        if (cursorPos < textValue.length) {
          const newValue = textValue.slice(0, cursorPos) + textValue.slice(cursorPos + 1);
          setTextValue(newValue);
        }
        return;
      }

      // Ctrl+C - exit (let Ink handle this)
      if (input === '\x03') {
        return;
      }

      // Skip other escape sequences
      if (input.startsWith('\x1b')) {
        return;
      }

      // Number keys for quick selection in selection mode
      if (mode === 'selection' && options.length > 0 && input >= '1' && input <= '9' && input.length === 1) {
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

      // Regular text input (including paste) - sanitize for single line
      let sanitized = input
        .replace(/[\r\n\t\x00-\x1F\x7F]/g, ' ')  // Replace control chars with space
        .replace(/\s+/g, ' ');  // Collapse multiple spaces

      // Only trim if it's a multi-character paste (preserve single space keystrokes)
      if (sanitized.length > 1) {
        sanitized = sanitized.trim();
      }

      if (sanitized) {
        const newValue = textValue.slice(0, cursorPos) + sanitized + textValue.slice(cursorPos);
        setTextValue(newValue);
        setCursorPos(prev => prev + sanitized.length);
      }
    };

    stdin.on('data', handleData);
    return () => {
      stdin.off('data', handleData);
    };
  }, [stdin, mode, options, selectedIndex, textValue, cursorPos, onSubmit, updateSelection, lastEscapeTime, onAnyKeyPress]);

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
