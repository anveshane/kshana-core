/**
 * Streaming text component for real-time LLM output.
 */
import React from 'react';
import { Text, Box } from 'ink';

interface StreamingTextProps {
  text: string;
  isStreaming?: boolean;
  color?: string;
}

export function StreamingText({ text, isStreaming = false, color }: StreamingTextProps) {
  if (!text) {
    return null;
  }

  return (
    <Box flexDirection="column">
      <Text color={color}>
        {text}
        {isStreaming && <Text color="cyan">▌</Text>}
      </Text>
    </Box>
  );
}

/**
 * Hook to manage streaming text state.
 */
export function useStreamingText() {
  const [text, setText] = React.useState('');
  const [isStreaming, setIsStreaming] = React.useState(false);

  const append = React.useCallback((chunk: string) => {
    setText(prev => prev + chunk);
  }, []);

  const start = React.useCallback(() => {
    setIsStreaming(true);
    setText('');
  }, []);

  const finish = React.useCallback(() => {
    setIsStreaming(false);
  }, []);

  const reset = React.useCallback(() => {
    setText('');
    setIsStreaming(false);
  }, []);

  return {
    text,
    isStreaming,
    append,
    start,
    finish,
    reset,
  };
}
