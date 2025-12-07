/**
 * Question display component - shows question and options (display only).
 * Input is handled by the global UnifiedInput component.
 * Supports countdown timer for auto-approve timeout.
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
  /** Auto-approve timeout in milliseconds */
  autoApproveTimeoutMs?: number;
  /** Callback when timeout expires */
  onTimeout?: () => void;
}

/**
 * Display-only component for showing questions and options.
 * Does not handle any input - that's done by UnifiedInput.
 * Shows countdown timer if autoApproveTimeoutMs is set.
 */
export function QuestionPrompt({
  question,
  options,
  isConfirmation = false,
  selectedIndex = 0,
  autoApproveTimeoutMs,
  onTimeout,
}: QuestionPromptProps) {
  const [remainingSeconds, setRemainingSeconds] = React.useState<number | null>(
    autoApproveTimeoutMs ? Math.ceil(autoApproveTimeoutMs / 1000) : null
  );

  // Countdown timer effect
  React.useEffect(() => {
    if (!autoApproveTimeoutMs || autoApproveTimeoutMs <= 0) {
      setRemainingSeconds(null);
      return;
    }

    setRemainingSeconds(Math.ceil(autoApproveTimeoutMs / 1000));

    const interval = setInterval(() => {
      setRemainingSeconds(prev => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          onTimeout?.();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [autoApproveTimeoutMs, onTimeout]);

  // Countdown display component
  const CountdownDisplay = () => {
    if (remainingSeconds === null || remainingSeconds <= 0) return null;

    const color = remainingSeconds <= 5 ? 'red' : remainingSeconds <= 10 ? 'yellow' : 'green';

    return (
      <Box marginTop={1}>
        <Text dimColor>Auto-approve in </Text>
        <Text color={color} bold>{remainingSeconds}s</Text>
        <Text dimColor> (press any key to respond)</Text>
      </Box>
    );
  };
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
        <CountdownDisplay />
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
        <CountdownDisplay />
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
      <CountdownDisplay />
    </Box>
  );
}
