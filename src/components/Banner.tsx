/**
 * ASCII art banner component for Kshana CLI.
 */
import React from 'react';
import { Text, Box } from 'ink';

interface BannerProps {
  subtitle?: string;
  version?: string;
}

const KSHANA_ASCII = `
██╗  ██╗███████╗██╗  ██╗ █████╗ ███╗   ██╗ █████╗
██║ ██╔╝██╔════╝██║  ██║██╔══██╗████╗  ██║██╔══██╗
█████╔╝ ███████╗███████║███████║██╔██╗ ██║███████║
██╔═██╗ ╚════██║██╔══██║██╔══██║██║╚██╗██║██╔══██║
██║  ██╗███████║██║  ██║██║  ██║██║ ╚████║██║  ██║
╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝
`;

export function Banner({ subtitle, version = '0.1.0' }: BannerProps) {
  return (
    <Box flexDirection="column" alignItems="center" marginBottom={1}>
      <Box borderStyle="double" borderColor="magenta" paddingX={2}>
        <Text color="magenta" bold>
          {KSHANA_ASCII}
        </Text>
      </Box>
      {subtitle && (
        <Box marginTop={1}>
          <Text bold color="cyan">{subtitle}</Text>
        </Box>
      )}
      <Box>
        <Text dimColor>v{version}</Text>
      </Box>
    </Box>
  );
}

export { KSHANA_ASCII };
