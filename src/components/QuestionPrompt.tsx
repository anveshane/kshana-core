/**
 * Question display component - shows question and options (display only).
 * Input is handled by the global UnifiedInput component.
 */
import React from 'react';
import { Text, Box } from 'ink';

export interface QuestionOption {
  label: string;
  description?: string;
}

interface QuestionPromptProps {
  question: string;
  options?: QuestionOption[];
  isConfirmation?: boolean;
  /** Currently selected index (controlled by parent) */
  selectedIndex?: number;
}

/**
 * Display-only component for showing questions and options.
 * Does not handle any input - that's done by UnifiedInput.
 */
export function QuestionPrompt({
  question,
  options,
  isConfirmation = false,
  selectedIndex = 0,
}: QuestionPromptProps) {
  // Render multiple choice options
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
      </Box>
    );
  }

  // Render confirmation (yes/no) question
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

  // Render free-form question
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginY={1}>
      <Box>
        <Text color="cyan" bold>?</Text>
        <Text bold> {question}</Text>
      </Box>
    </Box>
  );
}
