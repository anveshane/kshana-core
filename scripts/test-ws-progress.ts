#!/usr/bin/env tsx
/**
 * Minimal test for ComfyUI WebSocket progress integration.
 *
 * Queues a tiny (128x128) text-to-video job via ComfyUI and monitors it
 * through waitForCompletionWS to verify real-time step progress arrives
 * over the WebSocket.
 *
 * Usage:
 *   tsx scripts/test-ws-progress.ts [--url http://localhost:8188]
 */

import 'dotenv/config';
import { ComfyUIClient } from '../src/services/comfyui/ComfyUIClient';
import { comfyProgressBus } from '../src/services/comfyui/ComfyUIProgressBus';
import { loadWorkflowTemplate, parameterizeLtx23Workflow } from '../src/services/comfyui/WorkflowLoader';

const baseUrl = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]!
  : process.env['COMFYUI_BASE_URL'] || 'http://localhost:8188';

async function main() {
  console.log('='.repeat(60));
  console.log('WebSocket Progress Integration Test');
  console.log('='.repeat(60));
  console.log(`ComfyUI: ${baseUrl}`);
  console.log(`Size:    128x128 (tiny, for speed)`);
  console.log(`Mode:    text-to-video`);
  console.log('='.repeat(60));

  const client = new ComfyUIClient({
    baseUrl,
    outputDir: './outputs',
    timeout: 300,
  });

  // 1. Load & parameterize a tiny workflow
  console.log('\n[1/4] Loading workflow template...');
  const template = loadWorkflowTemplate('video_ltx23_gguf.json');
  const workflow = parameterizeLtx23Workflow(template, {
    prompt: 'A small red ball bouncing on a white surface',
    durationSeconds: 2,
    width: 128,
    height: 128,
    t2vMode: true,
    filenamePrefix: 'ws_test',
  });

  // 2. Queue with returnMeta to get clientId
  console.log('[2/4] Queueing workflow...');
  const { promptId, clientId } = await client.queueWorkflow(
    workflow as Record<string, unknown>,
    undefined,
    true,
  ) as { promptId: string; clientId: string };

  console.log(`       prompt_id: ${promptId}`);
  console.log(`       client_id: ${clientId}`);

  // 3. Subscribe to the progress bus (same path GenericAgent uses)
  let busEvents = 0;
  comfyProgressBus.onProgress((event) => {
    busEvents++;
    console.log(`  [bus] ${event.message} | pct=${event.percentage} step=${event.step ?? '-'}/${event.maxSteps ?? '-'} node=${event.currentNode ?? '-'} done=${event.done}`);
  });

  // 4. Wait via WebSocket
  console.log('\n[3/4] Waiting via WebSocket for real-time progress...\n');
  const startTime = Date.now();

  const result = await client.waitForCompletionWS(promptId, clientId, (info) => {
    // Also emit to the bus, same as tools.ts does
    comfyProgressBus.emitProgress({
      jobId: 'test-job',
      percentage: info.percentage,
      message: info.message,
      step: info.step,
      maxSteps: info.maxSteps,
      currentNode: info.currentNode,
      done: info.percentage >= 100,
    });
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n[4/4] Done in ${elapsed}s`);
  console.log(`       Status: ${result.status}`);
  console.log(`       Bus events received: ${busEvents}`);

  if (busEvents === 0) {
    console.log('\n⚠  WARNING: No progress events received via WebSocket.');
    console.log('   The WS connection may have fallen back to HTTP polling.');
    console.log('   Check logs/debug.log for details.');
  } else {
    console.log('\n✓  WebSocket progress integration is working!');
  }

  // Download output to verify end-to-end
  const outputs = await client.getOutputImages(promptId);
  if (outputs.length > 0) {
    const saved = await client.downloadImage(
      outputs[0]!.filename,
      outputs[0]!.subfolder,
      outputs[0]!.type,
      'ws_test_output.' + (outputs[0]!.filename.split('.').pop() || 'mp4'),
    );
    console.log(`       Output saved: ${saved}`);
  } else {
    console.log('       No output files found (may be normal for very small sizes)');
  }

  console.log('\n' + '='.repeat(60));
  process.exit(0);
}

main().catch((err) => {
  console.error('\nError:', err instanceof Error ? err.message : err);
  process.exit(1);
});
