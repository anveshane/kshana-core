/**
 * Tool call display component - Claude Code style.
 */
import React from 'react';
import { Text, Box } from 'ink';
import { Spinner } from './Spinner.js';

interface ToolCallDisplayProps {
  toolName: string;
  args?: Record<string, unknown>;
  status?: 'executing' | 'completed' | 'error' | 'needs_confirmation';
  result?: unknown;
  duration?: number;
  compact?: boolean;
}

// Tools that should be hidden (rendered elsewhere in UI)
export const HIDDEN_TOOLS = new Set(['todo_write']);

// Tools with special rendering (not standard tool call format)
const SPECIAL_RENDER_TOOLS = new Set(['think', 'write_project_state', 'read_project_state', 'dispatch_agent']);

// User-friendly display names with gerund (ongoing) and past tense (completed)
const TOOL_DISPLAY_NAMES: Record<string, { gerund: string; past: string }> = {
  think: { gerund: 'Thinking', past: 'Thought' },
  ask_user: { gerund: 'Asking user', past: 'Asked user' },
  dispatch_agent: { gerund: 'Dispatching agent', past: 'Dispatched agent' },
  generate_image: { gerund: 'Generating image', past: 'Generated image' },
  generate_video: { gerund: 'Generating video', past: 'Generated video' },
  edit_image: { gerund: 'Editing image', past: 'Edited image' },
  wait_for_job: { gerund: 'Waiting for job', past: 'Job completed' },
  read_project_state: { gerund: 'Reading project state', past: 'Read project state' },
  write_project_state: { gerund: 'Saving project state', past: 'Saved project state' },
};

function getDisplayName(toolName: string, isExecuting: boolean): string {
  const names = TOOL_DISPLAY_NAMES[toolName];
  if (!names) {
    // Generate default gerund/past for unknown tools
    return isExecuting ? `Running ${toolName}` : `Ran ${toolName}`;
  }
  return isExecuting ? names.gerund : names.past;
}

// Format duration in human-readable form
function formatDuration(ms: number): string {
  if (ms < 1000) return `${String(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${String(Math.floor(ms / 60000))}m ${String(Math.floor((ms % 60000) / 1000))}s`;
}

// Format tool call in Claude Code style: toolName(arg1="val", arg2=...)
function formatToolCall(name: string, args?: Record<string, unknown>): string {
  if (!args || Object.keys(args).length === 0) {
    return `${name}()`;
  }

  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') {
      // Truncate long strings for display
      const displayVal = value.length > 50 ? value.slice(0, 50) + '...' : value;
      parts.push(`${key}="${displayVal}"`);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      parts.push(`${key}=${String(value)}`);
    } else if (Array.isArray(value)) {
      parts.push(`${key}=[...]`);
    } else if (value !== null && typeof value === 'object') {
      parts.push(`${key}={...}`);
    }
  }

  return `${name}(${parts.join(', ')})`;
}

function getStatusIcon(status: ToolCallDisplayProps['status']): { icon: string; color: string } {
  switch (status) {
    case 'executing':
      return { icon: '◉', color: 'yellow' };
    case 'completed':
      return { icon: '✓', color: 'green' };
    case 'error':
      return { icon: '✗', color: 'red' };
    case 'needs_confirmation':
      return { icon: '?', color: 'cyan' };
    default:
      return { icon: '○', color: 'gray' };
  }
}

// Capitalize first letter of a string
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Format an object's key-value pairs as readable text
function formatObjectAsText(obj: Record<string, unknown>): string {
  const parts: string[] = [];

  // Try to find a primary identifier (name, title, etc.)
  const nameField = obj['name'] || obj['title'];
  const roleField = obj['role'];

  if (nameField) {
    let line = String(nameField);
    if (roleField) {
      line += ` (${roleField})`;
    }
    parts.push(line);
  }

  // Add other meaningful fields
  for (const [key, value] of Object.entries(obj)) {
    // Skip fields we've already used or are not useful for display
    if (['name', 'title', 'role'].includes(key)) continue;

    if (typeof value === 'string') {
      parts.push(`${capitalize(key)}: ${value}`);
    } else if (typeof value === 'number') {
      parts.push(`${capitalize(key)}: ${value}`);
    }
    // Skip nested objects/arrays in the summary
  }

  return parts.join(' | ');
}

// Format project state data as readable key-value pairs
function formatProjectStateData(data: Record<string, unknown>, indent = 0): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const prefix = '  '.repeat(indent);

  for (const [key, value] of Object.entries(data)) {
    const capitalizedKey = capitalize(key);

    if (Array.isArray(value)) {
      // Handle arrays (like characters, settings, scenes)
      nodes.push(
        <Box key={key}>
          <Text dimColor>{prefix}</Text>
          <Text color="yellow" bold>{capitalizedKey}:</Text>
        </Box>
      );
      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        if (typeof item === 'object' && item !== null) {
          const obj = item as Record<string, unknown>;
          // Format object as readable text
          const formattedText = formatObjectAsText(obj);
          nodes.push(
            <Text key={`${key}-${i}`} dimColor>
              {prefix}  - {formattedText}
            </Text>
          );
        } else {
          nodes.push(
            <Text key={`${key}-${i}`} dimColor>
              {prefix}  - {String(item)}
            </Text>
          );
        }
      }
    } else if (typeof value === 'object' && value !== null) {
      // Nested object
      nodes.push(
        <Box key={key}>
          <Text dimColor>{prefix}</Text>
          <Text color="yellow" bold>{capitalizedKey}:</Text>
        </Box>
      );
      nodes.push(...formatProjectStateData(value as Record<string, unknown>, indent + 1));
    } else {
      // Simple value - no truncation
      nodes.push(
        <Box key={key}>
          <Text dimColor>{prefix}</Text>
          <Text color="yellow" bold>{capitalizedKey}: </Text>
          <Text dimColor>{String(value)}</Text>
        </Box>
      );
    }
  }

  return nodes;
}

// Render think tool specially
function renderThinkTool(
  args: Record<string, unknown> | undefined,
  status: ToolCallDisplayProps['status'],
  duration?: number
): React.ReactNode {
  const thought = args?.['thought'] as string | undefined;
  const isExecuting = status === 'executing';

  return (
    <Box flexDirection="column">
      <Box>
        {isExecuting ? (
          <>
            <Text>💭 </Text>
            <Spinner />
          </>
        ) : (
          <>
            <Text>💭 </Text>
            <Text italic color="white">{thought || 'Thinking...'}</Text>
          </>
        )}
      </Box>
    </Box>
  );
}

// Render dispatch_agent (planning) tool specially
function renderDispatchAgentTool(
  args: Record<string, unknown> | undefined,
  status: ToolCallDisplayProps['status'],
  result?: unknown
): React.ReactNode {
  const task = args?.['task'] as string | undefined;
  const context = args?.['context'] as string | undefined;
  const isExecuting = status === 'executing';

  // Extract plan from result
  const resultObj = result as Record<string, unknown> | undefined;
  const plan = resultObj?.['plan'] as string | undefined;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="blue"
      paddingX={1}
      marginY={1}
    >
      <Box>
        {isExecuting ? (
          <>
            <Text color="blue">📝 </Text>
            <Spinner color="blue" />
            <Text color="blue"> Planning...</Text>
          </>
        ) : (
          <Text color="blue" bold>📝 Plan Complete</Text>
        )}
      </Box>
      <Box flexDirection="column" marginLeft={2} marginTop={1}>
        <Box>
          <Text bold color="yellow">Task: </Text>
          <Text>{task || 'No task specified'}</Text>
        </Box>
        {context && (
          <Box marginTop={1}>
            <Text bold color="yellow">Context: </Text>
            <Text dimColor>{context}</Text>
          </Box>
        )}
        {plan && !isExecuting && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold color="green">Plan:</Text>
            <Box marginTop={1} marginLeft={1}>
              <Text wrap="wrap">{plan}</Text>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}

// Render project state tool specially
function renderProjectStateTool(
  toolName: string,
  args: Record<string, unknown> | undefined,
  status: ToolCallDisplayProps['status'],
  duration?: number
): React.ReactNode {
  const dataType = args?.['data_type'] as string | undefined;
  const rawData = args?.['data'];
  const isExecuting = status === 'executing';
  const isRead = toolName === 'read_project_state';

  // Parse data if it's a JSON string, otherwise use as-is
  let data: Record<string, unknown> | undefined;
  if (typeof rawData === 'string') {
    try {
      data = JSON.parse(rawData) as Record<string, unknown>;
    } catch {
      // If it's not valid JSON, wrap it
      data = { value: rawData };
    }
  } else if (typeof rawData === 'object' && rawData !== null) {
    data = rawData as Record<string, unknown>;
  }

  const capitalizedDataType = capitalize(dataType || 'unknown');

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      marginY={1}
    >
      <Box>
        {isExecuting ? (
          <>
            <Text color="cyan">{isRead ? '📖 ' : '📋 '}</Text>
            <Spinner />
            <Text color="cyan"> {isRead ? 'Reading' : 'Saving'} project state...</Text>
          </>
        ) : (
          <>
            <Text color="cyan">{isRead ? '📖 ' : '📋 '}</Text>
            <Text color="cyan">{isRead ? 'Project State: ' : 'Project State Update: '}</Text>
            <Text color="magenta" bold>{capitalizedDataType}</Text>
          </>
        )}
      </Box>
      {!isExecuting && data && (
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          {formatProjectStateData(data)}
        </Box>
      )}
    </Box>
  );
}

export function ToolCallDisplay({
  toolName,
  args,
  status = 'executing',
  result,
  duration,
  compact = false,
}: ToolCallDisplayProps) {
  // Special rendering for think tool
  if (toolName === 'think') {
    return renderThinkTool(args, status, duration);
  }

  // Special rendering for dispatch_agent (planning) tool
  if (toolName === 'dispatch_agent') {
    return renderDispatchAgentTool(args, status, result);
  }

  // Special rendering for project state tools
  if (toolName === 'write_project_state' || toolName === 'read_project_state') {
    return renderProjectStateTool(toolName, args, status, duration);
  }

  // Standard tool display
  const isExecuting = status === 'executing';
  const displayName = getDisplayName(toolName, isExecuting);
  const statusIcon = getStatusIcon(status);
  const toolCallStr = formatToolCall(toolName, args);

  if (compact) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={statusIcon.color}
        paddingX={1}
        marginY={1}
      >
        <Box>
          {isExecuting ? (
            <>
              <Text color="yellow">◉ </Text>
              <Spinner />
              <Text> {displayName}</Text>
            </>
          ) : (
            <>
              <Text color={statusIcon.color}>{statusIcon.icon} </Text>
              <Text>{displayName}</Text>
              {duration !== undefined && (
                <Text dimColor> ({formatDuration(duration)})</Text>
              )}
            </>
          )}
        </Box>
        <Box marginLeft={2}>
          <Text dimColor>{toolCallStr}</Text>
        </Box>
        {status === 'error' && result !== undefined && (
          <Box marginLeft={2}>
            <Text color="red">
              Error: {typeof result === 'object' ? JSON.stringify(result) : String(result)}
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  // Full (non-compact) display
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={statusIcon.color}
      paddingX={1}
      marginY={1}
    >
      <Box>
        {isExecuting ? (
          <>
            <Text color="yellow">◉ </Text>
            <Spinner />
            <Text bold> {displayName}</Text>
          </>
        ) : (
          <>
            <Text color={statusIcon.color}>{statusIcon.icon} </Text>
            <Text bold>{displayName}</Text>
            {duration !== undefined && (
              <Text dimColor> ({formatDuration(duration)})</Text>
            )}
          </>
        )}
      </Box>

      <Box marginLeft={2}>
        <Text dimColor>{toolCallStr}</Text>
      </Box>

      {status === 'error' && result !== undefined && (
        <Box marginLeft={2}>
          <Text color="red">
            Error: {typeof result === 'object' ? JSON.stringify(result) : String(result)}
          </Text>
        </Box>
      )}
    </Box>
  );
}
