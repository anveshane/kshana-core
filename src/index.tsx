#!/usr/bin/env node
/**
 * kshana-ink CLI entry point.
 */
import 'dotenv/config';
import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { getLLMConfig, getLLMProvider, validateLLMConfig, resetLLMLogger, type LLMClientConfig } from './core/llm/index.js';
import { resetPhaseLogger } from './utils/phaseLogger.js';
import { resetDebugLog } from './hooks/useAgent.js';
import { startAnalyticsDashboard, stopAnalyticsDashboard } from './server/analytics.js';

// Task type for agent specialization
type TaskType = 'generic' | 'video';

// Parse command line arguments
function parseArgs(): {
  task?: string;
  llmOverrides: Partial<LLMClientConfig>;
  help: boolean;
  provider?: string;
  cli: boolean;
  serverHost: string;
  serverPort: number;
  taskType: TaskType;
} {
  const args = process.argv.slice(2);
  let task: string | undefined;
  let help = false;
  let provider: string | undefined;
  let cli = false;
  let serverHost = '127.0.0.1';
  let serverPort = 3000;
  let taskType: TaskType = 'video';
  const llmOverrides: Partial<LLMClientConfig> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '-h':
      case '--help':
        help = true;
        break;
      case '-t':
      case '--task':
        task = nextArg;
        i++;
        break;
      case '-p':
      case '--provider':
        provider = nextArg;
        i++;
        break;
      case '-m':
      case '--model':
        llmOverrides.model = nextArg;
        i++;
        break;
      case '-u':
      case '--url':
      case '--base-url':
        llmOverrides.baseUrl = nextArg;
        i++;
        break;
      case '-k':
      case '--api-key':
        llmOverrides.apiKey = nextArg;
        i++;
        break;
      case '--cli':
        cli = true;
        break;
      case '--host':
        serverHost = nextArg ?? serverHost;
        i++;
        break;
      case '--port':
        serverPort = parseInt(nextArg ?? '3000', 10);
        i++;
        break;
      case '--generic':
        taskType = 'generic';
        break;
      case '--type':
        taskType = (nextArg as TaskType) ?? 'video';
        i++;
        break;
      default:
        // If no flag, treat as task
        if (arg && !arg.startsWith('-') && !task) {
          task = arg;
        }
    }
  }

  return { task, llmOverrides, help, provider, cli, serverHost, serverPort, taskType };
}

function printHelp(): void {
  const currentProvider = getLLMProvider();

  console.log(`
kshana-ink - Generic CLI Agent Framework

Usage:
  kshana-ink [options] [task]

Options:
  -h, --help            Show this help message
  -t, --task <task>     Initial task to run
  -p, --provider <name> LLM provider: gemini, lmstudio, openai, custom
  -m, --model <model>   LLM model name
  -u, --url <url>       LLM API base URL
  -k, --api-key <key>   LLM API key

Task Types:
  --type <type>         Agent type: generic, video (default: video)
  --generic             Shorthand for --type generic

Modes:
  --cli                 Use terminal UI (React Ink) instead of web UI
  --host <host>         Server host (default: 127.0.0.1)
  --port <port>         Server port (default: 3000)

Environment Variables:
  LLM_PROVIDER          Provider to use: gemini, lmstudio, openai, custom (current: ${currentProvider})

  # Gemini (when LLM_PROVIDER=gemini)
  GOOGLE_API_KEY        Google API key for Gemini
  GEMINI_MODEL          Model name (default: gemini-2.0-flash)

  # LM Studio (when LLM_PROVIDER=lmstudio)
  LMSTUDIO_BASE_URL     LM Studio server URL (default: http://127.0.0.1:1234/v1)
  LMSTUDIO_MODEL        Model name loaded in LM Studio
  LMSTUDIO_API_KEY      API key (usually not needed)

  # OpenAI (when LLM_PROVIDER=openai)
  OPENAI_API_KEY        OpenAI API key
  OPENAI_BASE_URL       Base URL (default: https://api.openai.com/v1)
  OPENAI_MODEL          Model name (default: gpt-4o)

  # Custom/Fallback
  LLM_BASE_URL          Base URL for OpenAI-compatible API
  LLM_API_KEY           API key for authentication
  LLM_MODEL             Model name to use

Task Types:
  video                 Video creation agent - story → storyboard → images → video (default)
  generic               General-purpose autonomous agent with todo management

Examples:
  kshana-ink                               # Start web UI (default)
  kshana-ink --port 8080                   # Web UI on custom port
  kshana-ink --cli                         # Terminal UI mode
  kshana-ink --cli "A zombie apocalypse"   # Terminal UI with initial task
  kshana-ink --generic "Create a todo app" # Generic agent mode
  kshana-ink -p lmstudio                   # Use LM Studio
`);
}

// Main entry point
const { task, llmOverrides, help, provider, cli, serverHost, serverPort, taskType } = parseArgs();

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

// Get merged config (env + CLI overrides)
const llmConfig = getLLMConfig(llmOverrides);

// Show config info
const currentProvider = getLLMProvider();
const maskedApiKey = llmConfig.apiKey
  ? `${llmConfig.apiKey.slice(0, 4)}...${llmConfig.apiKey.slice(-4)}`
  : '(not set)';
console.log(`Provider: ${currentProvider}`);
console.log(`Model: ${llmConfig.model}`);
console.log(`Base URL: ${llmConfig.baseUrl}`);
console.log(`API Key: ${maskedApiKey}`);
console.log(`Task type: ${taskType}`);
console.log('');

// Start analytics dashboard (non-blocking, fire-and-forget)
startAnalyticsDashboard(3001).catch(() => {});

// Ensure clean exit on Ctrl+C — kills analytics server and any stuck event loop handles
function handleExit() {
  stopAnalyticsDashboard();
  // Give 2s for graceful cleanup, then force exit
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', handleExit);
process.on('SIGTERM', handleExit);

// Start in CLI mode or server mode (default)
if (cli) {
  // CLI mode - clear screen and render the React Ink app
  process.stdout.write('\x1B[2J\x1B[0f');

  // Reset loggers (creates fresh log files for this session)
  resetLLMLogger();
  resetPhaseLogger();
  resetDebugLog();

  // Render with fullscreen mode enabled
  render(<App llmConfig={llmConfig} initialTask={task} taskType={taskType} />);
} else {
  // Server mode (default) - import and start the server with web UI
  import('./server/index.js').then(async ({ createServer }) => {
    try {
      const serverInstance = await createServer(
        { llmConfig },
        { host: serverHost, port: serverPort }
      );
      await serverInstance.start();
    } catch (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
  });
}
