/**
 * Simple Markdown renderer for terminal output.
 * Supports basic markdown: headers, bold, italic, lists, code blocks.
 */
import React from 'react';
import { Text, Box } from 'ink';

interface MarkdownTextProps {
  text: string;
  /** Whether to show streaming cursor */
  isStreaming?: boolean;
}

/**
 * Parse a line and return React elements with styling.
 */
function parseLine(line: string, index: number): React.ReactNode {
  // Headers
  if (line.startsWith('### ')) {
    return (
      <Text key={index} color="cyan" bold>
        {line.slice(4)}
      </Text>
    );
  }
  if (line.startsWith('## ')) {
    return (
      <Text key={index} color="yellow" bold>
        {line.slice(3)}
      </Text>
    );
  }
  if (line.startsWith('# ')) {
    return (
      <Text key={index} color="green" bold>
        {line.slice(2)}
      </Text>
    );
  }

  // Horizontal rule
  if (line.match(/^[-*_]{3,}$/)) {
    return (
      <Text key={index} dimColor>
        ────────────────────────────────────────
      </Text>
    );
  }

  // Bullet lists
  if (line.match(/^[\s]*[-*+]\s/)) {
    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
    const content = line.replace(/^[\s]*[-*+]\s/, '');
    return (
      <Box key={index} marginLeft={indent}>
        <Text color="cyan">• </Text>
        <Text>{parseInlineFormatting(content)}</Text>
      </Box>
    );
  }

  // Numbered lists
  if (line.match(/^[\s]*\d+\.\s/)) {
    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
    const match = line.match(/^[\s]*(\d+)\.\s(.*)$/);
    if (match) {
      const [, num, content] = match;
      return (
        <Box key={index} marginLeft={indent}>
          <Text color="yellow">{num}. </Text>
          <Text>{parseInlineFormatting(content)}</Text>
        </Box>
      );
    }
  }

  // Regular text with inline formatting
  return <Text key={index}>{parseInlineFormatting(line)}</Text>;
}

/**
 * Parse inline formatting (bold, italic, code, strikethrough).
 */
function parseInlineFormatting(text: string): React.ReactNode {
  const elements: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Bold: **text** or __text__
    let match = remaining.match(/^(.*?)\*\*(.+?)\*\*(.*)/s);
    if (!match) {
      match = remaining.match(/^(.*?)__(.+?)__(.*)/s);
    }
    if (match) {
      const [, before, bold, after] = match;
      if (before) {
        elements.push(<Text key={key++}>{before}</Text>);
      }
      elements.push(
        <Text key={key++} bold color="white">
          {bold}
        </Text>
      );
      remaining = after;
      continue;
    }

    // Italic: *text* or _text_
    match = remaining.match(/^(.*?)\*([^*]+)\*(.*)/s);
    if (!match) {
      match = remaining.match(/^(.*?)_([^_]+)_(.*)/s);
    }
    if (match) {
      const [, before, italic, after] = match;
      if (before) {
        elements.push(<Text key={key++}>{before}</Text>);
      }
      elements.push(
        <Text key={key++} italic color="white">
          {italic}
        </Text>
      );
      remaining = after;
      continue;
    }

    // Inline code: `code`
    match = remaining.match(/^(.*?)`([^`]+)`(.*)/s);
    if (match) {
      const [, before, code, after] = match;
      if (before) {
        elements.push(<Text key={key++}>{before}</Text>);
      }
      elements.push(
        <Text key={key++} backgroundColor="gray" color="white">
          {` ${code} `}
        </Text>
      );
      remaining = after;
      continue;
    }

    // No more formatting found, add remaining text
    elements.push(<Text key={key++}>{remaining}</Text>);
    break;
  }

  return elements.length === 1 ? elements[0] : <>{elements}</>;
}

/**
 * Render markdown text with terminal-friendly styling.
 */
export function MarkdownText({ text, isStreaming = false }: MarkdownTextProps) {
  if (!text) {
    return null;
  }

  const lines = text.split('\n');
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];
  let codeBlockLang = '';
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block start/end
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        // Start code block
        inCodeBlock = true;
        codeBlockLang = line.slice(3).trim();
        codeBlockContent = [];
      } else {
        // End code block
        inCodeBlock = false;
        elements.push(
          <Box
            key={`code-${i}`}
            flexDirection="column"
            borderStyle="round"
            borderColor="gray"
            paddingX={1}
            marginY={1}
          >
            {codeBlockLang && (
              <Text dimColor italic>
                {codeBlockLang}
              </Text>
            )}
            {codeBlockContent.map((codeLine, j) => (
              <Text key={j} color="green">
                {codeLine}
              </Text>
            ))}
          </Box>
        );
        codeBlockContent = [];
        codeBlockLang = '';
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      elements.push(<Text key={i}> </Text>);
      continue;
    }

    elements.push(parseLine(line, i));
  }

  // Handle unclosed code block (streaming case)
  if (inCodeBlock && codeBlockContent.length > 0) {
    elements.push(
      <Box
        key="code-streaming"
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
        marginY={1}
      >
        {codeBlockLang && (
          <Text dimColor italic>
            {codeBlockLang}
          </Text>
        )}
        {codeBlockContent.map((codeLine, j) => (
          <Text key={j} color="green">
            {codeLine}
          </Text>
        ))}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {elements}
      {isStreaming && <Text color="cyan">▌</Text>}
    </Box>
  );
}
