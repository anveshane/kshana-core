# MCP server for kshana-ink

## Goal

Expose kshana-ink's pipeline operations as Model Context Protocol (MCP)
tools so any MCP-compatible agent (Claude Code, Cursor, Open Claw,
future agents) can drive kshana-ink natively without writing bespoke
HTTP / CLI integration code.

Today, external agent integration requires picking one of:

- **CLI shell-out** (`pnpm run-to <project> [stage]`, etc.) — low
  friction but needs the repo + pnpm + tsx.
- **HTTP REST** (`POST /projects/:name/run-to`, etc. via
  `agentRoutes.ts`) — works across processes but requires a server
  running and bespoke client code per agent.
- **Library import** (`import { resetProjectStage } from 'kshana-ink'`)
  — typed and fast but couples the agent to Node + kshana-ink's
  runtime.

MCP would be a fourth interface: **standardized, agent-protocol
native**. Once the major agent surfaces (Claude Code, Cursor) all speak
MCP, no kshana-specific glue code is needed in the agent — drop in
the MCP server config and tools appear.

## Scope

Wrap the same operations the pi-agent already exposes, but as MCP
tools instead of pi-agent tools. The implementation work is small
*because* the pi-agent ports already moved everything in-process —
we'd just be adapting the same `runExecutor` / `resetProjectStage` /
`createProjectInProcess` calls into the MCP tool shape.

Tools to expose (mirror of `kshanaTools` in `src/agent/pi/tools/index.ts`):

- `kshana_run_to` — `runExecutor` wrapper
- `kshana_regen` — invalidate + run wrapper
- `kshana_status` — read-only snapshot
- `kshana_list_items` — read-only graph filter
- `kshana_list_projects` — read-only project list
- `kshana_new` — `createProjectInProcess`
- `kshana_reset` — `resetProjectStage`
- `kshana_read_artifact` — read file inside project
- `kshana_show_first_frame` / `_last_frame` / `_shot_video` /
  `_final_video` / `_shot` — manifest-driven media surfacing
- `kshana_focus_project` — host-callback (probably skipped for MCP
  since "focus" is a chat-UI concept; MCP clients have their own
  notion of context)

Resources to expose (read-only, addressable):

- `kshana://projects` — list of projects
- `kshana://projects/<name>/project.json` — project manifest
- `kshana://projects/<name>/scenes/<id>` — scene markdown
- `kshana://projects/<name>/status` — computed status

Streaming (the harder bit):

- `runTo` and `regen` are long-running and emit
  `tool_call`/`tool_result`/`media_generated`/`notification`
  events. MCP supports streaming via tool result content streams,
  but the exact pattern for "stream events while a tool runs" needs
  research. May need to fall back to "tool returns when complete,
  events go to MCP notifications channel" depending on what the
  protocol supports.

## Open questions

- **Transport.** stdio (subprocess MCP server, agents spawn it) vs
  HTTP/SSE MCP. Stdio is the default for local-first; HTTP is needed
  for hosted kshana-core. Probably both, with stdio first since
  kshana-desktop is local-first.
- **Authentication.** None for stdio. For HTTP transport, reuse the
  ApiKeyAuth from `src/server/auth.ts`.
- **Project addressing.** MCP clients don't have a notion of "active
  project" by default. Either (a) every tool takes `project` as a
  required arg (matches today's pi-agent shape — simple), or (b)
  expose a `kshana_set_active_project` tool that scopes subsequent
  calls (closer to the focusProject pattern but more state).
- **Where it lives.** New entry: `src/server/mcp/` with an
  executable wrapper at `bin/kshana-mcp` (or a `pnpm mcp` script).

## Non-scope

- Replacing the existing CLI / HTTP / library interfaces. Those stay.
  MCP is additive.
- Re-implementing the actual pipeline logic. The runners are already
  in-process; MCP is a thin protocol adapter.

## Estimated effort

~4-6h to scaffold:
- Pick the MCP TypeScript SDK.
- Wire up the tool list with schemas (typebox or zod).
- Adapt the `runExecutor` event stream to MCP's notification mechanism.
- Add `bin/kshana-mcp` entry + package.json wiring + a smoke test.
- Write a short integration guide (MCP server config snippets for
  Claude Code, Cursor).

## Cross-references

- `docs/pi-agent-bridge-coverage.md` — current pi-agent tool list
  (the source of truth for what operations exist).
- `src/agent/pi/tools/index.ts` — the already-built tool registry.
  An MCP server would build a parallel registry over the same
  underlying functions.
- `docs/agent-interfaces.md` (if/when written) — the doc that lists
  CLI + HTTP + library + MCP as the four surfaces.
