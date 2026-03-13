#!/usr/bin/env tsx
/**
 * Run golden flow recordings.
 *
 * Usage:
 *   npx tsx scripts/run-golden-flows.ts [--scenario <name>] [--model-tier local|cloud]
 *
 * This script:
 * 1. Runs full narrative flows against a real LLM
 * 2. Saves conversation recordings to tests/recordings/
 * 3. Saves checkpoints at phase transitions to tests/checkpoints/
 *
 * The recordings can then be used for Layer 0 replay tests,
 * and checkpoints for Layer 3 scenario tests.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ModelSelector, type ModelTier } from '../src/testing/ModelSelector.js';
import { ConversationRecorder } from '../src/testing/ConversationRecorder.js';
import { CheckpointManager } from '../src/testing/CheckpointManager.js';
import { LLMClient } from '../src/core/llm/LLMClient.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const RECORDINGS_DIR = join(PROJECT_ROOT, 'tests', 'recordings');
const CHECKPOINTS_DIR = join(PROJECT_ROOT, 'tests', 'checkpoints');

// --- CLI arg parsing ---

function parseArgs(): { scenario: string; modelTier: ModelTier } {
  const args = process.argv.slice(2);
  let scenario = 'narrative-full';
  let modelTier: ModelTier = 'local';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--scenario' && args[i + 1]) {
      scenario = args[i + 1]!;
      i++;
    }
    if (args[i] === '--model-tier' && args[i + 1]) {
      modelTier = args[i + 1] as ModelTier;
      i++;
    }
  }

  return { scenario, modelTier };
}

// --- Main ---

async function main() {
  const { scenario, modelTier } = parseArgs();

  console.log(`\n=== Golden Flow Recording ===`);
  console.log(`Scenario: ${scenario}`);
  console.log(`Model tier: ${modelTier}`);

  // Check model availability
  const selector = new ModelSelector();
  const config = selector.getLLMConfig(modelTier);

  if (modelTier === 'local') {
    const available = await ModelSelector.isLocalAvailable();
    if (!available) {
      console.error('\nLocal model server is not available.');
      console.error('Start LM Studio or set --model-tier cloud');
      process.exit(1);
    }
  }

  console.log(`Model: ${config.model}`);
  console.log(`Base URL: ${config.baseUrl}\n`);

  // Create LLM client with recording wrapper
  const llmClient = new LLMClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
  });

  const recorder = new ConversationRecorder(llmClient, {
    model: config.model,
    scenario,
  });

  const checkpointManager = new CheckpointManager(CHECKPOINTS_DIR);

  // Run the scenario
  console.log('Starting golden flow...\n');

  try {
    // For now, run a simple conversation to validate the infrastructure
    const response = await recorder.generate({
      messages: [
        { role: 'system', content: 'You are a helpful assistant for creating narrative videos.' },
        { role: 'user', content: 'Create a short story about a blacksmith who discovers a magical sword.' },
      ],
      temperature: 0,
    });

    console.log(`Turn 1 completed:`);
    console.log(`  Content: ${response.content?.slice(0, 100)}...`);
    console.log(`  Tool calls: ${response.toolCalls.length}`);
    console.log(`  Tokens: ${response.usage?.totalTokens ?? 'unknown'}`);

    // Save recording
    const recordingPath = join(RECORDINGS_DIR, `${scenario}.recording.json`);
    recorder.save(recordingPath);
    console.log(`\nRecording saved: ${recordingPath}`);

    // Save checkpoint
    checkpointManager.save(`golden/${scenario}-start`, {
      description: `Golden flow start: ${scenario}`,
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Create a short story about a blacksmith.' },
        { role: 'assistant', content: response.content },
      ],
      projectState: {
        version: '3.0',
        id: 'golden-flow',
        title: 'Golden Flow',
        templateId: 'narrative',
        templateVersion: '1.0',
        style: 'cinematic',
        inputType: 'text',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        artifacts: {},
        currentPhase: 'start',
        phaseHistory: [],
      } as any,
      template: 'narrative',
      phase: 'start',
      tags: ['golden', scenario],
      model: config.model,
      scenario,
    });
    console.log(`Checkpoint saved: golden/${scenario}-start`);

    console.log('\n=== Golden flow complete ===\n');
  } catch (error) {
    console.error('\nGolden flow failed:', error);
    process.exit(1);
  }
}

main().catch(console.error);
