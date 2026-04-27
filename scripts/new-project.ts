#!/usr/bin/env tsx
/**
 * Create a new kshana-ink project from a text input file.
 *
 * Usage:
 *   pnpm new <project-name> --input <file> [--style <style>] [--duration <sec>] [--template <id>]
 *
 * Examples:
 *   pnpm new my_story --input story.md
 *   pnpm new heist_60s --input idea.md --style cinematic_realism --duration 60
 *
 * Creates `<project-name>.kshana/` next to the cwd, copies the input file
 * to `original_input.md`, and writes a `project.json` with the right
 * inputType detected from the content (story vs idea). After this you can
 * run `pnpm run-to <project-name> [stage]` to drive the pipeline forward.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { join, basename, resolve } from 'path';
import { setActiveProjectDir } from '../src/tasks/video/workflow/activeProject.js';
import { createProject } from '../src/tasks/video/workflow/ProjectManager.js';

interface Args {
  projectName: string;
  inputFile: string;
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

  if (!inputFile) {
    console.error('Error: --input <file> is required');
    printUsageAndExit();
  }
  return { projectName, inputFile: inputFile!, style, duration, templateId };
}

function printUsageAndExit(code: number = 1): never {
  console.error('Usage: pnpm new <project-name> --input <file> [--style <style>] [--duration <sec>] [--template <id>]');
  console.error('');
  console.error('  <project-name>       folder name (without .kshana suffix)');
  console.error('  --input, -i <file>   text file with the story idea or full screenplay');
  console.error('  --style, -s <style>  cinematic_realism | anime | noir | ... (default: cinematic_realism)');
  console.error('  --duration, -d <sec> target video duration in seconds (default: 60)');
  console.error('  --template, -t <id>  template id (default: narrative)');
  process.exit(code);
}

async function main() {
  const args = parseArgs();

  const inputPath = resolve(args.inputFile);
  if (!existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
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

  // Create the directory and copy the input file into it (canonical name
  // `original_input.md`). The input file path stored in project.json is
  // relative to the project dir.
  mkdirSync(projectDir, { recursive: true });
  const canonicalInputPath = join(projectDir, 'original_input.md');
  copyFileSync(inputPath, canonicalInputPath);

  const inputContent = readFileSync(canonicalInputPath, 'utf-8');

  console.log(`Creating project: ${projectDirName}`);
  console.log(`  Input file: ${basename(inputPath)} → ${canonicalInputPath}`);
  console.log(`  Style:      ${args.style ?? 'cinematic_realism'}`);
  console.log(`  Duration:   ${args.duration ?? 60}s`);
  console.log(`  Template:   ${args.templateId ?? 'narrative'}`);
  console.log('');

  const project = createProject(
    inputContent,
    args.style ?? 'cinematic_realism',
    basePath,
    args.duration ?? 60,
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
