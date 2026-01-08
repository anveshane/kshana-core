#!/usr/bin/env node
/**
 * Beautiful WebSocket CLI client for kshana-ink harness server.
 * Connects remotely via WebSocket but uses the same beautiful React Ink UI.
 */
import 'dotenv/config';
import React from 'react';
import { render, useApp, Box, Text } from 'ink';
import { Banner } from './components/Banner.js';
import { AgentView } from './components/AgentView.js';
import { UnifiedInput } from './components/UnifiedInput.js';
import { useWebSocketAgent } from './hooks/useWebSocketAgent.js';

interface ClientAppProps {
  serverUrl?: string;
  initialTask?: string;
}

function ClientApp({ serverUrl, initialTask }: ClientAppProps) {
  const agent = useWebSocketAgent({ serverUrl });
  // If initial task provided, start immediately to avoid stdin issues
  const [started, setStarted] = React.useState(!!initialTask);
  const { exit } = useApp();

  // Auto-start with initial task (only once)
  const hasRun = React.useRef(false);
  React.useEffect(() => {
    if (initialTask && !hasRun.current) {
      hasRun.current = true;
      agent.run(initialTask);
    }
  }, [initialTask, agent]);

  // Handle task submission
  const handleTaskSubmit = React.useCallback(
    (task: string) => {
      if (task.toLowerCase() === 'exit' || task.toLowerCase() === 'quit') {
        exit();
        return;
      }
      setStarted(true);
      agent.run(task);
    },
    [agent, exit]
  );

  // Handle user response
  const handleUserInput = React.useCallback(
    (input: string) => {
      if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
        exit();
        return;
      }
      agent.respond(input);
    },
    [agent, exit]
  );

  // Determine input mode based on status (must be before any conditional returns)
  const inputConfig = React.useMemo(() => {
    switch (agent.status) {
      case 'waiting':
        return {
          mode: 'text' as const,
          handler: handleUserInput,
          hint: 'Type your response and press Enter',
        };
      case 'completed':
      case 'idle':
      case 'error':
      default:
        return {
          mode: 'text' as const,
          handler: handleTaskSubmit,
          hint: 'Enter a new task or type "exit" to quit',
        };
    }
  }, [agent.status, handleUserInput, handleTaskSubmit]);

  // If not started, show welcome screen (only if stdin is TTY)
  if (!started && process.stdin.isTTY) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="column" padding={1}>
          <Banner
            subtitle="WebSocket Client - Connect to Remote Harness"
            version="v0.1.0"
          />

          <Box marginTop={1} marginBottom={1} flexDirection="column" paddingX={2}>
            <Text bold color="cyan">
              🔌 Connected to Remote Server
            </Text>
            <Text dimColor>
              Server: {serverUrl || 'ws://127.0.0.1:3000/api/v1/ws/chat'}
            </Text>
            <Text dimColor>
              Agent executes on remote harness with full agentic capabilities
            </Text>
          </Box>

          <Box marginBottom={1} paddingX={2}>
            <Text bold color="yellow">✨ Try these commands:</Text>
          </Box>
          <Box flexDirection="column" paddingX={4} marginBottom={1}>
            <Text dimColor>"Create a 3-step plan for making a robot"</Text>
            <Text dimColor>"Tell me a story about an AI detective"</Text>
            <Text dimColor>"Generate an image of a sunset" (tool calls)</Text>
          </Box>
        </Box>

        {/* Input at bottom */}
        <Box paddingX={1} paddingY={1} borderStyle="round" borderColor="cyan">
          <UnifiedInput
            mode="text"
            onSubmit={handleTaskSubmit}
            prompt=">"
            hint={'Enter a task and press Enter. Type "exit" to quit.'}
          />
        </Box>
      </Box>
    );
  }

  // Agent is running - show full agent view with input
  return (
    <Box flexDirection="column">
      <AgentView
        status={agent.status}
        todos={agent.todos}
        output={agent.output}
        streamingText={agent.streamingText}
        isStreaming={agent.isStreaming}
        question={agent.question}
        isConfirmation={agent.isConfirmation}
        error={agent.error}
        recentTools={agent.recentTools}
        history={agent.history}
        currentAction={agent.currentAction}
        run={handleTaskSubmit}
        respond={handleUserInput}
        reset={() => {
          agent.reset();
          setStarted(false);
        }}
        stop={agent.stop}
      />

      {/* Input at bottom - show when not actively thinking and stdin is a TTY */}
      {process.stdin.isTTY && (agent.status === 'idle' || agent.status === 'completed' || agent.status === 'waiting' || agent.status === 'error') && (
        <Box paddingX={1} paddingY={1} borderStyle="round" borderColor="cyan">
          <UnifiedInput
            mode={inputConfig.mode}
            onSubmit={inputConfig.handler}
            prompt=">"
            hint={inputConfig.hint}
          />
        </Box>
      )}

      {/* Show exit message when stdin is not TTY and task is done */}
      {!process.stdin.isTTY && agent.status === 'completed' && (
        <Box marginTop={1}>
          <Text color="green">Task completed. Process will exit.</Text>
        </Box>
      )}
    </Box>
  );
}

// Parse command line arguments
function parseArgs(): {
  serverUrl?: string;
  initialTask?: string;
  help: boolean;
} {
  const args = process.argv.slice(2);
  let serverUrl: string | undefined;
  let initialTask: string | undefined;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '-h':
      case '--help':
        help = true;
        break;
      case '-s':
      case '--server':
        serverUrl = nextArg;
        i++;
        break;
      case '-t':
      case '--task':
        initialTask = nextArg;
        i++;
        break;
      default:
        // If no flag, treat as task
        if (arg && !arg.startsWith('-') && !initialTask) {
          initialTask = arg;
        }
    }
  }

  return { serverUrl, initialTask, help };
}

function printHelp(): void {
  console.log(`
kshana-ink WebSocket Client - Beautiful Remote CLI

Usage:
  kshana-wsclient [options] [task]

Options:
  -h, --help              Show this help message
  -s, --server <url>      WebSocket server URL (default: ws://127.0.0.1:3000/api/v1/ws/chat)
  -t, --task <task>       Initial task to run

Examples:
  kshana-wsclient                                    # Connect with interactive mode
  kshana-wsclient "Create a plan for a robot"       # Run task immediately
  kshana-wsclient -s ws://remote:3000/api/v1/ws/chat  # Connect to remote server
  kshana-wsclient -t "Tell me a story"              # Run specific task

Features:
  ✨ Beautiful React Ink terminal UI
  🔌 Connects to remote harness server via WebSocket
  📝 Real-time streaming text
  🔧 Live tool call updates
  ✅ Hierarchical todo lists
  💬 Interactive Q&A with agent
  🎨 Same beautiful UI as local mode

Interactive Commands:
  Type your task and press Enter to start the agent.
  Type "exit" or "quit" to exit the application.
  Ctrl+C to cancel current task or exit.
`);
}

// Main entry point
const { serverUrl, initialTask, help } = parseArgs();

if (help) {
  printHelp();
  process.exit(0);
}

console.log('🚀 Starting WebSocket client...');
console.log(`Server: ${serverUrl || 'ws://127.0.0.1:3000/api/v1/ws/chat'}`);
console.log('');

// Clear the screen
process.stdout.write('\x1B[2J\x1B[0f');

// Render with fullscreen mode enabled
render(<ClientApp serverUrl={serverUrl} initialTask={initialTask} />);
