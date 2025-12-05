#!/usr/bin/env node
/**
 * Standalone server CLI entry point.
 * Run with: npx tsx src/server/cli.ts
 */
import 'dotenv/config';
import { createServer } from './index.js';
import { getLLMConfig, getLLMProvider, validateLLMConfig } from '../core/llm/index.js';

// Parse command line arguments
function parseArgs(): {
  host: string;
  port: number;
  help: boolean;
  provider?: string;
} {
  const args = process.argv.slice(2);
  let host = '127.0.0.1';
  let port = 3000;
  let help = false;
  let provider: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '-h':
      case '--help':
        help = true;
        break;
      case '--host':
        host = nextArg ?? host;
        i++;
        break;
      case '--port':
      case '-p':
        port = parseInt(nextArg ?? '3000', 10);
        i++;
        break;
      case '--provider':
        provider = nextArg;
        i++;
        break;
    }
  }

  return { host, port, help, provider };
}

function printHelp(): void {
  const currentProvider = getLLMProvider();

  console.log(`
kshana-ink Server - HTTP/WebSocket API for Generic Agent

Usage:
  kshana-ink-server [options]

Options:
  -h, --help            Show this help message
  --host <host>         Host to bind to (default: 127.0.0.1)
  -p, --port <port>     Port to listen on (default: 3000)
  --provider <name>     LLM provider: gemini, lmstudio, openai, custom

Environment Variables:
  LLM_PROVIDER          Provider to use (current: ${currentProvider})
  See .env.example for all available configuration options.

Endpoints:
  GET  /api/v1/health           Health check
  POST /api/v1/chat             Stateless chat (single request/response)
  GET  /api/v1/sessions         List active sessions
  GET  /api/v1/sessions/:id     Get session info
  DELETE /api/v1/sessions/:id   Delete a session
  WS   /api/v1/ws/chat          WebSocket for real-time chat

WebSocket Message Types (Client -> Server):
  start_task      Start a new task: { type: "start_task", data: { task: "..." } }
  user_response   Respond to question: { type: "user_response", data: { response: "..." } }
  cancel          Cancel current task: { type: "cancel" }
  ping            Keep-alive: { type: "ping" }

WebSocket Message Types (Server -> Client):
  status          Connection/session status
  progress        Agent progress updates
  agent_response  Final agent response
  agent_question  Agent asking user a question
  tool_call       Tool execution notification
  todo_update     Todo list changes
  stream_chunk    Streaming text chunk
  error           Error message

Examples:
  kshana-ink-server                    # Start server on default port
  kshana-ink-server --port 8080        # Start on port 8080
  kshana-ink-server --host 0.0.0.0     # Listen on all interfaces
`);
}

// Main
async function main(): Promise<void> {
  const { host, port, help, provider } = parseArgs();

  if (help) {
    printHelp();
    process.exit(0);
  }

  // Set provider if specified via CLI
  if (provider) {
    process.env['LLM_PROVIDER'] = provider;
  }

  // Validate configuration
  const validation = validateLLMConfig();
  if (!validation.valid) {
    console.error('Configuration errors:');
    for (const error of validation.errors) {
      console.error(`  - ${error}`);
    }
    console.error('\nRun with --help to see available environment variables.');
    process.exit(1);
  }

  // Get LLM config
  const llmConfig = getLLMConfig();

  console.log(`Using provider: ${getLLMProvider()}`);
  console.log(`Model: ${llmConfig.model}`);
  console.log(`Base URL: ${llmConfig.baseUrl}`);
  console.log('');

  try {
    const server = await createServer(
      { llmConfig },
      { host, port }
    );

    await server.start();
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

main().catch(console.error);
