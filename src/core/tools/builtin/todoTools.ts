/**
 * Todo management tools - handled by GenericAgent directly.
 */
import { createTool } from '../ToolRegistry.js';

// TodoWrite - Claude SDK-style todo tool (handled by GenericAgent)
export const todoWriteTool = createTool(
  'TodoWrite',
  `Use this tool to create and manage a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

## When to Use This Tool
Use this tool proactively in these scenarios:

1. Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
2. Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
3. User explicitly requests todo list - When the user directly asks you to use the todo list
4. User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
5. After receiving new instructions - Immediately capture user requirements as todos
6. When you start working on a task - Mark it as in_progress BEFORE beginning work. Ideally you should only have one todo as in_progress at a time
7. After completing a task - Mark it as completed and add any new follow-up tasks discovered during implementation

## When NOT to Use This Tool

Skip using this tool when:
1. There is only a single, straightforward task
2. The task is trivial and tracking it provides no organizational benefit
3. The task can be completed in less than 3 trivial steps
4. The task is purely conversational or informational

NOTE that you should not use this tool if there is only one trivial task to do. In this case you are better off just doing the task directly.

## Task States and Management

1. Task States:
   - pending: Task not yet started
   - in_progress: Currently working on (limit to ONE task at a time)
   - completed: Task finished successfully
   - cancelled: No longer needed

   IMPORTANT: Task descriptions must have two forms:
   - content: The imperative form describing what needs to be done (e.g., "Run tests", "Build the project")
   - activeForm: The present continuous form shown during execution (e.g., "Running tests", "Building the project")

2. Task Management:
   - ALWAYS call TodoRead first to get current todo IDs before updating with TodoWrite(merge=true)
   - Update task status in real-time as you work
   - Mark tasks complete IMMEDIATELY after finishing: TodoWrite(merge=true, todos=[{id: "the-id", status: "completed"}])
   - Exactly ONE task must be in_progress at any time (not less, not more)
   - Complete current tasks before starting new ones

3. Todo Cleanup (use removed_ids to remove todos at these specific points ONLY):
   - **Session resume**: Remove all completed/cancelled todos from previous sessions
   - **Goal change**: After calling set_goal(), remove all old todos — the previous plan is stale
   - **Assembly complete**: After assemble_from_timeline succeeds, remove completed generation todos

4. Task Completion Requirements:
   - ONLY mark a task as completed when you have FULLY accomplished it
   - If you encounter errors, blockers, or cannot finish, keep the task as in_progress
   - When blocked, create a new task describing what needs to be resolved
   - Never mark a task as completed if:
     - Tests are failing
     - Implementation is partial
     - You encountered unresolved errors
     - You couldn't find necessary files or dependencies

5. Task Breakdown:
   - Create specific, actionable items
   - Break complex tasks into smaller, manageable steps
   - Use clear, descriptive task names
   - Always provide both forms:
     - content: "Fix authentication bug"
     - activeForm: "Fixing authentication bug"

When in doubt, use this tool. Being proactive with task management demonstrates attentiveness and ensures you complete all requirements successfully.`,
  {
    type: 'object',
    properties: {
      merge: {
        type: 'boolean',
        description: 'When true, merge updates into existing todos by id; when false, replace the list.',
      },
      todos: {
        type: 'array',
        description: 'Array of todo items to write',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Unique identifier for the todo item' },
            content: { type: 'string', description: 'Imperative task description (what to do)' },
            activeForm: { type: 'string', description: 'Present continuous form (what you are doing)' },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed', 'cancelled'],
              description: 'Task status',
            },
          },
          required: ['id', 'content', 'status'],
        },
      },
      removed_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'IDs of todos to remove from the list entirely. Use this to clean up completed or irrelevant tasks.',
      },
    },
    required: ['merge'],
  }
  // No handler - handled by GenericAgent
);

// TodoRead - Read current todos with their ids and statuses (handled by GenericAgent)
export const todoReadTool = createTool(
  'TodoRead',
  `Use this tool to read the current todo list. Returns all todos with their ids, statuses, and content.
This is useful to check the current state of your task list before making updates.

Use this tool when:
- You need to see what tasks are pending, in progress, or completed
- After completing a generation (image, video, content) to check which todo to mark as completed
- Before using TodoWrite(merge=true) to update specific todos

The result will include instructions on how to update todos using TodoWrite(merge=true).`,
  {
    type: 'object',
    properties: {},
  }
  // No handler - handled by GenericAgent
);

// Legacy aliases for backwards compatibility
export const setTodosTool = todoWriteTool;
export const updateTodoTool = todoWriteTool;
export const addSubtasksTool = todoWriteTool;
export const expandTodoTool = todoWriteTool;

// Back-compat alias tool name (so older prompts still work during migration)
export const legacyTodoWriteTool = createTool(
  'todo_write',
  todoWriteTool.description,
  todoWriteTool.parameters
  // No handler - handled by GenericAgent
);
