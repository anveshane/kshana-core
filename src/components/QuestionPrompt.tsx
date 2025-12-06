/**
 * Question prompt component with support for multiple choice options.
 * Displays options as selectable buttons with keyboard navigation.
 */
import React from 'react';
import { Text, Box, useInput } from 'ink';

export interface QuestionOption {
  label: string;
  description?: string;
}

interface QuestionPromptProps {
  question: string;
  options?: QuestionOption[];
  isConfirmation?: boolean;
  onSelect: (response: string) => void;
}

export function QuestionPrompt({
  question,
  options,
  isConfirmation = false,
  onSelect,
}: QuestionPromptProps) {
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [customInput, setCustomInput] = React.useState('');
  const [showCustomInput, setShowCustomInput] = React.useState(false);

  // Handle keyboard input
  useInput((input, key) => {
    if (showCustomInput) {
      // Custom input mode
      if (key.return) {
        if (customInput.trim()) {
          onSelect(customInput.trim());
        }
      } else if (key.escape) {
        setShowCustomInput(false);
        setCustomInput('');
      } else if (key.backspace || key.delete) {
        setCustomInput(prev => prev.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setCustomInput(prev => prev + input);
      }
      return;
    }

    if (options && options.length > 0) {
      // Multiple choice mode
      if (key.upArrow || input === 'k') {
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : options.length - 1));
      } else if (key.downArrow || input === 'j') {
        setSelectedIndex(prev => (prev < options.length - 1 ? prev + 1 : 0));
      } else if (key.return) {
        const selected = options[selectedIndex];
        if (selected) {
          // Check if this is the custom input option (usually the last one)
          const isCustomOption = selected.label.toLowerCase().includes('feedback') ||
            selected.label.toLowerCase().includes('custom') ||
            selected.label.toLowerCase().includes('other');

          if (isCustomOption) {
            setShowCustomInput(true);
          } else {
            onSelect(selected.label);
          }
        }
      } else if (input >= '1' && input <= '4') {
        const idx = parseInt(input, 10) - 1;
        if (idx < options.length) {
          setSelectedIndex(idx);
          const selected = options[idx];
          if (selected) {
            const isCustomOption = selected.label.toLowerCase().includes('feedback') ||
              selected.label.toLowerCase().includes('custom') ||
              selected.label.toLowerCase().includes('other');

            if (isCustomOption) {
              setShowCustomInput(true);
            } else {
              onSelect(selected.label);
            }
          }
        }
      }
    } else if (isConfirmation) {
      // Confirmation mode (yes/no)
      if (input === 'y' || input === 'Y') {
        onSelect('yes');
      } else if (input === 'n' || input === 'N') {
        onSelect('no');
      }
    }
  });

  // Render custom input mode
  if (showCustomInput) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginY={1}>
        <Box marginBottom={1}>
          <Text color="cyan" bold>Your feedback:</Text>
        </Box>
        <Box>
          <Text color="green">&gt; </Text>
          <Text>{customInput}</Text>
          <Text color="cyan">|</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Press Enter to submit, Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  // Render multiple choice
  if (options && options.length > 0) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginY={1}>
        <Box marginBottom={1}>
          <Text color="cyan" bold>?</Text>
          <Text bold> {question}</Text>
        </Box>

        <Box flexDirection="column" marginLeft={2}>
          {options.map((option, index) => {
            const isSelected = index === selectedIndex;
            return (
              <Box key={option.label} flexDirection="column">
                <Box>
                  <Text color={isSelected ? 'cyan' : 'white'}>
                    {isSelected ? '>' : ' '} {index + 1}. {option.label}
                  </Text>
                </Box>
                {option.description && (
                  <Box marginLeft={4}>
                    <Text dimColor wrap="wrap">{option.description}</Text>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>

        <Box marginTop={1}>
          <Text dimColor>Use ↑↓ or 1-4 to select, Enter to confirm</Text>
        </Box>
      </Box>
    );
  }

  // Render confirmation (yes/no)
  if (isConfirmation) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginY={1}>
        <Box marginBottom={1}>
          <Text color="yellow" bold>?</Text>
          <Text bold> {question}</Text>
        </Box>
        <Box>
          <Text dimColor>Press </Text>
          <Text color="green" bold>y</Text>
          <Text dimColor> for Yes, </Text>
          <Text color="red" bold>n</Text>
          <Text dimColor> for No</Text>
        </Box>
      </Box>
    );
  }

  // Fallback - shouldn't normally render this way
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginY={1}>
      <Box>
        <Text color="cyan" bold>?</Text>
        <Text> {question}</Text>
      </Box>
    </Box>
  );
}
