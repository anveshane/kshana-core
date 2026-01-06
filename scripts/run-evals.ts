#!/usr/bin/env npx tsx
/**
 * CLI runner for prompt evaluations
 *
 * Usage:
 *   npx tsx scripts/run-evals.ts                    # Run all evals with mock
 *   npx tsx scripts/run-evals.ts --live             # Run all evals with live LLM
 *   npx tsx scripts/run-evals.ts --fixture <path>   # Run specific fixture
 *   npx tsx scripts/run-evals.ts --tags approve     # Run only cases with 'approve' tag
 *
 * Environment:
 *   For live mode, configure your LLM provider in .env:
 *   - LLM_PROVIDER=lmstudio (requires LM Studio running locally)
 *   - LLM_PROVIDER=openai (requires OPENAI_API_KEY)
 *   - LLM_PROVIDER=gemini (requires GOOGLE_API_KEY)
 */
import 'dotenv/config';
import { parseArgs } from 'node:util';
import { PromptEvaluator, MockEvalLLMClient } from '../src/testing/PromptEvaluator.js';

const { values } = parseArgs({
  options: {
    live: { type: 'boolean', default: false },
    fixture: { type: 'string' },
    tags: { type: 'string', multiple: true },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(`
Prompt Evaluation Runner

Usage:
  npx tsx scripts/run-evals.ts [options]

Options:
  --live              Run against live LLM (default: mock mode)
  --fixture <path>    Run specific fixture file
  --tags <tag>        Filter cases by tag (can be repeated)
  -h, --help          Show this help message

Examples:
  npx tsx scripts/run-evals.ts
  npx tsx scripts/run-evals.ts --live
  npx tsx scripts/run-evals.ts --fixture classification/plan-approval.eval.json
  npx tsx scripts/run-evals.ts --tags approve --tags simple
`);
  process.exit(0);
}

async function main() {
  console.log(`\n🧪 Prompt Evaluation Runner`);
  console.log(`Mode: ${values.live ? '🔴 LIVE (actual LLM calls)' : '🟢 MOCK (deterministic)'}\n`);

  if (!values.live) {
    console.log('⚠️  Mock mode provides limited accuracy. Use --live for real LLM validation.\n');
  }

  // Create evaluator with appropriate client
  let evaluator: PromptEvaluator;

  if (values.live) {
    // Live mode - uses real LLM client
    evaluator = new PromptEvaluator();
  } else {
    // Mock mode - create a fixture-aware mock
    const mock = new MockEvalLLMClient();

    // Classification prompts (plan-approval.md and image-approval.md)
    // Match exact responses within <user_response> tags
    const exactApproveResponses = [
      'yes', 'ok', 'proceed', 'looks good', 'go ahead', 'lgtm',
      'accept', 'start', 'continue', 'y', '1', 'generate', 'create it', 'make it',
    ];
    for (const phrase of exactApproveResponses) {
      mock.when(`<user_response>\n${phrase}\n</user_response>`, 'APPROVE');
    }

    // Story validation patterns - must include """ wrapper to match user input
    const validStoryPatterns = [
      '"""\nA detective',
      '"""\nMake a horror story',
      '"""\nA young wizard',
      '"""\nA robot learns',
      '"""\nAn elderly woman',
      '"""\nA spy must',
      '"""\nCan you make a video based on Little Red Riding Hood',
    ];
    for (const pattern of validStoryPatterns) {
      mock.when(pattern, 'VALID');
    }

    const invalidInputPatterns = [
      '"""\nThe meaning of life',
      '"""\nHow does video',
      '"""\nThe transformer architecture',
      '"""\nSubscribe to',
      '"""\nasdfasdf',
      '"""\ntest123',
      '"""\nhello\n"""',
      '"""\nStories are powerful',
      '"""\nWhat if we could',
      '"""\nAccording to recent',
      '"""\n...\n"""',
    ];
    for (const pattern of invalidInputPatterns) {
      mock.when(pattern, 'INVALID: Not a valid story idea');
    }

    // Default: FEEDBACK for classification prompts (most conservative)
    mock.setDefault('FEEDBACK');

    evaluator = new PromptEvaluator(mock);
  }

  const tags = values.tags as string[] | undefined;

  try {
    if (values.fixture) {
      // Run specific fixture
      const fixture = evaluator.loadFixture(values.fixture);
      const summary = await evaluator.runFixture(fixture, tags);
      console.log(evaluator.formatResults([summary]));

      process.exit(summary.failed > 0 ? 1 : 0);
    } else {
      // Run all fixtures
      const summaries = await evaluator.runAll(tags);

      if (summaries.length === 0) {
        console.log('No eval fixtures found in tests/evals/');
        process.exit(0);
      }

      console.log(evaluator.formatResults(summaries));

      const totalFailed = summaries.reduce((sum, s) => sum + s.failed, 0);
      process.exit(totalFailed > 0 ? 1 : 0);
    }
  } catch (error) {
    console.error('Error running evals:', error);
    process.exit(1);
  }
}

main();
