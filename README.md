# kshana-ink

A generic CLI agent framework built with React Ink and TypeScript. This is a port of the [kshana](https://github.com/...) GenericAgent architecture from Python to TypeScript with a reactive terminal UI.

## Features

- **Generic Agent Framework** - Domain-agnostic agent with hierarchical todo management
- **React Ink UI** - Reactive terminal interface with streaming text, todo visualization, and interactive prompts
- **Multi-Provider Support** - Works with Gemini, LM Studio, OpenAI, or any OpenAI-compatible API
- **Hierarchical Todos** - Expandable todo items with automatic progression
- **Framework-Enforced Confirmation** - Complex tools require user confirmation before execution
- **Sub-Agent Dispatch** - Main agent can delegate tasks to sub-agents with isolated state
- **Task Types** - Extensible task system (generic, video) with domain-specific tools and prompts
- **HTTP/WebSocket Server** - Expose agent via REST API and WebSocket for real-time communication

## Installation

```bash
# Clone and install
git clone <repo>
cd kshana-ink
pnpm install

# Copy environment template
cp .env.example .env

# Edit .env with your configuration
# Then run
pnpm start
```

## Configuration

### Quick Start with Different Providers

**LM Studio (Local):**
```bash
export LLM_PROVIDER=lmstudio
export LMSTUDIO_MODEL=qwen3
pnpm start
```

**Gemini:**
```bash
export LLM_PROVIDER=gemini
export GOOGLE_API_KEY=your-api-key
pnpm start
```

**OpenAI:**
```bash
export LLM_PROVIDER=openai
export OPENAI_API_KEY=your-api-key
pnpm start
```

**Comfy Cloud for image/video generation:**
```bash
export COMFYUI_BASE_URL=https://cloud.comfy.org
export COMFY_CLOUD_API_KEY=your-comfy-cloud-api-key
pnpm start
```

### Environment Variables

Create a `.env` file (copy from `.env.example`):

```bash
# Provider selection: gemini, lmstudio, openai, or custom
LLM_PROVIDER=lmstudio

# Gemini (when LLM_PROVIDER=gemini)
GOOGLE_API_KEY=your-google-api-key
GEMINI_MODEL=gemini-2.0-flash

# LM Studio (when LLM_PROVIDER=lmstudio)
LMSTUDIO_BASE_URL=http://127.0.0.1:1234/v1
LMSTUDIO_MODEL=qwen3
LMSTUDIO_API_KEY=not-needed

# OpenAI (when LLM_PROVIDER=openai)
OPENAI_API_KEY=your-openai-api-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o

# Custom/Fallback (when LLM_PROVIDER=custom or not set)
LLM_BASE_URL=http://127.0.0.1:1234/v1
LLM_API_KEY=not-needed
LLM_MODEL=local-model

# ComfyUI / Comfy Cloud
# Use http://localhost:8188 for local ComfyUI or https://cloud.comfy.org for Comfy Cloud
COMFYUI_BASE_URL=http://localhost:8188
# Required only when COMFYUI_BASE_URL=https://cloud.comfy.org
COMFY_CLOUD_API_KEY=
COMFYUI_TIMEOUT=300
```

When `COMFYUI_BASE_URL` points to `https://cloud.comfy.org`, `kshana-ink` switches to Comfy Cloud mode automatically, uses Cloud API routes, and requires `COMFY_CLOUD_API_KEY`. Any other ComfyUI URL keeps the existing local/self-hosted behavior and ignores `COMFY_CLOUD_API_KEY`.

### Command Line Options

```
Options:
  -h, --help            Show help message
  -t, --task <task>     Initial task to run
  -p, --provider <name> LLM provider: gemini, lmstudio, openai, custom
  -m, --model <model>   LLM model name (overrides env)
  -u, --url <url>       LLM API base URL (overrides env)
  -k, --api-key <key>   LLM API key (overrides env)

Task Types:
  --type <type>         Agent type: video, generic (default: video)
  --generic             Shorthand for --type generic

Server Mode:
  -s, --server          Start HTTP/WebSocket server instead of CLI
  --host <host>         Server host (default: 127.0.0.1)
  --port <port>         Server port (default: 3000)
```

## Usage

### Interactive Mode (Video Creation)

```bash
pnpm start
```

This starts the CLI in video creation mode where you can describe story ideas and the agent will guide you through creating AI-generated videos.

### With Initial Story Idea

```bash
pnpm start -- "A story about a robot learning to dance"
```

### Video Mode Features

Video mode (the default) includes:
- Story development and character creation
- Storyboard generation with scene descriptions
- Image generation for scenes (via ComfyUI integration)
- Video compilation from scene images

### Generic Agent Mode

For general-purpose tasks without video-specific tools:

```bash
# Interactive generic mode
pnpm start -- --generic

# With initial task
pnpm start -- --generic "Create a todo app"
```

### Override Provider via CLI

```bash
pnpm start -- -p gemini "A cyberpunk noir story"
```

### Server Mode

Start an HTTP/WebSocket server for programmatic access:

```bash
# Start video server (default)
pnpm server

# Start generic server
pnpm start -- -s --generic

# Custom port
pnpm start -- -s --port 8080
```

**API Endpoints:**
- `GET /api/v1/health` - Health check
- `POST /api/v1/chat` - Stateless chat (single request/response)
- `WS /api/v1/ws/chat` - WebSocket for real-time streaming

## Architecture

```
src/
├── core/                    # Domain-agnostic agent framework
│   ├── agent/              # GenericAgent with todo management
│   ├── llm/                # OpenAI-compatible LLM client + config
│   ├── todo/               # Hierarchical todo manager
│   ├── tools/              # Tool registry and built-in tools
│   └── prompts/            # System prompts (base, sub-agent, orchestrator)
├── tasks/                  # Task-specific configurations
│   ├── index.ts            # Task factory and registry
│   └── video/              # Video creation task
│       ├── prompts.ts      # Video-specific system prompts
│       ├── tools.ts        # Image/video generation tools
│       └── state.ts        # Project state management
├── server/                 # HTTP/WebSocket server
│   ├── routes.ts           # API endpoints
│   ├── ConversationManager.ts  # Session orchestration
│   └── WebSocketHandler.ts # Real-time communication
├── components/             # React Ink UI components
│   ├── AgentView.tsx       # Main agent interaction view
│   ├── TodoList.tsx        # Hierarchical todo display
│   ├── StreamingText.tsx   # Real-time LLM output
│   └── ...
├── hooks/                  # Custom React hooks
│   ├── useAgent.ts         # Agent lifecycle management
│   └── useTodos.ts         # Todo state management
└── events/                 # Event system for UI updates
```

## Extending

### Adding Custom Tools

```typescript
import { createTool, ToolRegistry } from './core/tools';

const myTool = createTool(
  'my_tool',
  'Description of what the tool does',
  {
    type: 'object',
    properties: {
      input: { type: 'string', description: 'Input parameter' },
    },
    required: ['input'],
  },
  async (args) => {
    // Tool implementation
    return { result: args.input };
  }
);

const registry = new ToolRegistry();
registry.register(myTool);
```

### Custom System Prompts

Add domain-specific prompts when creating the agent:

```typescript
import { GenericAgent } from './core/agent';

const agent = new GenericAgent(tools, llm, {
  customPrompt: `
    # My Domain-Specific Instructions

    You are specialized for X task...
  `,
});
```

## Tool Categories

- **Simple Tools** - Execute immediately (think, ask_user, todo tools)
- **Complex Tools** - Require user confirmation (generate_image, generate_video, etc.)

Complex tools use framework-enforced confirmation: they return `needs_confirmation` on first call, requiring the agent to use `ask_user` before the operation executes.

## Scripts

```bash
pnpm start          # Run the CLI (video mode by default)
pnpm dev            # Run with watch mode
pnpm server         # Run HTTP/WebSocket server (video mode)
pnpm server:dev     # Run server with watch mode
pnpm test:client    # Run WebSocket test client
pnpm build          # Build for production
pnpm test           # Run tests in watch mode
pnpm test:ci        # Run tests once
pnpm test:coverage  # Run tests with coverage
pnpm lint           # Type check and lint
pnpm format         # Format code with Prettier
```

## License

MIT
