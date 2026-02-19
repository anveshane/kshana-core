- Never truncate any text when displaying it in the CLI
- When creating prompts for agents, create the prompt in a different file and import the prompt
- Always check logs when debugging an issue
- when debugging issues always look in the logs folder to see detailed recent debug logs

## Workspace and Dependencies

- kshana-ink uses a pnpm workspace (`pnpm-workspace.yaml`) that includes `remotion-infographics` as a workspace member
- All Remotion dependencies are pre-installed in `kshana-ink/package.json` (core packages + all feature packages from Remotion skills rules)
- Running `pnpm install` at the kshana-ink root installs all dependencies including Remotion packages via workspace hoisting
- The agent should never need to install packages - all dependencies are pre-installed
- Remotion skills rules reference packages that are already installed: `@remotion/three`, `@remotion/media`, `@remotion/transitions`, `@remotion/captions`, `@remotion/zod-types`, `@remotion/layout-utils`, `@remotion/lottie`, `@remotion/gif`, `@remotion/google-fonts`, `@remotion/fonts`, `mapbox-gl`, `@turf/turf`, etc.