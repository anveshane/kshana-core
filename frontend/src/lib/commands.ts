/**
 * Command router — parses /commands from the task input
 * and routes them to the right action.
 *
 * Commands are client-side shortcuts, not sent to the server as tasks.
 * Regular text (no / prefix) is sent as a task via WebSocket.
 */

export interface CommandContext {
  dispatch: React.Dispatch<any>
  send: (msg: Record<string, unknown>) => void
  setShowWorkflows: (v: boolean) => void
  setShowProviders: (v: boolean) => void
  setShowNewProject: (v: boolean) => void
}

interface CommandDef {
  description: string
  usage: string
  handler: (args: string, ctx: CommandContext) => void
}

const COMMANDS: Record<string, CommandDef> = {
  help: {
    description: 'Show available commands',
    usage: '/help',
    handler: (_args, ctx) => {
      const lines = Object.entries(COMMANDS)
        .map(([name, cmd]) => `**/${name}** — ${cmd.description}\n  Usage: \`${cmd.usage}\``)
        .join('\n\n')
      ctx.dispatch({
        type: 'ADD_CHAT_MESSAGE',
        message: {
          id: `cmd_${Date.now()}`,
          type: 'system',
          content: `## Available Commands\n\n${lines}`,
          timestamp: Date.now(),
        },
      })
    },
  },

  new: {
    description: 'Create a new project',
    usage: '/new',
    handler: (_args, ctx) => {
      ctx.setShowNewProject(true)
    },
  },

  workflows: {
    description: 'Open workflow manager',
    usage: '/workflows',
    handler: (_args, ctx) => {
      ctx.setShowWorkflows(true)
    },
  },

  providers: {
    description: 'Open provider settings',
    usage: '/providers',
    handler: (_args, ctx) => {
      ctx.setShowProviders(true)
    },
  },

  reset: {
    description: 'Reset a project to a specific stage',
    usage: '/reset <project> <stage>',
    handler: (args, ctx) => {
      const parts = args.trim().split(/\s+/)
      if (parts.length < 2 || !parts[0] || !parts[1]) {
        ctx.dispatch({
          type: 'ADD_CHAT_MESSAGE',
          message: {
            id: `cmd_${Date.now()}`,
            type: 'system',
            content: 'Usage: `/reset <project> <stage>`\n\nStages: plot, story, characters, world_style, character_image, scene_video_prompt, shot_image_prompt, shot_motion_directive, shot_image, shot_video, final_video',
            timestamp: Date.now(),
          },
        })
        return
      }
      ctx.dispatch({
        type: 'ADD_CHAT_MESSAGE',
        message: {
          id: `cmd_${Date.now()}`,
          type: 'system',
          content: `Resetting **${parts[0]}** to stage **${parts[1]}**...`,
          timestamp: Date.now(),
        },
      })
      // Send as a task — the server's executor can handle reset
      ctx.send({ type: 'start_task', data: { task: `/reset ${args}` } })
    },
  },

  select: {
    description: 'Select a project',
    usage: '/select [project-name]',
    handler: (args, ctx) => {
      const name = args.trim()
      if (!name) {
        // No name given — show a hint to use the dropdown
        ctx.dispatch({
          type: 'ADD_CHAT_MESSAGE',
          message: {
            id: `cmd_${Date.now()}`,
            type: 'system',
            content: 'Use the project dropdown in the header to select a project, or type `/select <project-name>` with the exact directory name.',
            timestamp: Date.now(),
          },
        })
        return
      }
      ctx.dispatch({ type: 'SELECT_PROJECT', name })
      ctx.send({ type: 'select_project', data: { projectDir: name } })
      ctx.dispatch({
        type: 'ADD_CHAT_MESSAGE',
        message: {
          id: `cmd_${Date.now()}`,
          type: 'system',
          content: `Selected project: **${name}**`,
          timestamp: Date.now(),
        },
      })
    },
  },

  auto: {
    description: 'Toggle autonomous mode',
    usage: '/auto',
    handler: (_args, ctx) => {
      ctx.send({ type: 'set_autonomous', data: { enabled: true } })
      ctx.dispatch({ type: 'SET_AUTONOMOUS', enabled: true })
      ctx.dispatch({
        type: 'ADD_CHAT_MESSAGE',
        message: {
          id: `cmd_${Date.now()}`,
          type: 'system',
          content: 'Autonomous mode **enabled** — will run without confirmations.',
          timestamp: Date.now(),
        },
      })
    },
  },

  parallel: {
    description: 'Toggle parallel media generation',
    usage: '/parallel',
    handler: (_args, ctx) => {
      ctx.send({ type: 'set_parallel_media', data: { enabled: true } })
      ctx.dispatch({ type: 'SET_PARALLEL_MEDIA', enabled: true })
      ctx.dispatch({
        type: 'ADD_CHAT_MESSAGE',
        message: {
          id: `cmd_${Date.now()}`,
          type: 'system',
          content: 'Parallel media generation **enabled** — for remote ComfyUI servers.',
          timestamp: Date.now(),
        },
      })
    },
  },

  serial: {
    description: 'Switch to serial media generation',
    usage: '/serial',
    handler: (_args, ctx) => {
      ctx.send({ type: 'set_parallel_media', data: { enabled: false } })
      ctx.dispatch({ type: 'SET_PARALLEL_MEDIA', enabled: false })
      ctx.dispatch({
        type: 'ADD_CHAT_MESSAGE',
        message: {
          id: `cmd_${Date.now()}`,
          type: 'system',
          content: 'Serial media generation **enabled** — for local ComfyUI.',
          timestamp: Date.now(),
        },
      })
    },
  },
}

/**
 * Try to parse and execute a command from the input text.
 * Returns true if it was a command (handled), false if regular text.
 */
export function tryExecuteCommand(input: string, ctx: CommandContext): boolean {
  if (!input.startsWith('/')) return false

  const match = input.match(/^\/(\w+)\s*(.*)$/)
  if (!match) return false

  const [, name, args] = match
  const cmd = COMMANDS[name!]

  if (!cmd) {
    ctx.dispatch({
      type: 'ADD_CHAT_MESSAGE',
      message: {
        id: `cmd_${Date.now()}`,
        type: 'system',
        content: `Unknown command: \`/${name}\`. Type \`/help\` for available commands.`,
        timestamp: Date.now(),
      },
    })
    return true
  }

  cmd.handler(args || '', ctx)
  return true
}
