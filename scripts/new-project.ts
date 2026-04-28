#!/usr/bin/env tsx
/**
 * Create a new kshana-ink project from a text input.
 *
 * Required flags:
 *   --style <s>      `live` (cinematic_realism) or `anime` (animation)
 *   --duration <sec> target video length in seconds
 *
 * Three input modes (pick one):
 *   1. STDIN     pnpm new my_story --style live --duration 60 <<EOF
 *                A woman fled a betrothal...
 *                EOF
 *
 *   2. INLINE    pnpm new my_story --text "A woman fled..." --style anime --duration 60
 *
 *   3. FILE      pnpm new my_story --input story.md --style live --duration 90
 *
 * Optional: --template <id> (default: narrative).
 *
 * Creates `<project-name>.kshana/`, writes the input to
 * `original_input.md`, and writes a `project.json` with the right
 * inputType detected from the content (story vs idea). After this you can
 * run `pnpm run-to <project-name> [stage]` to drive the pipeline forward.
 *
 * Why these are required (not defaulted):
 *   - Style picks photorealistic vs animation, which colors every prompt
 *     downstream. A silent default makes accidental style mismatches easy.
 *   - Duration drives scene-count and shot-count budgets. Without an explicit
 *     value the pipeline silently aims for 60 s, which is wrong for short
 *     clips and very wrong for 3-minute pieces.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { setActiveProjectDir } from '../src/tasks/video/workflow/activeProject.js';
import { createProject } from '../src/tasks/video/workflow/ProjectManager.js';
import { initializeTemplates } from '../src/templates/index.js';

interface Args {
  projectName: string;
  inputFile?: string;
  inputText?: string;
  style?: string;
  duration?: number;
  templateId?: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  if (argv.length < 1 || argv[0]!.startsWith('--')) {
    printUsageAndExit();
  }

  const projectName = argv[0]!;
  let inputFile: string | undefined;
  let inputText: string | undefined;
  let style: string | undefined;
  let duration: number | undefined;
  let templateId: string | undefined;

  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!;
    const next = argv[i + 1];
    switch (a) {
      case '--input':
      case '-i':
        inputFile = next;
        i += 1;
        break;
      case '--text':
        inputText = next;
        i += 1;
        break;
      case '--style':
      case '-s':
        style = next;
        i += 1;
        break;
      case '--duration':
      case '-d':
        duration = next ? parseInt(next, 10) : undefined;
        i += 1;
        break;
      case '--template':
      case '-t':
        templateId = next;
        i += 1;
        break;
      case '--help':
      case '-h':
        printUsageAndExit(0);
      default:
        console.error(`Unknown argument: ${a}`);
        printUsageAndExit();
    }
  }
  return { projectName, inputFile, inputText, style, duration, templateId };
}

/** Read all of stdin as UTF-8. Returns empty string if stdin is a TTY (no pipe). */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function printUsageAndExit(code: number = 1): never {
  console.error('Usage: pnpm new <project-name> --style <style> --duration <sec> [input-source] [options]');
  console.error('');
  console.error('Required:');
  console.error('  --style, -s <style>   live  (= cinematic_realism, photorealistic / live-action)');
  console.error('                        anime (= animation, stylized 2D)');
  console.error('  --duration, -d <sec>  target video duration in seconds (e.g. 30, 60, 120)');
  console.error('');
  console.error('Input source (pick ONE):');
  console.error('  (default)             read from stdin    `echo "..." | pnpm new myproj ...`');
  console.error('  --text "..."          pass inline text');
  console.error('  --input, -i <file>    read from a file');
  console.error('');
  console.error('Optional:');
  console.error('  --template, -t <id>   template id (default: narrative)');
  console.error('');
  console.error('Examples:');
  console.error('  pnpm new noir_60s --style live --duration 60 --text "A noir detective..."');
  console.error('  echo "Story..." | pnpm new my_anime --style anime --duration 30');
  process.exit(code);
}

/**
 * Normalize friendly style aliases to the canonical engine values.
 *  live / live_action / realism / realistic / cinematic / cinematic_realism → cinematic_realism
 *  anime / animation / animated / cartoon → anime
 *
 * Returns null for unknown values; caller prints usage and exits.
 */
export function resolveStyle(input: string): string | null {
  const lower = input.toLowerCase().trim();
  const liveAction = new Set([
    'live', 'live-action', 'live_action', 'liveaction',
    'realism', 'realistic', 'cinematic', 'cinematic_realism',
    'photorealistic', 'real',
  ]);
  const animation = new Set([
    'anime', 'animation', 'animated', 'cartoon', '2d', 'illustrated',
  ]);
  if (liveAction.has(lower)) return 'cinematic_realism';
  if (animation.has(lower)) return 'anime';
  return null;
}

async function main() {
  const args = parseArgs();

  // Populate the TemplateRegistry before createProject runs — without this
  // the registry is empty, `TemplateRegistry.get('narrative')` returns
  // undefined, the inputType classifier in ProjectManager.createProject
  // never runs, and every project created via `pnpm new` silently
  // defaults to inputType: 'idea' (which makes the LLM regenerate plot
  // and story instead of using the source content as the script).
  initializeTemplates();

  // Required: style + duration. No silent defaults.
  if (!args.style) {
    console.error('Error: --style is required. Pick one of: live, anime');
    console.error('  live  → cinematic_realism (photorealistic, live-action look)');
    console.error('  anime → animation (stylized 2D)');
    printUsageAndExit();
  }
  if (args.duration === undefined) {
    console.error('Error: --duration is required (target video length in seconds, e.g. 60).');
    printUsageAndExit();
  }
  if (!Number.isFinite(args.duration!) || args.duration! <= 0) {
    console.error(`Error: --duration must be a positive number (got: ${args.duration}).`);
    printUsageAndExit();
  }
  const canonicalStyle = resolveStyle(args.style!);
  if (!canonicalStyle) {
    console.error(`Error: unknown style "${args.style}". Pick one of: live, anime`);
    printUsageAndExit();
  }

  // Resolve input content from one of: --input file, --text inline, or stdin.
  // Exactly one must be set (or stdin must be piped).
  let inputContent: string;
  let inputSource: string;
  if (args.inputFile && args.inputText !== undefined) {
    console.error('Error: pass only one of --input or --text, not both.');
    printUsageAndExit();
  }
  if (args.inputFile) {
    const inputPath = resolve(args.inputFile);
    if (!existsSync(inputPath)) {
      console.error(`Input file not found: ${inputPath}`);
      process.exit(1);
    }
    inputContent = readFileSync(inputPath, 'utf-8');
    inputSource = inputPath;
  } else if (args.inputText !== undefined) {
    inputContent = args.inputText;
    inputSource = '(--text inline)';
  } else {
    inputContent = await readStdin();
    if (!inputContent.trim()) {
      console.error('Error: no input provided. Pipe content via stdin, or use --text or --input.');
      console.error('Examples:');
      console.error('  echo "A woman fled..." | pnpm new myproj');
      console.error('  pnpm new myproj --text "A woman fled..."');
      console.error('  pnpm new myproj --input story.md');
      process.exit(1);
    }
    inputSource = '(stdin)';
  }

  const projectDirName = `${args.projectName}.kshana`;
  const basePath = process.cwd();
  const projectDir = join(basePath, projectDirName);

  if (existsSync(projectDir)) {
    console.error(`Project directory already exists: ${projectDir}`);
    console.error('Pick a different name, or remove the existing directory first.');
    process.exit(1);
  }

  // Set the active project dir BEFORE calling createProject so it doesn't
  // infer a name from the input content. createProject reads getActiveProjectDir()
  // first; we need it to point at our chosen path.
  setActiveProjectDir(projectDir);

  // Create the directory and write the input to its canonical path.
  mkdirSync(projectDir, { recursive: true });
  const canonicalInputPath = join(projectDir, 'original_input.md');
  writeFileSync(canonicalInputPath, inputContent);

  console.log(`Creating project: ${projectDirName}`);
  console.log(`  Source:     ${inputSource} (${inputContent.length} bytes)`);
  console.log(`  Style:      ${canonicalStyle} (from --style ${args.style})`);
  console.log(`  Duration:   ${args.duration}s`);
  console.log(`  Template:   ${args.templateId ?? 'narrative'}`);
  console.log('');

  const project = createProject(
    inputContent,
    canonicalStyle!,
    basePath,
    args.duration!,
    args.templateId,
  );

  // createProject infers a project dir from content if the active dir
  // wasn't absolute. Make sure project.json lives at the right place —
  // copy if it landed elsewhere.
  const expectedProjectJson = join(projectDir, 'project.json');
  if (!existsSync(expectedProjectJson)) {
    // Fallback: locate the project.json that createProject wrote and move it.
    console.error('Warning: project.json was not written to the expected location. ' +
      'You may need to move it manually.');
  } else {
    // Override the title so it matches the requested project name (createProject
    // generates a title from input content; that's nice for the UI but here
    // the user picked an explicit folder name).
    try {
      const raw = readFileSync(expectedProjectJson, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      parsed['title'] = args.projectName;
      writeFileSync(expectedProjectJson, JSON.stringify(parsed, null, 2));
    } catch {
      // If we can't update title, the project still works.
    }
  }

  console.log('Created.');
  console.log('');
  console.log(`  detected inputType: ${project.inputType}`);
  console.log(`  initial phase:      ${project.currentPhase}`);
  console.log('');
  console.log('Next steps:');
  console.log(`  pnpm run-to ${args.projectName}                # run to final video`);
  console.log(`  pnpm run-to ${args.projectName} scene          # stop after scene prose`);
  console.log(`  pnpm run-to ${args.projectName} scene_video_prompt   # stop after shot planning`);
  console.log(`  pnpm reset ${args.projectName} <stage> [--clean]    # roll back to a stage`);
}

main().catch(err => {
  console.error('Failed to create project:', err);
  process.exit(1);
});
