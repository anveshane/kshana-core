/**
 * Main application component.
 */
import React from 'react';
import { Text, Box, useApp, useInput } from 'ink';
import { AgentView } from './components/AgentView.js';
import { UnifiedInput, type InputMode } from './components/UnifiedInput.js';
import { Banner } from './components/Banner.js';
import { useAgent } from './hooks/useAgent.js';
import { createDefaultToolRegistry } from './core/tools/index.js';
import {
  createWorkflowToolRegistry,
  VIDEO_CREATION_SYSTEM_PROMPT,
  projectExists,
  loadProject,
  deleteProject,
  createProject,
  STYLE_CONFIGS,
  type ProjectStyle,
} from './tasks/video/index.js';
import { VideoAgent } from './agents/VideoAgent.js';
import type { LLMClientConfig, ToolDefinition, LLMClient } from './core/llm/index.js';
import type { AgentConfig, GenericAgent } from './core/agent/index.js';
import * as uiLogger from './utils/uiLogger.js';

type TaskType = 'generic' | 'video';

interface AppProps {
  llmConfig?: LLMClientConfig;
  agentConfig?: AgentConfig;
  initialTask?: string;
  taskType?: TaskType;
}

// Startup mode for video task type
type StartupMode = 'checking' | 'select_action' | 'select_style' | 'new_story' | 'youtube_url' | 'ready';

export function App({ llmConfig, agentConfig, initialTask, taskType = 'generic' }: AppProps) {
  const { exit } = useApp();
  const [started, setStarted] = React.useState(false);
  const [expandedView, setExpandedView] = React.useState(false);
  const [selectedOptionIndex, setSelectedOptionIndex] = React.useState(0);
  // Track when user selected "Provide feedback" and needs to enter actual feedback
  const [awaitingFeedbackText, setAwaitingFeedbackText] = React.useState(false);

  // Startup flow state for video mode
  const [startupMode, setStartupMode] = React.useState<StartupMode>('checking');
  const [existingProject, setExistingProject] = React.useState<ReturnType<typeof loadProject>>(null);
  const [startupSelectedIndex, setStartupSelectedIndex] = React.useState(0);
  const [selectedStyle, setSelectedStyle] = React.useState<ProjectStyle>('cinematic_realism');
  const [styleSelectedIndex, setStyleSelectedIndex] = React.useState(0);

  // Initialize UI logger on mount
  React.useEffect(() => {
    uiLogger.initUILog();
    return () => {
      uiLogger.logSessionEnd();
    };
  }, []);

  // Check for existing project on mount (video mode only)
  React.useEffect(() => {
    if (taskType === 'video' && !started) {
      if (projectExists()) {
        const project = loadProject();
        setExistingProject(project);
        setStartupMode('select_action');
      } else {
        // No existing project - go to style selection first
        setStartupMode('select_style');
      }
    }
  }, [taskType, started]);

  // Create tool registry based on task type
  const tools = React.useMemo(() => {
    if (taskType === 'video') {
      // Use workflow tool registry for state-based video creation
      return createWorkflowToolRegistry().getAll();
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

  // Create agent factory for video mode (uses VideoAgent with transcript/highlights support)
  const agentFactory = React.useMemo(() => {
    if (taskType === 'video') {
      return (tools: Map<string, ToolDefinition>, llm: LLMClient, config?: AgentConfig): GenericAgent => {
        return new VideoAgent(tools, llm, {
          ...config,
          enableTranscriptExtraction: true,
          enableHighlightsExtraction: true,
        });
      };
    }
    return undefined; // Use default GenericAgent
  }, [taskType]);

  // Event handler for UI logging
  const handleAgentEvent = React.useCallback((event: import('./events/index.js').AgentEvent) => {
    switch (event.type) {
      case 'agent_status':
        uiLogger.logStatusChange(event.status, event.agentName);
        break;
      case 'agent_text':
        if (event.text) {
          uiLogger.logAgentText(event.text);
        }
        break;
      case 'streaming_text':
        if (event.done && event.chunk !== undefined) {
          // Log completed streaming text - but we'll handle this via state change instead
        }
        break;
      case 'tool_call':
        uiLogger.logToolStart(event.toolName, event.arguments);
        break;
      case 'tool_result':
        uiLogger.logToolComplete(event.toolName, event.result, undefined, event.isError);
        break;
      case 'question':
        uiLogger.logQuestion(event.question, event.options, event.isConfirmation, event.autoApproveTimeoutMs);
        break;
      case 'todo_update':
        uiLogger.logTodoUpdate(event.todos.map(t => ({ content: t.content, status: t.status })));
        break;
    }
  }, []);

  const {
    status,
    todos,
    output,
    streamingText,
    isStreaming,
    question,
    isConfirmation,
    questionOptions,
    autoApproveTimeoutMs,
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
    onEvent: handleAgentEvent,
    agentFactory, // Use VideoAgent for video mode
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
      uiLogger.logUserInput(initialTask);
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

      // For video mode with a new project, create the project with the selected style
      // Input type will be determined by the agent based on the content
      if (taskType === 'video' && !existingProject) {
        createProject(task, selectedStyle);
        uiLogger.logUserInput(`Starting new project with style: ${STYLE_CONFIGS[selectedStyle].displayName}`);
      }

      setStarted(true);
      uiLogger.logUserInput(task);
      // Task is added to history by useAgent
      void run(task);
    },
    [run, exit, taskType, existingProject, selectedStyle]
  );

  // Handle user response (when agent is waiting for input)
  const handleUserInput = React.useCallback(
    (input: string) => {
      // Always allow exit
      if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
        exit();
        return;
      }

      // Check if user selected "Provide feedback" option - switch to text mode
      if (input.toLowerCase() === 'provide feedback') {
        setAwaitingFeedbackText(true);
        return;
      }

      uiLogger.logUserInput(input);
      // User response is added to history by useAgent
      void respond(input);
    },
    [respond, exit]
  );

  // Handle feedback text submission (after user selected "Provide feedback")
  const handleFeedbackSubmit = React.useCallback(
    (feedbackText: string) => {
      // Always allow exit
      if (feedbackText.toLowerCase() === 'exit' || feedbackText.toLowerCase() === 'quit') {
        exit();
        return;
      }

      // Clear feedback mode and send the feedback
      setAwaitingFeedbackText(false);
      uiLogger.logUserInput(feedbackText);
      // Send the actual feedback text to the agent
      void respond(feedbackText);
    },
    [respond, exit]
  );

  // Handle auto-approve timeout
  const handleAutoApproveTimeout = React.useCallback(() => {
    // Auto-approve by responding with "yes" or the first option
    let selectedOption = 'yes';
    if (isConfirmation) {
      selectedOption = 'yes';
    } else if (questionOptions && questionOptions.length > 0) {
      selectedOption = questionOptions[0]?.label ?? 'yes';
    }
    uiLogger.logAutoApprove(selectedOption);
    void respond(selectedOption);
  }, [respond, isConfirmation, questionOptions]);

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

  // Reset selection and feedback mode when options change - MUST be before any conditional returns
  React.useEffect(() => {
    setSelectedOptionIndex(0);
    setAwaitingFeedbackText(false);
  }, [questionOptions]);

  // Track previous streaming state to log when streaming completes
  const prevIsStreamingRef = React.useRef(false);
  React.useEffect(() => {
    // Log streaming text when it completes (was streaming, now not)
    if (prevIsStreamingRef.current && !isStreaming && streamingText) {
      uiLogger.logStreamingComplete(streamingText);
    }
    prevIsStreamingRef.current = isStreaming;
  }, [isStreaming, streamingText]);

  // Log errors when they occur
  React.useEffect(() => {
    if (error) {
      uiLogger.logError(error);
    }
  }, [error]);

  // Determine input mode and handler based on status
  const inputConfig = React.useMemo((): { mode: InputMode; handler: (value: string) => void; hint?: string } => {
    // If awaiting feedback text, always use text mode
    if (awaitingFeedbackText) {
      return {
        mode: 'text',
        handler: handleFeedbackSubmit,
        hint: 'Enter your feedback and press Enter',
      };
    }

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
  }, [status, questionOptions, isConfirmation, awaitingFeedbackText, handleInjectedInput, handleUserInput, handleFeedbackSubmit, handleNewTask]);

  // Handle startup action selection for video mode
  const handleStartupSelect = React.useCallback((index: number) => {
    if (startupMode === 'select_action') {
      if (index === 0) {
        // Continue existing project
        setStarted(true);
        uiLogger.logUserInput('Continue existing project');
        void run('Continue working on the existing project. Call read_project to see current state.');
      } else if (index === 1) {
        // Start new project - show warning and switch to style selection
        if (existingProject) {
          deleteProject();
          setExistingProject(null);
        }
        setStartupMode('select_style');
      }
    }
  }, [startupMode, existingProject, run]);

  // Handle style selection
  const handleStyleSelect = React.useCallback((index: number) => {
    const styles: ProjectStyle[] = ['cinematic_realism', 'anime'];
    if (index === 2) {
      // YouTube transcript option
      setStartupMode('youtube_url');
    } else {
      const style = styles[index] ?? 'cinematic_realism';
      setSelectedStyle(style);
      setStartupMode('new_story');
    }
  }, []);

  // Handle keyboard for startup selection
  useInput((input, key) => {
    if (!started && taskType === 'video' && startupMode === 'select_action') {
      if (key.upArrow) {
        setStartupSelectedIndex(prev => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setStartupSelectedIndex(prev => Math.min(1, prev + 1));
      } else if (key.return) {
        handleStartupSelect(startupSelectedIndex);
      } else if (input === '1') {
        handleStartupSelect(0);
      } else if (input === '2') {
        handleStartupSelect(1);
      }
    }
  }, { isActive: !started && taskType === 'video' && startupMode === 'select_action' });

  // Handle keyboard for style selection
  useInput((input, key) => {
    if (!started && taskType === 'video' && startupMode === 'select_style') {
      if (key.upArrow) {
        setStyleSelectedIndex(prev => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setStyleSelectedIndex(prev => Math.min(2, prev + 1));
      } else if (key.return) {
        handleStyleSelect(styleSelectedIndex);
      } else if (input === '1') {
        handleStyleSelect(0);
      } else if (input === '2') {
        handleStyleSelect(1);
      } else if (input === '3') {
        handleStyleSelect(2);
      }
    }
  }, { isActive: !started && taskType === 'video' && startupMode === 'select_style' });

  // Show welcome screen if not started
  if (!started) {
    const subtitle = taskType === 'video'
      ? 'Agentic Video Generation System'
      : 'Generic CLI Agent Framework';

    if (taskType === 'video') {
      // Still checking for project
      if (startupMode === 'checking') {
        return (
          <Box flexDirection="column" padding={1}>
            <Banner subtitle={subtitle} />
            <Box paddingX={2}>
              <Text dimColor>Checking for existing project...</Text>
            </Box>
          </Box>
        );
      }

      // Existing project found - show selection
      if (startupMode === 'select_action' && existingProject) {
        return (
          <Box flexDirection="column" padding={1}>
            <Banner subtitle={subtitle} />

            <Box flexDirection="column" marginBottom={1} paddingX={2}>
              <Text bold color="cyan">Existing Project Found!</Text>
              <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} paddingY={1}>
                <Text bold color="yellow">📁 {existingProject.title || 'Untitled Project'}</Text>
                <Text dimColor>ID: {existingProject.id}</Text>
                <Text dimColor>Phase: {existingProject.currentPhase}</Text>
                <Text dimColor>Characters: {existingProject.characters.length}</Text>
                <Text dimColor>Scenes: {existingProject.scenes.length}</Text>
              </Box>
            </Box>

            <Box flexDirection="column" marginBottom={1} paddingX={2}>
              <Text bold>What would you like to do?</Text>
              <Box marginTop={1} flexDirection="column">
                <Text color={startupSelectedIndex === 0 ? 'cyan' : undefined}>
                  {startupSelectedIndex === 0 ? '>' : ' '} 1. Continue existing project
                </Text>
                <Text color={startupSelectedIndex === 1 ? 'red' : undefined}>
                  {startupSelectedIndex === 1 ? '>' : ' '} 2. Start new project
                  <Text dimColor> (will delete current project)</Text>
                </Text>
              </Box>
            </Box>

            <Box paddingX={2}>
              <Text dimColor>Use ↑↓ or 1-2 to select, Enter to confirm. Type "exit" to quit.</Text>
            </Box>
          </Box>
        );
      }

      // Style selection mode
      if (startupMode === 'select_style') {
        const styles: ProjectStyle[] = ['cinematic_realism', 'anime'];
        const menuOptions = [
          ...styles.map(style => ({
            type: 'style' as const,
            style,
            ...STYLE_CONFIGS[style],
          })),
          {
            type: 'youtube' as const,
            displayName: 'Load YouTube Transcript',
            description: 'Extract transcript from a YouTube video to use as source content',
          },
        ];

        return (
          <Box flexDirection="column" padding={1}>
            <Banner subtitle={subtitle} />

            <Box flexDirection="column" marginBottom={1} paddingX={2}>
              <Text bold color="cyan">Choose Your Starting Point</Text>
              <Text dimColor>
                Select a visual style for a new project, or load content from YouTube.
              </Text>
            </Box>

            <Box flexDirection="column" marginBottom={1} paddingX={2}>
              {menuOptions.map((option, index) => {
                const isSelected = styleSelectedIndex === index;
                return (
                  <Box key={option.displayName} flexDirection="column" marginBottom={1}>
                    <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                      {isSelected ? '>' : ' '} {index + 1}. {option.displayName}
                    </Text>
                    <Text dimColor>     {option.description}</Text>
                  </Box>
                );
              })}
            </Box>

            <Box paddingX={2}>
              <Text dimColor>Use ↑↓ or 1-3 to select, Enter to confirm. Type "exit" to quit.</Text>
            </Box>
          </Box>
        );
      }

      // YouTube URL input mode
      if (startupMode === 'youtube_url') {
        return (
          <Box flexDirection="column">
            <Box flexDirection="column" padding={1}>
              <Banner subtitle={subtitle} />

              <Box flexDirection="column" marginBottom={1} paddingX={2}>
                <Text bold color="cyan">Load YouTube Transcript</Text>
                <Text dimColor>
                  Enter a YouTube URL to extract its transcript for video generation.
                </Text>
              </Box>

              <Box marginBottom={1} paddingX={2}>
                <Text bold color="yellow">Example:</Text>
              </Box>
              <Box flexDirection="column" paddingX={4} marginBottom={1}>
                <Text dimColor>https://www.youtube.com/watch?v=VIDEO_ID</Text>
                <Text dimColor>https://youtu.be/VIDEO_ID</Text>
              </Box>
            </Box>

            <Box paddingX={1} paddingY={1} borderStyle="round" borderColor="cyan">
              <UnifiedInput
                mode="text"
                onSubmit={(url) => {
                  setStarted(true);
                  uiLogger.logUserInput(`Loading YouTube transcript: ${url}`);
                  void run(`Extract the transcript from this YouTube video and use it to create a video project: ${url}`);
                }}
                prompt=">"
                hint={'Paste YouTube URL and press Enter. Type "exit" to quit.'}
              />
            </Box>
          </Box>
        );
      }

      // New story mode - show text input with same style as main agent view
      const styleConfig = STYLE_CONFIGS[selectedStyle];
      return (
        <Box flexDirection="column">
          <Box flexDirection="column" padding={1}>
            <Banner subtitle={subtitle} />

            <Box flexDirection="column" marginBottom={1} paddingX={2}>
              <Text bold color="cyan">Welcome to Kshana!</Text>
              <Text dimColor>
                Enter a story idea or paste a complete story/chapter.
              </Text>
              <Text dimColor>
                The system will automatically detect what you've provided.
              </Text>
            </Box>

            <Box marginBottom={1} paddingX={2} flexDirection="column">
              <Text bold color="magenta">Style: {styleConfig.displayName}</Text>
            </Box>

            <Box marginBottom={1} paddingX={2}>
              <Text bold color="yellow">Example prompts:</Text>
            </Box>
            <Box flexDirection="column" paddingX={4} marginBottom={1}>
              <Text dimColor>"A story about a robot learning to dance"</Text>
              <Text dimColor>"Create a video about a magical forest adventure"</Text>
              <Text dimColor>"An epic tale of a knight and a dragon"</Text>
            </Box>
          </Box>

          {/* Input at bottom with same style as main agent view */}
          <Box paddingX={1} paddingY={1} borderStyle="round" borderColor="cyan">
            <UnifiedInput
              mode="text"
              onSubmit={handleTaskSubmit}
              prompt=">"
              hint={'Enter your story idea and press Enter. Type "exit" to quit.'}
            />
          </Box>
        </Box>
      );
    }

    // Generic mode welcome - same input style as main agent view
    return (
      <Box flexDirection="column">
        <Box flexDirection="column" padding={1}>
          <Banner subtitle={subtitle} />
        </Box>

        {/* Input at bottom with same style as main agent view */}
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

  // Main agent view
  return (
    <Box flexDirection="column">
      {/* Main content area */}
      <AgentView
        agentName={agentName}
        status={status}
        statusMessage={error}
        todos={todos}
        streamingText={streamingText}
        isStreaming={isStreaming}
        recentTools={recentTools}
        question={awaitingFeedbackText ? 'Please enter your feedback:' : question}
        isConfirmation={isConfirmation}
        questionOptions={awaitingFeedbackText ? undefined : questionOptions}
        selectedOptionIndex={selectedOptionIndex}
        autoApproveTimeoutMs={awaitingFeedbackText ? undefined : autoApproveTimeoutMs}
        onAutoApproveTimeout={handleAutoApproveTimeout}
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
          options={awaitingFeedbackText ? undefined : questionOptions}
          prompt={status === 'waiting' || awaitingFeedbackText ? '?' : '>'}
          hint={inputConfig.hint}
          onSelectionChange={setSelectedOptionIndex}
        />
      </Box>
    </Box>
  );
}
