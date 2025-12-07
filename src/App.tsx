/**
 * Main application component.
 */
import React from 'react';
import { Text, Box, useApp, useInput } from 'ink';
import { AgentView } from './components/AgentView.js';
import { SimpleTextInput } from './components/TextInput.js';
import { UnifiedInput, type InputMode } from './components/UnifiedInput.js';
import { Banner } from './components/Banner.js';
import { useAgent } from './hooks/useAgent.js';
import { createDefaultToolRegistry } from './core/tools/index.js';
import { createVideoToolRegistry, VIDEO_CREATION_SYSTEM_PROMPT } from './tasks/video/index.js';
import type { LLMClientConfig } from './core/llm/index.js';
import type { AgentConfig } from './core/agent/index.js';

type TaskType = 'generic' | 'video';

interface AppProps {
  llmConfig?: LLMClientConfig;
  agentConfig?: AgentConfig;
  initialTask?: string;
  taskType?: TaskType;
}

export function App({ llmConfig, agentConfig, initialTask, taskType = 'generic' }: AppProps) {
  const { exit } = useApp();
  const [started, setStarted] = React.useState(false);
  const [expandedView, setExpandedView] = React.useState(false);
  const [selectedOptionIndex, setSelectedOptionIndex] = React.useState(0);

  // Create tool registry based on task type
  const tools = React.useMemo(() => {
    if (taskType === 'video') {
      return createVideoToolRegistry().getAll();
    }
    return createDefaultToolRegistry().getAll();
  }, [taskType]);

  // Get custom prompt based on task type
  const customPrompt = React.useMemo(() => {
    if (taskType === 'video') {
      return VIDEO_CREATION_SYSTEM_PROMPT;
    }
    return agentConfig?.customPrompt;
  }, [taskType, agentConfig?.customPrompt]);

  // Compute effective agent name based on task type
  const agentName = agentConfig?.name ?? (taskType === 'video' ? 'kshana-video' : 'kshana-ink');

  const {
    status,
    todos,
    output,
    streamingText,
    isStreaming,
    question,
    isConfirmation,
    questionOptions,
    error,
    recentTools,
    history,
    currentAction,
    run,
    respond,
    stop,
    injectInput,
  } = useAgent({
    tools,
    llmConfig,
    agentConfig: {
      ...agentConfig,
      name: agentName,
      customPrompt,
    },
  });

  // Handle global keyboard shortcuts
  useInput((input, key) => {
    // Escape: Stop execution
    if (key.escape && status === 'thinking') {
      stop();
    }
    // Ctrl+O: Toggle expanded view
    if (input === 'o' && key.ctrl) {
      setExpandedView(prev => !prev);
    }
  });

  // Run initial task if provided
  React.useEffect(() => {
    if (initialTask && !started) {
      setStarted(true);
      void run(initialTask);
    }
  }, [initialTask, started, run]);

  // Handle task submission
  const handleTaskSubmit = React.useCallback(
    (task: string) => {
      if (task.toLowerCase() === 'exit' || task.toLowerCase() === 'quit') {
        exit();
        return;
      }
      setStarted(true);
      // Task is added to history by useAgent
      void run(task);
    },
    [run, exit]
  );

  // Handle user response (when agent is waiting for input)
  const handleUserInput = React.useCallback(
    (input: string) => {
      // Always allow exit
      if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
        exit();
        return;
      }
      // User response is added to history by useAgent
      void respond(input);
    },
    [respond, exit]
  );

  // Handle user input during execution (inject into running agent)
  const handleInjectedInput = React.useCallback(
    (input: string) => {
      if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
        exit();
        return;
      }
      // Inject into running agent (TODO: add to history if needed)
      injectInput(input);
    },
    [injectInput, exit]
  );

  // Handle new task after completion or idle
  const handleNewTask = React.useCallback(
    (input: string) => {
      if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
        exit();
        return;
      }
      handleTaskSubmit(input);
    },
    [handleTaskSubmit, exit]
  );

  // Reset selection when options change - MUST be before any conditional returns
  React.useEffect(() => {
    setSelectedOptionIndex(0);
  }, [questionOptions]);

  // Determine input mode and handler based on status
  const inputConfig = React.useMemo((): { mode: InputMode; handler: (value: string) => void; hint?: string } => {
    switch (status) {
      case 'thinking':
        return {
          mode: 'text',
          handler: handleInjectedInput,
          hint: 'Type to add context or press Esc to stop. Ctrl+O to toggle view.',
        };
      case 'waiting':
        // Determine mode based on question type
        if (questionOptions && questionOptions.length > 0) {
          return {
            mode: 'selection',
            handler: handleUserInput,
            hint: 'Use ↑↓ to navigate, 1-9 to quick select, Enter to confirm, or type custom response',
          };
        }
        if (isConfirmation) {
          return {
            mode: 'confirmation',
            handler: handleUserInput,
            hint: 'Press y for Yes, n for No',
          };
        }
        return {
          mode: 'text',
          handler: handleUserInput,
          hint: 'Type your response and press Enter',
        };
      case 'completed':
      case 'idle':
      case 'error':
      default:
        return {
          mode: 'text',
          handler: handleNewTask,
          hint: 'Enter a task or type "exit" to quit',
        };
    }
  }, [status, questionOptions, isConfirmation, handleInjectedInput, handleUserInput, handleNewTask]);

  // Show welcome screen if not started
  if (!started) {
    const subtitle = taskType === 'video'
      ? 'Agentic Video Generation System'
      : 'Generic CLI Agent Framework';

    if (taskType === 'video') {
      return (
        <Box flexDirection="column" padding={1}>
          <Banner subtitle={subtitle} />

          <Box flexDirection="column" marginBottom={1} paddingX={2}>
            <Text bold color="cyan">Welcome to Kshana!</Text>
            <Text dimColor>
              I can help you create videos from your story ideas. Here's how it works:
            </Text>
            <Box marginTop={1} flexDirection="column">
              <Text>  1. Describe your story idea or concept</Text>
              <Text>  2. I'll help develop characters, settings, and plot</Text>
              <Text>  3. We'll create a storyboard together</Text>
              <Text>  4. Generate images and videos for each scene</Text>
            </Box>
          </Box>

          <Box marginBottom={1} paddingX={2}>
            <Text bold color="yellow">Example prompts:</Text>
          </Box>
          <Box flexDirection="column" paddingX={4} marginBottom={1}>
            <Text dimColor>"A story about a robot learning to dance"</Text>
            <Text dimColor>"Create a video about a magical forest adventure"</Text>
            <Text dimColor>"An epic tale of a knight and a dragon"</Text>
          </Box>

          <Box paddingX={2}>
            <Text dimColor>Type "exit" to quit.</Text>
          </Box>

          <Box marginTop={1} paddingX={2}>
            <SimpleTextInput onSubmit={handleTaskSubmit} prompt="Story:" />
          </Box>
        </Box>
      );
    }

    // Generic mode welcome
    return (
      <Box flexDirection="column" padding={1}>
        <Banner subtitle={subtitle} />
        <Box marginBottom={1} paddingX={2}>
          <Text dimColor>Type your task and press Enter. Type "exit" to quit.</Text>
        </Box>
        <Box paddingX={2}>
          <SimpleTextInput onSubmit={handleTaskSubmit} prompt="Task:" />
        </Box>
      </Box>
    );
  }

  // Main agent view
  return (
    <Box flexDirection="column">
      {/* Main content area */}
      <AgentView
        agentName={agentName}
        status={status}
        statusMessage={error}
        todos={todos}
        streamingText={streamingText || output}
        isStreaming={isStreaming}
        question={question}
        isConfirmation={isConfirmation}
        questionOptions={questionOptions}
        selectedOptionIndex={selectedOptionIndex}
        showTodos
        history={history}
        currentAction={currentAction}
        expanded={expandedView}
      />

      {/* Unified Input - always visible at bottom */}
      <Box paddingX={1} paddingY={1} borderStyle="round" borderColor="cyan">
        <UnifiedInput
          mode={inputConfig.mode}
          onSubmit={inputConfig.handler}
          options={questionOptions}
          prompt={status === 'waiting' ? '?' : '>'}
          hint={inputConfig.hint}
          onSelectionChange={setSelectedOptionIndex}
        />
      </Box>
    </Box>
  );
}
