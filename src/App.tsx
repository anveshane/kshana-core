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
  buildWorkflowAgentPrompt,
  getCurrentPhase,
  loadProjectFilesAsContexts,
} from './tasks/video/index.js';
import type { LLMClientConfig } from './core/llm/index.js';
import type { AgentConfig } from './core/agent/index.js';
import * as uiLogger from './utils/uiLogger.js';
import { contextStore } from './core/context/ContextStore.js';

type TaskType = 'generic' | 'video';

interface AppProps {
  llmConfig?: LLMClientConfig;
  agentConfig?: AgentConfig;
  initialTask?: string;
  taskType?: TaskType;
}

// Startup mode for video task type
type StartupMode = 'checking' | 'select_action' | 'select_style' | 'new_story' | 'ready';

export function App({ llmConfig, agentConfig, initialTask, taskType = 'generic' }: AppProps) {
  const { exit } = useApp();
  const [started, setStarted] = React.useState(false);
  const [expandedView, setExpandedView] = React.useState(false);
  const [selectedOptionIndex, setSelectedOptionIndex] = React.useState(0);
  // Track when user selected "Provide feedback" and needs to enter actual feedback
  const [awaitingFeedbackText, setAwaitingFeedbackText] = React.useState(false);
  // Track when user pressed any key to pause the countdown timer
  const [timerPaused, setTimerPaused] = React.useState(false);

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
        // Reload context store for the existing project
        if (project) {
          contextStore.reload(project.id);
        }
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
  // For video mode, we build it dynamically based on the current project state
  const customPrompt = React.useMemo(() => {
    if (taskType === 'video') {
      if (existingProject) {
        // Use dynamic workflow prompt if project exists
        const currentPhase = getCurrentPhase(existingProject);
        const loadedContexts = loadProjectFilesAsContexts();
        return buildWorkflowAgentPrompt(existingProject, currentPhase, loadedContexts);
      }
      // Fallback to static prompt only if no project yet (initial creation)
      return VIDEO_CREATION_SYSTEM_PROMPT;
    }
    return agentConfig?.customPrompt;
  }, [taskType, agentConfig?.customPrompt, existingProject]);

  // Compute effective agent name based on task type
  const agentName = agentConfig?.name ?? (taskType === 'video' ? 'kshana-video' : 'kshana-ink');

  // Event handler for UI logger (kept separate to avoid recursion in useAgent)
  const handleAgentEventsForLogger = React.useCallback((event: import('./events/index.js').AgentEvent) => {
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
        // Log handled by state change
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
    questionContext,
    error,
    recentTools,
    history,
    currentAction,
    run,
    respond,
    stop,
    injectInput,
    reset,
    setProjectId,
    updateCustomPrompt,
  } = useAgent({
    tools,
    llmConfig,
    agentConfig: {
      ...agentConfig,
      name: agentName,
      customPrompt,
    },
    onEvent: handleAgentEventsForLogger,
    projectId: existingProject?.id ?? null,
  });

  // Handle phase transitions to update the prompt dynamically
  // Listen to history updates because useAgent adds phase transitions to history
  React.useEffect(() => {
    if (history.length > 0) {
      const lastEntry = history[history.length - 1];
      if (lastEntry && lastEntry.type === 'phase_transition' && taskType === 'video') {
        // Reload project to get fresh state
        const project = loadProject();
        if (project) {
          // Update existingProject state
          setExistingProject(project);

          // Rebuild prompt with new phase
          const currentPhase = getCurrentPhase(project);
          const loadedContexts = loadProjectFilesAsContexts();
          const newPrompt = buildWorkflowAgentPrompt(project, currentPhase, loadedContexts);

          // Update the running agent's prompt
          updateCustomPrompt(newPrompt);
        }
      }
    }
  }, [history, taskType, updateCustomPrompt]);

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
        const newProject = createProject(task, selectedStyle);
        // Set projectId directly to bypass React state update delay
        // This ensures the agent is immediately reset with the new projectId
        setProjectId(newProject.id);
        // Update existingProject state for UI consistency
        setExistingProject(newProject);
        uiLogger.logUserInput(`Starting new project with style: ${STYLE_CONFIGS[selectedStyle].displayName}`);
      }

      setStarted(true);
      uiLogger.logUserInput(task);
      // Task is added to history by useAgent
      // Note: run() will create a new agent with the updated projectId from existingProject
      void run(task);
    },
    [run, exit, taskType, existingProject, selectedStyle, setProjectId]
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

      // Store feedback in context store with context about what was reviewed
      const feedbackWithContext = questionContext
        ? `## Context Being Reviewed\n${questionContext}\n\n## User Feedback\n${feedbackText}`
        : feedbackText;

      contextStore.store(
        feedbackWithContext,
        `User feedback for: ${question?.slice(0, 50) ?? 'content review'}`,
        { source: 'user_input', variableBaseName: 'feedback' }
      );

      // Clear feedback mode and send the feedback
      setAwaitingFeedbackText(false);
      uiLogger.logUserInput(feedbackText);
      // Send the actual feedback text to the agent
      void respond(feedbackText);
    },
    [respond, exit, question, questionContext]
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

  // Pause countdown timer when user presses any key
  const handleAnyKeyPress = React.useCallback(() => {
    if (autoApproveTimeoutMs && !timerPaused) {
      setTimerPaused(true);
    }
  }, [autoApproveTimeoutMs, timerPaused]);

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

  // Reset selection, feedback mode, and timer pause when options change - MUST be before any conditional returns
  React.useEffect(() => {
    setSelectedOptionIndex(0);
    setAwaitingFeedbackText(false);
    setTimerPaused(false);
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
        if (existingProject) {
          // Reload context store for the existing project
          contextStore.reload(existingProject.id);
        }
        setStarted(true);
        uiLogger.logUserInput('Continue existing project');
        void run('Continue working on the existing project. Call read_project to see current state.');
      } else if (index === 1) {
        // Start new project - show warning and switch to style selection
        if (existingProject) {
          deleteProject();
          setExistingProject(null);
        }
        // Reset agent state and clear projectId to ensure complete isolation
        setProjectId(null);
        setStartupMode('select_style');
      }
    }
  }, [startupMode, existingProject, run, setProjectId]);

  // Handle style selection
  const handleStyleSelect = React.useCallback((index: number) => {
    const styles: ProjectStyle[] = ['cinematic_realism', 'anime'];
    const style = styles[index] ?? 'cinematic_realism';
    setSelectedStyle(style);
    setStartupMode('new_story');
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
        setStyleSelectedIndex(prev => Math.min(1, prev + 1));
      } else if (key.return) {
        handleStyleSelect(styleSelectedIndex);
      } else if (input === '1') {
        handleStyleSelect(0);
      } else if (input === '2') {
        handleStyleSelect(1);
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
        return (
          <Box flexDirection="column" padding={1}>
            <Banner subtitle={subtitle} />

            <Box flexDirection="column" marginBottom={1} paddingX={2}>
              <Text bold color="cyan">Choose Your Visual Style</Text>
              <Text dimColor>
                Select the visual style for your video project. This will determine the aesthetic of all generated images.
              </Text>
            </Box>

            <Box flexDirection="column" marginBottom={1} paddingX={2}>
              {styles.map((style, index) => {
                const config = STYLE_CONFIGS[style];
                const isSelected = styleSelectedIndex === index;
                return (
                  <Box key={style} flexDirection="column" marginBottom={1}>
                    <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                      {isSelected ? '>' : ' '} {index + 1}. {config.displayName}
                    </Text>
                    <Text dimColor>     {config.description}</Text>
                  </Box>
                );
              })}
            </Box>

            <Box paddingX={2}>
              <Text dimColor>Use ↑↓ or 1-2 to select, Enter to confirm. Type "exit" to quit.</Text>
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
        autoApproveTimeoutMs={awaitingFeedbackText || timerPaused ? undefined : autoApproveTimeoutMs}
        onAutoApproveTimeout={handleAutoApproveTimeout}
        questionContext={awaitingFeedbackText ? undefined : questionContext}
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
          onAnyKeyPress={handleAnyKeyPress}
        />
      </Box>
    </Box>
  );
}
