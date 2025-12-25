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
  /** Context content to display above the question (e.g., image prompt being approved) */
  context?: string;
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
  context,
}: QuestionPromptProps) {
  const [remainingSeconds, setRemainingSeconds] = React.useState<number | null>(
    autoApproveTimeoutMs ? Math.ceil(autoApproveTimeoutMs / 1000) : null
  );

  // Track if timeout has been triggered to prevent double-firing
  const timeoutTriggeredRef = React.useRef(false);

  // Countdown timer effect
  React.useEffect(() => {
    // Reset triggered flag when timeout changes
    timeoutTriggeredRef.current = false;

    if (!autoApproveTimeoutMs || autoApproveTimeoutMs <= 0) {
      setRemainingSeconds(null);
      return;
    }

    setRemainingSeconds(Math.ceil(autoApproveTimeoutMs / 1000));

    const interval = setInterval(() => {
      setRemainingSeconds(prev => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [autoApproveTimeoutMs]);

  // Separate effect to handle timeout callback - avoids setState during render
  React.useEffect(() => {
    if (remainingSeconds === 0 && !timeoutTriggeredRef.current) {
      timeoutTriggeredRef.current = true;
      // Use setTimeout to ensure the callback runs outside the render cycle
      setTimeout(() => {
        onTimeout?.();
      }, 0);
    }
  }, [remainingSeconds, onTimeout]);

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
  // Context display component (e.g., image prompt being approved)
  const ContextDisplay = () => {
    if (!context) return null;
    return (
      <Box flexDirection="column" marginBottom={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor wrap="wrap">{context}</Text>
      </Box>
    );
  };

  // Render multiple choice options
  if (options && options.length > 0) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginY={1}>
        <ContextDisplay />
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
