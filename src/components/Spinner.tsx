/**
 * Spinner component for loading states.
 */
import React from 'react';
import { Text, Box } from 'ink';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface SpinnerProps {
  label?: string;
  color?: string;
}

export function Spinner({ label, color = 'cyan' }: SpinnerProps) {
  const [frameIndex, setFrameIndex] = React.useState(0);

  React.useEffect(() => {
    const timer = setInterval(() => {
      setFrameIndex(prev => (prev + 1) % SPINNER_FRAMES.length);
    }, 80);

    return () => {
      clearInterval(timer);
    };
  }, []);

  const frame = SPINNER_FRAMES[frameIndex] ?? SPINNER_FRAMES[0];

  return (
    <Box>
      <Text color={color}>{frame}</Text>
      {label && <Text> {label}</Text>}
    </Box>
  );
}
