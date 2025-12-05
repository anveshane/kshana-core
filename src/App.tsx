/**
 * Main application component.
 */
import React from 'react';
import { Text, Box, useApp } from 'ink';
import { AgentView } from './components/AgentView.js';
import { SimpleInput } from './components/UserInput.js';
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
  const [inputTask, setInputTask] = React.useState('');

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
    question,
    isConfirmation,
    error,
    recentTools,
    run,
    respond,
  } = useAgent({
    tools,
    llmConfig,
    agentConfig: {
      ...agentConfig,
      name: agentName,
      customPrompt,
    },
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
      setInputTask(task);
      setStarted(true);
      void run(task);
    },
    [run, exit]
  );

  // Handle user response
  const handleUserInput = React.useCallback(
    (input: string) => {
      void respond(input);
    },
    [respond]
  );

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
            <SimpleInput onSubmit={handleTaskSubmit} prefix="Story:" />
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
          <SimpleInput onSubmit={handleTaskSubmit} prefix="Task:" />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <AgentView
        agentName={agentName}
        status={status}
        statusMessage={error ?? (inputTask ? `Task: ${inputTask.slice(0, 50)}...` : undefined)}
        todos={todos}
        streamingText={output}
        isStreaming={status === 'thinking'}
        recentTools={recentTools}
        question={question}
        isConfirmation={isConfirmation}
        onUserInput={status === 'waiting' ? handleUserInput : undefined}
        showTodos
      />

      {/* Show new task input when completed */}
      {status === 'completed' && (
        <Box marginTop={1} paddingX={1}>
          <Text dimColor>Enter another task or type "exit":</Text>
          <SimpleInput onSubmit={handleTaskSubmit} />
        </Box>
      )}
    </Box>
  );
}
