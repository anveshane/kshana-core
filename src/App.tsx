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
  loadProject,
  createProject,
  loadProjectFilesAsContexts,
  createAgentForProject,
  type ProjectStyle,
  // Template system imports
  initializeVideoTemplates,
  getAvailableTemplates,
  getVideoTemplate,
  TEMPLATE_IDS,
  // Multi-project support
  scanProjects,
  setActiveProjectDir,
  type ProjectInfo,
} from './tasks/video/index.js';
import type { StyleConfig as TemplateStyleConfig } from './core/templates/types.js';
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
type StartupMode = 'checking' | 'select_project' | 'select_action' | 'select_template' | 'select_style' | 'select_duration' | 'custom_duration' | 'custom_template' | 'new_story' | 'ready';

// Duration presets per template (in seconds)
const DURATION_PRESETS: Record<string, { label: string; seconds: number }[]> = {
  short: [
    { label: '15 seconds', seconds: 15 },
    { label: '30 seconds', seconds: 30 },
    { label: '45 seconds', seconds: 45 },
    { label: '60 seconds', seconds: 60 },
  ],
  infomercial: [
    { label: '1 minute', seconds: 60 },
    { label: '1.5 minutes', seconds: 90 },
    { label: '2 minutes', seconds: 120 },
    { label: '3 minutes', seconds: 180 },
  ],
  narrative: [
    { label: '1 minute', seconds: 60 },
    { label: '2 minutes', seconds: 120 },
    { label: '3 minutes', seconds: 180 },
    { label: '5 minutes', seconds: 300 },
  ],
  documentary: [
    { label: '2 minutes', seconds: 120 },
    { label: '3 minutes', seconds: 180 },
    { label: '5 minutes', seconds: 300 },
    { label: '10 minutes', seconds: 600 },
  ],
  graphic_novel: [
    { label: '8 panels', seconds: 8 },
    { label: '16 panels', seconds: 16 },
    { label: '24 panels', seconds: 24 },
    { label: '32 panels', seconds: 32 },
  ],
};

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
  // Template selection state
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string>(TEMPLATE_IDS.NARRATIVE);
  const [templateSelectedIndex, setTemplateSelectedIndex] = React.useState(0);
  const [availableTemplates, setAvailableTemplates] = React.useState<{ id: string; displayName: string; description: string }[]>([]);
  const [selectedTemplateStyles, setSelectedTemplateStyles] = React.useState<TemplateStyleConfig[]>([]);
  // Duration selection state
  const [selectedDuration, setSelectedDuration] = React.useState<number>(120);
  const [durationSelectedIndex, setDurationSelectedIndex] = React.useState(0);
  const [durationOptions, setDurationOptions] = React.useState<{ label: string; seconds: number }[]>([]);
  // Multi-project selection state
  const [availableProjects, setAvailableProjects] = React.useState<ProjectInfo[]>([]);
  const [projectSelectedIndex, setProjectSelectedIndex] = React.useState(0);
  // Custom template description (for "Other" option)
  const [customProjectDescription, setCustomProjectDescription] = React.useState('');

  // Initialize UI logger on mount
  React.useEffect(() => {
    uiLogger.initUILog();
    return () => {
      uiLogger.logSessionEnd();
    };
  }, []);

  // Check for existing projects on mount (video mode only)
  React.useEffect(() => {
    if (taskType === 'video' && !started) {
      // Initialize templates first
      initializeVideoTemplates();
      const templates = getAvailableTemplates();
      setAvailableTemplates(templates);

      // Scan for all *.kshana project directories
      const projects = scanProjects();
      setAvailableProjects(projects);

      if (projects.length === 0) {
        // No projects - go to template selection to create new
        setStartupMode('select_template');
      } else if (projects.length === 1) {
        // Single project - set it active and show continue/new
        const proj = projects[0]!;
        setActiveProjectDir(proj.dirName);
        const project = loadProject();
        setExistingProject(project);
        setStartupMode('select_action');
      } else {
        // Multiple projects - show project selection
        setStartupMode('select_project');
      }
    }
  }, [taskType, started]);

  // Load project files into context store when in video mode with existing project
  // This ensures $story, $plot, etc. are available for fetch_context calls
  const contextsLoadedRef = React.useRef(false);
  React.useEffect(() => {
    if (taskType === 'video' && existingProject && !contextsLoadedRef.current) {
      contextsLoadedRef.current = true;
      loadProjectFilesAsContexts();
    }
  }, [taskType, existingProject]);

  // Create tools and prompt via shared factory (same as web UI)
  const { tools, customPrompt, agent: dagAgent } = React.useMemo(() => {
    if (taskType === 'video') {
      const result = createAgentForProject({
        templateId: selectedTemplateId,
        style: selectedStyle,
        duration: selectedDuration,
        llmConfig: llmConfig!,
        customProjectDescription,
      });
      return { tools: result.tools, customPrompt: result.customPrompt, agent: result.agent };
    }
    return {
      tools: createDefaultToolRegistry().getAll(),
      customPrompt: agentConfig?.customPrompt,
      agent: undefined,
    };
  }, [taskType, agentConfig?.customPrompt, selectedTemplateId, selectedStyle, selectedDuration, customProjectDescription, llmConfig]);

  // Compute effective agent name based on task type
  const agentName = agentConfig?.name ?? (taskType === 'video' ? 'kshana-video' : 'kshana-ink');

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
      case 'context_usage':
        uiLogger.logContextUsage(event.percentage, event.promptTokens, event.maxTokens, event.iteration, event.wasCompressed);
        break;
    }
  }, []);

  const {
    status,
    todos,
    output,
    streamingText,
    isStreaming,
    streamingThinkText,
    isThinkStreaming,
    question,
    isConfirmation,
    questionOptions,
    autoApproveTimeoutMs,
    questionContext,
    error,
    recentTools,
    history,
    currentAction,
    contextUsage,
    notification,
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
    agent: dagAgent,
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
      // For video mode, create the project before running (handleTaskSubmit is bypassed)
      if (taskType === 'video' && !existingProject) {
        createProject(initialTask, selectedStyle, undefined, selectedDuration, selectedTemplateId);
      }
      setStarted(true);
      uiLogger.logUserInput(initialTask);
      void run(initialTask);
    }
  }, [initialTask, started, run, taskType, existingProject, selectedStyle, selectedDuration, selectedTemplateId]);

  // Handle task submission
  const handleTaskSubmit = React.useCallback(
    (task: string) => {
      if (task.toLowerCase() === 'exit' || task.toLowerCase() === 'quit') {
        exit();
        return;
      }

      // For video mode with a new project, create the project with the selected template and style
      // Input type will be determined by the agent based on the content
      if (taskType === 'video' && !existingProject) {
        createProject(task, selectedStyle, undefined, selectedDuration, selectedTemplateId);
        const templateName = availableTemplates.find(t => t.id === selectedTemplateId)?.displayName ?? selectedTemplateId;
        const styleName = selectedTemplateStyles.find(s => s.id === selectedStyle)?.displayName ?? selectedStyle;
        uiLogger.logUserInput(`Starting new ${templateName} project with ${styleName} style`);
      }

      setStarted(true);
      uiLogger.logUserInput(task);
      // Task is added to history by useAgent
      void run(task);
    },
    [run, exit, taskType, existingProject, selectedStyle, selectedDuration, selectedTemplateId, availableTemplates, selectedTemplateStyles]
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

  // Handle project selection (multi-project mode)
  const handleProjectSelect = React.useCallback((index: number) => {
    if (index < availableProjects.length) {
      // Selected an existing project - continue it directly
      const proj = availableProjects[index]!;
      setActiveProjectDir(proj.dirName);
      const project = loadProject();
      setExistingProject(project);
      setStarted(true);
      uiLogger.logUserInput('Continue existing project');
      void run('Continue working on the existing project. The project state is already injected - proceed with the next step.');
    } else {
      // "New project" option
      setExistingProject(null);
      setStartupMode('select_template');
    }
  }, [availableProjects, run]);

  // Handle startup action selection for video mode
  const handleStartupSelect = React.useCallback((index: number) => {
    if (startupMode === 'select_action') {
      if (index === 0) {
        // Continue existing project
        setStarted(true);
        uiLogger.logUserInput('Continue existing project');
        void run('Continue working on the existing project. The project state is already injected - proceed with the next step.');
      } else if (index === 1) {
        // Start new project - don't delete existing, just go to template selection
        setExistingProject(null);
        setStartupMode('select_template');
      }
    }
  }, [startupMode, run]);

  // Handle template selection
  const handleTemplateSelect = React.useCallback((index: number) => {
    if (index === availableTemplates.length) {
      // "Other" option selected — go to custom description input
      // Default to narrative template internally
      setSelectedTemplateId(TEMPLATE_IDS.NARRATIVE);
      const fullTemplate = getVideoTemplate(TEMPLATE_IDS.NARRATIVE);
      setSelectedTemplateStyles(fullTemplate.styles);
      setSelectedStyle(fullTemplate.defaultStyle as ProjectStyle);
      const presets = DURATION_PRESETS['narrative'] ?? [];
      setDurationOptions(presets);
      if (presets.length > 0 && presets[0]) {
        setSelectedDuration(presets[0].seconds);
      }
      setStartupMode('custom_template');
      return;
    }
    const template = availableTemplates[index];
    if (template) {
      setSelectedTemplateId(template.id);
      // Load template-specific styles
      const fullTemplate = getVideoTemplate(template.id);
      setSelectedTemplateStyles(fullTemplate.styles);
      // Set default style from template
      if (fullTemplate.styles.length > 0 && fullTemplate.styles[0]) {
        setSelectedStyle(fullTemplate.defaultStyle as ProjectStyle);
      }
      // Compute duration options for this template
      const presets = DURATION_PRESETS[template.id] ?? DURATION_PRESETS['narrative'] ?? [];
      setDurationOptions(presets);
      if (presets.length > 0 && presets[0]) {
        setSelectedDuration(presets[0].seconds);
      }
      setDurationSelectedIndex(0);
      setStyleSelectedIndex(0);
      setStartupMode('select_style');
    }
  }, [availableTemplates]);

  // Handle style selection (now uses template-specific styles)
  const handleStyleSelect = React.useCallback((index: number) => {
    const style = selectedTemplateStyles[index];
    if (style) {
      setSelectedStyle(style.id as ProjectStyle);
      setStartupMode('select_duration');
    }
  }, [selectedTemplateStyles]);

  // Handle duration selection
  const handleDurationSelect = React.useCallback((index: number) => {
    if (index === durationOptions.length) {
      // "Custom" option selected
      setStartupMode('custom_duration');
      return;
    }
    const option = durationOptions[index];
    if (option) {
      setSelectedDuration(option.seconds);
      setStartupMode('new_story');
    }
  }, [durationOptions]);

  // Handle custom duration text input
  const handleCustomDurationSubmit = React.useCallback((input: string) => {
    if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
      exit();
      return;
    }
    const seconds = parseInt(input, 10);
    if (isNaN(seconds) || seconds <= 0) {
      // Invalid input — go back to duration selection
      setStartupMode('select_duration');
      return;
    }
    setSelectedDuration(seconds);
    setStartupMode('new_story');
  }, [exit]);

  // Handle custom template description submission
  const handleCustomTemplateSubmit = React.useCallback((input: string) => {
    if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
      exit();
      return;
    }
    if (!input.trim()) {
      // Empty input — stay on the same screen
      return;
    }
    setCustomProjectDescription(input.trim());
    // Skip style/duration selection — go straight to story input
    setStartupMode('new_story');
  }, [exit]);

  // Handle keyboard for project selection (multi-project mode)
  useInput((input, key) => {
    if (!started && taskType === 'video' && startupMode === 'select_project') {
      const maxIndex = availableProjects.length; // includes "New project" as last option
      if (key.upArrow) {
        setProjectSelectedIndex(prev => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setProjectSelectedIndex(prev => Math.min(maxIndex, prev + 1));
      } else if (key.return) {
        handleProjectSelect(projectSelectedIndex);
      } else if (input >= '1' && input <= String(availableProjects.length + 1)) {
        handleProjectSelect(parseInt(input, 10) - 1);
      }
    }
  }, { isActive: !started && taskType === 'video' && startupMode === 'select_project' });

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

  // Handle keyboard for template selection
  useInput((input, key) => {
    if (!started && taskType === 'video' && startupMode === 'select_template') {
      const maxIndex = availableTemplates.length; // includes "Other" as last option
      if (key.upArrow) {
        setTemplateSelectedIndex(prev => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setTemplateSelectedIndex(prev => Math.min(maxIndex, prev + 1));
      } else if (key.return) {
        handleTemplateSelect(templateSelectedIndex);
      } else if (input >= '1' && input <= String(availableTemplates.length + 1)) {
        handleTemplateSelect(parseInt(input, 10) - 1);
      } else if (key.escape) {
        if (existingProject) {
          setStartupMode('select_action');
        } else if (availableProjects.length > 0) {
          setStartupMode('select_project');
        }
      }
    }
  }, { isActive: !started && taskType === 'video' && startupMode === 'select_template' });

  // Handle keyboard for style selection (template-specific styles)
  useInput((input, key) => {
    if (!started && taskType === 'video' && startupMode === 'select_style') {
      const maxIndex = selectedTemplateStyles.length - 1;
      if (key.upArrow) {
        setStyleSelectedIndex(prev => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setStyleSelectedIndex(prev => Math.min(maxIndex, prev + 1));
      } else if (key.return) {
        handleStyleSelect(styleSelectedIndex);
      } else if (input >= '1' && input <= String(selectedTemplateStyles.length)) {
        handleStyleSelect(parseInt(input, 10) - 1);
      } else if (key.escape) {
        setStyleSelectedIndex(0);
        setStartupMode('select_template');
      }
    }
  }, { isActive: !started && taskType === 'video' && startupMode === 'select_style' });

  // Handle keyboard for duration selection (presets + Custom option)
  useInput((input, key) => {
    if (!started && taskType === 'video' && startupMode === 'select_duration') {
      const maxIndex = durationOptions.length; // includes "Custom" as last option
      if (key.upArrow) {
        setDurationSelectedIndex(prev => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setDurationSelectedIndex(prev => Math.min(maxIndex, prev + 1));
      } else if (key.return) {
        handleDurationSelect(durationSelectedIndex);
      } else if (input >= '1' && input <= String(durationOptions.length + 1)) {
        handleDurationSelect(parseInt(input, 10) - 1);
      } else if (key.escape) {
        setDurationSelectedIndex(0);
        setStartupMode('select_style');
      }
    }
  }, { isActive: !started && taskType === 'video' && startupMode === 'select_duration' });

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

      // Multiple projects found - show project selection
      if (startupMode === 'select_project') {
        const totalOptions = availableProjects.length + 1; // projects + "New project"
        return (
          <Box flexDirection="column" padding={1}>
            <Banner subtitle={subtitle} />

            <Box flexDirection="column" marginBottom={1} paddingX={2}>
              <Text bold color="cyan">Select a Project</Text>
              <Text dimColor>
                Found {availableProjects.length} project{availableProjects.length > 1 ? 's' : ''}. Choose one to continue or start a new project.
              </Text>
            </Box>

            <Box flexDirection="column" marginBottom={1} paddingX={2}>
              {availableProjects.map((proj, index) => {
                const isSelected = projectSelectedIndex === index;
                const updatedDate = new Date(proj.updatedAt).toLocaleDateString();
                return (
                  <Box key={proj.dirName} flexDirection="column" marginBottom={1}>
                    <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                      {isSelected ? '>' : ' '} {index + 1}. {proj.title}
                    </Text>
                    <Text dimColor>     {proj.templateId} | Phase: {proj.currentPhase} | Updated: {updatedDate}</Text>
                  </Box>
                );
              })}
              {/* New project option */}
              {(() => {
                const newIndex = availableProjects.length;
                const isSelected = projectSelectedIndex === newIndex;
                return (
                  <Box flexDirection="column" marginBottom={1}>
                    <Text color={isSelected ? 'green' : undefined} bold={isSelected}>
                      {isSelected ? '>' : ' '} {newIndex + 1}. Start new project
                    </Text>
                  </Box>
                );
              })()}
            </Box>

            <Box paddingX={2}>
              <Text dimColor>Use ↑↓ or 1-{totalOptions} to select, Enter to confirm. Type "exit" to quit.</Text>
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
                <Text color={startupSelectedIndex === 1 ? 'cyan' : undefined}>
                  {startupSelectedIndex === 1 ? '>' : ' '} 2. Start new project
                </Text>
              </Box>
            </Box>

            <Box paddingX={2}>
              <Text dimColor>Use ↑↓ or 1-2 to select, Enter to confirm. Type "exit" to quit.</Text>
            </Box>
          </Box>
        );
      }

      // Template selection mode
      if (startupMode === 'select_template') {
        return (
          <Box flexDirection="column" padding={1}>
            <Banner subtitle={subtitle} />

            <Box flexDirection="column" marginBottom={1} paddingX={2}>
              <Text bold color="cyan">Choose Your Video Type</Text>
              <Text dimColor>
                Select the type of video you want to create. Each type has different workflows and artifacts.
              </Text>
            </Box>

            <Box flexDirection="column" marginBottom={1} paddingX={2}>
              {availableTemplates.map((template, index) => {
                const isSelected = templateSelectedIndex === index;
                return (
                  <Box key={template.id} flexDirection="column" marginBottom={1}>
                    <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                      {isSelected ? '>' : ' '} {index + 1}. {template.displayName}
                    </Text>
                    <Text dimColor>     {template.description}</Text>
                  </Box>
                );
              })}
              {/* "Other" option */}
              {(() => {
                const otherIndex = availableTemplates.length;
                const isSelected = templateSelectedIndex === otherIndex;
                return (
                  <Box flexDirection="column" marginBottom={1}>
                    <Text color={isSelected ? 'green' : undefined} bold={isSelected}>
                      {isSelected ? '>' : ' '} {otherIndex + 1}. Other (describe your own)
                    </Text>
                    <Text dimColor>     Describe what you want to create in your own words.</Text>
                  </Box>
                );
              })()}
            </Box>

            <Box paddingX={2}>
              <Text dimColor>Use ↑↓ or 1-{availableTemplates.length + 1} to select, Enter to confirm.{existingProject || availableProjects.length > 0 ? ' Esc to go back.' : ''} Type "exit" to quit.</Text>
            </Box>
          </Box>
        );
      }

      // Style selection mode (template-specific styles)
      if (startupMode === 'select_style') {
        const templateName = availableTemplates.find(t => t.id === selectedTemplateId)?.displayName ?? 'Video';
        return (
          <Box flexDirection="column" padding={1}>
            <Banner subtitle={subtitle} />

            <Box flexDirection="column" marginBottom={1} paddingX={2}>
              <Text bold color="cyan">Choose Your Visual Style for {templateName}</Text>
              <Text dimColor>
                Select the visual style for your video project. This will determine the aesthetic of all generated images.
              </Text>
            </Box>

            <Box flexDirection="column" marginBottom={1} paddingX={2}>
              {selectedTemplateStyles.map((style, index) => {
                const isSelected = styleSelectedIndex === index;
                return (
                  <Box key={style.id} flexDirection="column" marginBottom={1}>
                    <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                      {isSelected ? '>' : ' '} {index + 1}. {style.displayName}
                    </Text>
                    <Text dimColor>     {style.description}</Text>
                  </Box>
                );
              })}
            </Box>

            <Box paddingX={2}>
              <Text dimColor>Use ↑↓ or 1-{selectedTemplateStyles.length} to select, Enter to confirm, Esc to go back.</Text>
            </Box>
          </Box>
        );
      }

      // Duration selection mode
      if (startupMode === 'select_duration') {
        const templateName = availableTemplates.find(t => t.id === selectedTemplateId)?.displayName ?? 'Video';
        const totalOptions = durationOptions.length + 1; // presets + Custom
        return (
          <Box flexDirection="column" padding={1}>
            <Banner subtitle={subtitle} />

            <Box flexDirection="column" marginBottom={1} paddingX={2}>
              <Text bold color="cyan">Choose Target Duration for {templateName}</Text>
              <Text dimColor>
                Select how long you want your video to be. This guides the planning process.
              </Text>
            </Box>

            <Box flexDirection="column" marginBottom={1} paddingX={2}>
              {durationOptions.map((option, index) => {
                const isSelected = durationSelectedIndex === index;
                return (
                  <Box key={option.seconds} flexDirection="column" marginBottom={1}>
                    <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                      {isSelected ? '>' : ' '} {index + 1}. {option.label}
                    </Text>
                  </Box>
                );
              })}
              {/* Custom option */}
              {(() => {
                const customIndex = durationOptions.length;
                const isSelected = durationSelectedIndex === customIndex;
                return (
                  <Box flexDirection="column" marginBottom={1}>
                    <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                      {isSelected ? '>' : ' '} {customIndex + 1}. Custom (enter seconds)
                    </Text>
                  </Box>
                );
              })()}
            </Box>

            <Box paddingX={2}>
              <Text dimColor>Use ↑↓ or 1-{totalOptions} to select, Enter to confirm, Esc to go back.</Text>
            </Box>
          </Box>
        );
      }

      // Custom duration text input mode
      if (startupMode === 'custom_duration') {
        return (
          <Box flexDirection="column">
            <Box flexDirection="column" padding={1}>
              <Banner subtitle={subtitle} />

              <Box flexDirection="column" marginBottom={1} paddingX={2}>
                <Text bold color="cyan">Enter Custom Duration</Text>
                <Text dimColor>
                  Type the desired duration in seconds and press Enter.
                </Text>
              </Box>
            </Box>

            <Box paddingX={1} paddingY={1} borderStyle="round" borderColor="cyan">
              <UnifiedInput
                mode="text"
                onSubmit={handleCustomDurationSubmit}
                prompt=">"
                hint={'Enter duration in seconds (e.g. 90) and press Enter. Type "exit" to quit.'}
              />
            </Box>
          </Box>
        );
      }

      // Custom template description mode
      if (startupMode === 'custom_template') {
        return (
          <Box flexDirection="column">
            <Box flexDirection="column" padding={1}>
              <Banner subtitle={subtitle} />

              <Box flexDirection="column" marginBottom={1} paddingX={2}>
                <Text bold color="cyan">Describe Your Project</Text>
                <Text dimColor>
                  Describe what you want to create in your own words. The system will use the narrative workflow and adapt to your description.
                </Text>
              </Box>
            </Box>

            <Box paddingX={1} paddingY={1} borderStyle="round" borderColor="cyan">
              <UnifiedInput
                mode="text"
                onSubmit={handleCustomTemplateSubmit}
                prompt=">"
                hint={'Describe what you want to create and press Enter. Type "exit" to quit.'}
              />
            </Box>
          </Box>
        );
      }

      // New story mode - show text input with same style as main agent view
      const templateInfo = availableTemplates.find(t => t.id === selectedTemplateId);
      const styleInfo = selectedTemplateStyles.find(s => s.id === selectedStyle);

      // Template-specific example prompts
      const examplePrompts: Record<string, string[]> = {
        narrative: [
          '"A story about a robot learning to dance"',
          '"Create a video about a magical forest adventure"',
          '"An epic tale of a knight and a dragon"',
        ],
        documentary: [
          '"How does climate change affect coral reefs?"',
          '"The history of artificial intelligence"',
          '"Why do people believe in conspiracy theories?"',
        ],
        short: [
          '"POV: You discover time travel is real"',
          '"5 things you didn\'t know about coffee"',
          '"This one trick changed my morning routine"',
        ],
        infomercial: [
          '"A smart water bottle that tracks hydration"',
          '"Ergonomic keyboard with customizable keys"',
          '"Solar-powered phone charger for outdoor use"',
        ],
        graphic_novel: [
          '"A cyberpunk detective story in a neon-lit city"',
          '"A coming-of-age tale set in a magical academy"',
          '"An ancient myth retold with modern characters"',
        ],
      };
      const examples = examplePrompts[selectedTemplateId] ?? examplePrompts['narrative'] ?? [];

      return (
        <Box flexDirection="column">
          <Box flexDirection="column" padding={1}>
            <Banner subtitle={subtitle} />

            <Box flexDirection="column" marginBottom={1} paddingX={2}>
              <Text bold color="cyan">Welcome to Kshana!</Text>
              <Text dimColor>
                {selectedTemplateId === 'narrative' && 'Enter a story idea or paste a complete story/chapter.'}
                {selectedTemplateId === 'documentary' && 'Enter a topic, question, or research outline.'}
                {selectedTemplateId === 'short' && 'Enter a hook, idea, or script for your short video.'}
                {selectedTemplateId === 'infomercial' && 'Enter product information or a marketing brief.'}
                {selectedTemplateId === 'graphic_novel' && 'Enter a story idea or paste a complete story for your graphic novel.'}
              </Text>
              <Text dimColor>
                The system will automatically detect what you've provided.
              </Text>
            </Box>

            <Box marginBottom={1} paddingX={2} flexDirection="column">
              <Text bold color="magenta">Template: {templateInfo?.displayName ?? 'Unknown'}</Text>
              <Text bold color="magenta">Style: {styleInfo?.displayName ?? 'Unknown'}</Text>
              <Text bold color="magenta">Duration: {durationOptions.find(d => d.seconds === selectedDuration)?.label ?? `${selectedDuration}s`}</Text>
            </Box>

            <Box marginBottom={1} paddingX={2}>
              <Text bold color="yellow">Example prompts:</Text>
            </Box>
            <Box flexDirection="column" paddingX={4} marginBottom={1}>
              {examples.map((example, i) => (
                <Text key={i} dimColor>{example}</Text>
              ))}
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
        streamingThinkText={streamingThinkText}
        isThinkStreaming={isThinkStreaming}
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
        contextUsage={contextUsage}
        notification={notification}
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
