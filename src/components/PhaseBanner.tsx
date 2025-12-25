/**
 * Phase transition banner component.
 * Displays a full-width banner when transitioning between workflow phases.
 */
import React from 'react';
import { Text, Box } from 'ink';

interface PhaseBannerProps {
  /** The phase being entered */
  phaseName: string;
  /** Optional description of the phase */
  description?: string;
  /** Optional display name (human-readable) */
  displayName?: string;
}

/** Phase-specific colors and icons */
const PHASE_STYLES: Record<string, { color: string; icon: string }> = {
  plot: { color: 'magenta', icon: '📝' },
  story: { color: 'blue', icon: '📖' },
  characters_settings: { color: 'cyan', icon: '👤' },
  scenes: { color: 'green', icon: '🎬' },
  character_setting_images: { color: 'yellow', icon: '🖼️' },
  scene_images: { color: 'yellow', icon: '🎨' },
  video: { color: 'red', icon: '🎥' },
  video_combine: { color: 'magenta', icon: '🎞️' },
  completed: { color: 'green', icon: '✅' },
};

const DEFAULT_STYLE = { color: 'white', icon: '▶' };
const BANNER_WIDTH = 60;

export const PhaseBanner = React.memo(function PhaseBanner({
  phaseName,
  description,
  displayName,
}: PhaseBannerProps) {
  const style = PHASE_STYLES[phaseName] || DEFAULT_STYLE;
  const title = displayName || phaseName.replace(/_/g, ' ').toUpperCase();

  // Create decorative line
  const lineChar = '═';
  const titleWithIcon = `${style.icon} ${title} ${style.icon}`;
  const sideLength = Math.max(2, Math.floor((BANNER_WIDTH - titleWithIcon.length - 2) / 2));
  const topLine = lineChar.repeat(BANNER_WIDTH);
  const sidePadding = lineChar.repeat(sideLength);

  return (
    <Box flexDirection="column" marginY={1}>
      <Text color={style.color}>{topLine}</Text>
      <Text color={style.color}>
        {sidePadding} {titleWithIcon} {sidePadding}
      </Text>
      {description && (
        <Box justifyContent="center">
          <Text color={style.color} dimColor>
            {description}
          </Text>
        </Box>
      )}
      <Text color={style.color}>{topLine}</Text>
    </Box>
  );
});
