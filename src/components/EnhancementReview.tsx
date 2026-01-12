/**
 * EnhancementReview - CLI component for reviewing video enhancement suggestions.
 * Used in the enhancement planning phase of the video editing workflow.
 */
import React, { useState, useCallback } from 'react';
import { Text, Box, useInput } from 'ink';

/**
 * Enhancement type icons for display.
 */
const TYPE_ICONS: Record<string, string> = {
  ai_image: '🖼️',
  ai_video_clip: '🎬',
  motion_graphic: '✨',
  audio_music: '🎵',
  audio_sfx: '🔊',
};

/**
 * Composition mode display names.
 */
const COMPOSITION_NAMES: Record<string, string> = {
  pip_overlay: 'Picture-in-Picture',
  broll_cut: 'B-Roll Cut',
  split_screen: 'Split Screen',
  lower_third: 'Lower Third',
  full_overlay: 'Full Overlay',
};

/**
 * Enhancement data structure for display.
 */
export interface EnhancementForReview {
  id: string;
  type: string;
  compositionMode: string;
  timeRange: {
    start: string;
    end: string;
    durationSec?: number;
  };
  description: string;
  prompt?: string;
  source: string;
  confidence: number;
  segmentText?: string;
}

/**
 * Props for EnhancementReview component.
 */
interface EnhancementReviewProps {
  /** Current enhancement to review */
  enhancement: EnhancementForReview;
  /** Current index (1-based for display) */
  currentIndex: number;
  /** Total number of enhancements */
  totalCount: number;
  /** Number already approved */
  approvedCount: number;
  /** Number rejected */
  rejectedCount: number;
  /** Callback when user approves */
  onApprove: (id: string, modifiedPrompt?: string) => void;
  /** Callback when user rejects */
  onReject: (id: string, feedback: string) => void;
  /** Callback when user wants to modify */
  onModify: (id: string) => void;
  /** Callback when user skips */
  onSkip: (id: string) => void;
  /** Whether input is enabled */
  isActive?: boolean;
}

/**
 * EnhancementReview component for interactive enhancement approval.
 */
export function EnhancementReview({
  enhancement,
  currentIndex,
  totalCount,
  approvedCount,
  rejectedCount,
  onApprove,
  onReject,
  onModify,
  onSkip,
  isActive = true,
}: EnhancementReviewProps) {
  const [showFeedbackInput, setShowFeedbackInput] = useState(false);
  const [feedbackBuffer, setFeedbackBuffer] = useState('');

  // Handle keyboard input
  useInput(
    (input, key) => {
      if (!isActive) return;

      if (showFeedbackInput) {
        // Handle feedback input mode
        if (key.return) {
          if (feedbackBuffer.trim()) {
            onReject(enhancement.id, feedbackBuffer.trim());
            setFeedbackBuffer('');
            setShowFeedbackInput(false);
          }
        } else if (key.escape) {
          setFeedbackBuffer('');
          setShowFeedbackInput(false);
        } else if (key.backspace || key.delete) {
          setFeedbackBuffer(prev => prev.slice(0, -1));
        } else if (input && !key.ctrl && !key.meta) {
          setFeedbackBuffer(prev => prev + input);
        }
        return;
      }

      // Normal mode
      const lowerInput = input.toLowerCase();
      if (lowerInput === 'a' || lowerInput === 'y') {
        onApprove(enhancement.id);
      } else if (lowerInput === 'r' || lowerInput === 'n') {
        setShowFeedbackInput(true);
      } else if (lowerInput === 'm' || lowerInput === 'e') {
        onModify(enhancement.id);
      } else if (lowerInput === 's' || key.tab) {
        onSkip(enhancement.id);
      }
    },
    { isActive }
  );

  const typeIcon = TYPE_ICONS[enhancement.type] || '📌';
  const typeName = enhancement.type.replace(/_/g, ' ');
  const compositionName = COMPOSITION_NAMES[enhancement.compositionMode] || enhancement.compositionMode;
  const confidencePercent = Math.round(enhancement.confidence * 100);
  const confidenceColor = confidencePercent >= 80 ? 'green' : confidencePercent >= 50 ? 'yellow' : 'red';

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1} marginY={1}>
      {/* Header */}
      <Box justifyContent="space-between" marginBottom={1}>
        <Text color="cyan" bold>
          Enhancement Review #{currentIndex} of {totalCount}
        </Text>
        <Text dimColor>
          ✅ {approvedCount} | ❌ {rejectedCount} | ⏳ {totalCount - approvedCount - rejectedCount}
        </Text>
      </Box>

      {/* Divider */}
      <Box marginBottom={1}>
        <Text dimColor>{'─'.repeat(60)}</Text>
      </Box>

      {/* Time Range */}
      <Box marginBottom={1}>
        <Text color="yellow">⏱️  Time: </Text>
        <Text bold>
          {enhancement.timeRange.start} → {enhancement.timeRange.end}
        </Text>
        {enhancement.timeRange.durationSec && (
          <Text dimColor> ({enhancement.timeRange.durationSec}s)</Text>
        )}
      </Box>

      {/* Type and Composition */}
      <Box marginBottom={1}>
        <Box marginRight={3}>
          <Text color="magenta">🎬  Type: </Text>
          <Text>
            {typeIcon} {typeName}
          </Text>
        </Box>
        <Box>
          <Text color="blue">📐  Composition: </Text>
          <Text>{compositionName}</Text>
        </Box>
      </Box>

      {/* Confidence */}
      <Box marginBottom={1}>
        <Text color="gray">📊  Confidence: </Text>
        <Text color={confidenceColor} bold>
          {confidencePercent}%
        </Text>
        <Text dimColor> ({enhancement.source === 'user_hint' ? 'User Hint' : 'AI Suggested'})</Text>
      </Box>

      {/* Divider */}
      <Box marginY={1}>
        <Text dimColor>{'─'.repeat(60)}</Text>
      </Box>

      {/* Description */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color="white" bold>
          📝 Description:
        </Text>
        <Box marginLeft={3} marginTop={1}>
          <Text wrap="wrap">{enhancement.description}</Text>
        </Box>
      </Box>

      {/* Prompt */}
      {enhancement.prompt && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="green" bold>
            💡 Suggested Prompt:
          </Text>
          <Box marginLeft={3} marginTop={1}>
            <Text wrap="wrap" italic>
              "{enhancement.prompt}"
            </Text>
          </Box>
        </Box>
      )}

      {/* Script Context */}
      {enhancement.segmentText && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="gray" bold>
            📖 Script Context:
          </Text>
          <Box marginLeft={3} marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
            <Text wrap="wrap" dimColor>
              "{enhancement.segmentText.substring(0, 200)}
              {enhancement.segmentText.length > 200 ? '...' : ''}"
            </Text>
          </Box>
        </Box>
      )}

      {/* Divider */}
      <Box marginY={1}>
        <Text dimColor>{'─'.repeat(60)}</Text>
      </Box>

      {/* Actions */}
      {showFeedbackInput ? (
        <Box flexDirection="column">
          <Text color="yellow">Enter rejection reason (Enter to confirm, Esc to cancel):</Text>
          <Box marginTop={1}>
            <Text color="gray">&gt; </Text>
            <Text>{feedbackBuffer}</Text>
            <Text color="cyan">▋</Text>
          </Box>
        </Box>
      ) : (
        <Box justifyContent="center">
          <Box marginX={1}>
            <Text backgroundColor="green" color="white" bold>
              {' '}
              [A]pprove{' '}
            </Text>
          </Box>
          <Box marginX={1}>
            <Text backgroundColor="red" color="white" bold>
              {' '}
              [R]eject{' '}
            </Text>
          </Box>
          <Box marginX={1}>
            <Text backgroundColor="yellow" color="black" bold>
              {' '}
              [M]odify{' '}
            </Text>
          </Box>
          <Box marginX={1}>
            <Text backgroundColor="gray" color="white" bold>
              {' '}
              [S]kip{' '}
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

/**
 * Props for EnhancementSummary component.
 */
interface EnhancementSummaryProps {
  approvedCount: number;
  rejectedCount: number;
  skippedCount: number;
  totalCount: number;
  onProceed: () => void;
  onReviewMore: () => void;
  isActive?: boolean;
}

/**
 * EnhancementSummary component shown after all enhancements are reviewed.
 */
export function EnhancementSummary({
  approvedCount,
  rejectedCount,
  skippedCount,
  totalCount,
  onProceed,
  onReviewMore,
  isActive = true,
}: EnhancementSummaryProps) {
  const [selected, setSelected] = useState<'proceed' | 'review'>('proceed');

  useInput(
    (input, key) => {
      if (!isActive) return;

      if (key.leftArrow || key.rightArrow || input === 'h' || input === 'l') {
        setSelected(prev => (prev === 'proceed' ? 'review' : 'proceed'));
      } else if (key.return) {
        if (selected === 'proceed') {
          onProceed();
        } else {
          onReviewMore();
        }
      } else if (input === 'p' || input === 'P') {
        onProceed();
      } else if (input === 'r' || input === 'R') {
        onReviewMore();
      }
    },
    { isActive }
  );

  return (
    <Box flexDirection="column" borderStyle="double" borderColor="green" padding={1} marginY={1}>
      <Box marginBottom={1}>
        <Text color="green" bold>
          🎉 Enhancement Review Complete!
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1} marginLeft={2}>
        <Text>
          <Text color="green">✅ Approved:</Text> {approvedCount}
        </Text>
        <Text>
          <Text color="red">❌ Rejected:</Text> {rejectedCount}
        </Text>
        {skippedCount > 0 && (
          <Text>
            <Text color="yellow">⏭️ Skipped:</Text> {skippedCount}
          </Text>
        )}
        <Text dimColor>────────</Text>
        <Text bold>
          Total: {totalCount}
        </Text>
      </Box>

      {approvedCount === 0 && (
        <Box marginBottom={1}>
          <Text color="yellow">
            ⚠️ No enhancements approved. You need at least one to proceed.
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Box marginX={1}>
          <Text
            backgroundColor={selected === 'proceed' ? 'green' : undefined}
            color={selected === 'proceed' ? 'white' : 'green'}
            bold={selected === 'proceed'}
          >
            {' '}
            [P]roceed to Asset Generation{' '}
          </Text>
        </Box>
        {skippedCount > 0 && (
          <Box marginX={1}>
            <Text
              backgroundColor={selected === 'review' ? 'yellow' : undefined}
              color={selected === 'review' ? 'black' : 'yellow'}
              bold={selected === 'review'}
            >
              {' '}
              [R]eview Skipped{' '}
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

/**
 * Props for EnhancementList component.
 */
interface EnhancementListProps {
  enhancements: Array<{
    id: string;
    type: string;
    timeRange: { start: string; end: string };
    description: string;
    status: string;
  }>;
  title?: string;
}

/**
 * EnhancementList component for displaying a summary list of enhancements.
 */
export function EnhancementList({ enhancements, title = 'Enhancements' }: EnhancementListProps) {
  const statusColors: Record<string, string> = {
    approved: 'green',
    rejected: 'red',
    pending: 'yellow',
    regenerating: 'cyan',
  };

  const statusIcons: Record<string, string> = {
    approved: '✅',
    rejected: '❌',
    pending: '⏳',
    regenerating: '🔄',
  };

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" padding={1}>
      <Box marginBottom={1}>
        <Text bold>{title}</Text>
        <Text dimColor> ({enhancements.length} items)</Text>
      </Box>

      {enhancements.map((enh, index) => (
        <Box key={enh.id} marginLeft={1}>
          <Text dimColor>{String(index + 1).padStart(2, ' ')}. </Text>
          <Text color={statusColors[enh.status] || 'white'}>
            {statusIcons[enh.status] || '•'}
          </Text>
          <Text> </Text>
          <Text color="cyan">{enh.timeRange.start}</Text>
          <Text dimColor> - </Text>
          <Text>{TYPE_ICONS[enh.type] || '📌'} </Text>
          <Text wrap="truncate">
            {enh.description.substring(0, 40)}
            {enh.description.length > 40 ? '...' : ''}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

export default EnhancementReview;
