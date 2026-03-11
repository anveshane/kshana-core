/**
 * Integration tests for the DAG executor.
 */

import { describe, it, expect, vi } from 'vitest';
import { DAG } from '../../../src/core/dag/DAG.js';
import { DAGExecutor, type UserInteractionHandler } from '../../../src/core/dag/DAGExecutor.js';
import type { DAGEvent, DAGNode, NodeResult } from '../../../src/core/dag/types.js';
import { saveDAGState, loadDAGState, prepareStateForResume } from '../../../src/core/dag/persistence.js';
import { getDefaultPolicy } from '../../../src/core/dag/errorPolicies.js';
import { makeNode, withTempDir } from '../../helpers/dag/DAGTestHelpers.js';
import { MockLLMClient } from '../../integration/MockLLMClient.js';
import type { Message } from '../../../src/core/llm/types.js';

function makeExecutor(
  dag: DAG,
  opts: {
    llm?: MockLLMClient;
    userInteraction?: UserInteractionHandler;
    maxConcurrency?: number;
    projectDir?: string;
  } = {},
) {
  return new DAGExecutor(dag, {
    llm: (opts.llm ?? new MockLLMClient()) as any,
    projectDir: opts.projectDir ?? '/tmp/dag-test',
    templateId: 'test',
    dagId: 'test-run',
    maxConcurrency: opts.maxConcurrency ?? 4,
    userInteraction: opts.userInteraction ?? (async () => 'approved'),
  });
}

function collectEvents(executor: DAGExecutor): DAGEvent[] {
  const events: DAGEvent[] = [];
  executor.on(e => events.push(e));
  return events;
}

describe('DAGExecutor', () => {
  // ===========================================================================
  // Linear D → D → D
  // ===========================================================================

  it('executes linear D chain to completion', async () => {
    await withTempDir(async (dir) => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'a', handler: async () => ({ content: 'A done' }) }));
      dag.addNode(makeNode({ id: 'b', dependsOn: ['a'], handler: async () => ({ content: 'B done' }) }));
      dag.addNode(makeNode({ id: 'c', dependsOn: ['b'], handler: async () => ({ content: 'C done' }) }));
      dag.updateReadyNodes();

      const executor = makeExecutor(dag, { projectDir: dir });
      const events = collectEvents(executor);
      const result = await executor.run();

      expect(result.completed).toBe(true);
      expect(result.stats.completed).toBe(3);
      expect(result.stats.failed).toBe(0);

      // Events in order
      const startedIds = events.filter(e => e.type === 'node_started').map(e => (e as any).nodeId);
      expect(startedIds).toEqual(['a', 'b', 'c']);

      const completedIds = events.filter(e => e.type === 'node_completed').map(e => (e as any).nodeId);
      expect(completedIds).toEqual(['a', 'b', 'c']);

      // Results actually stored on nodes
      expect(dag.getNode('a').result?.content).toBe('A done');
      expect(dag.getNode('c').result?.content).toBe('C done');
    });
  });

  // ===========================================================================
  // S node with mock LLM
  // ===========================================================================

  it('S node sends prompt to LLM and stores result', async () => {
    await withTempDir(async (dir) => {
      const dag = new DAG();
      const llm = new MockLLMClient();
      llm.setDefaultResponse({ content: 'LLM generated text' });

      dag.addNode({
        id: 'gen',
        type: 'S',
        dependsOn: [],
        status: 'pending',
        promptBuilder: () => 'Write a story',
        errorPolicy: getDefaultPolicy('S'),
      });
      dag.updateReadyNodes();

      const executor = makeExecutor(dag, { llm, projectDir: dir });
      const result = await executor.run();

      expect(result.completed).toBe(true);
      expect(dag.getNode('gen').result?.content).toBe('LLM generated text');

      // Verify the LLM received the correct prompt structure
      const history = llm.getCallHistory();
      expect(history.length).toBe(1);
      const messages = history[0]!;
      expect(messages.some(m => m.role === 'system')).toBe(true);
      expect(messages.some(m => m.role === 'user' && m.content?.includes('Write a story'))).toBe(true);
    });
  });

  // ===========================================================================
  // S node with json_object response format
  // ===========================================================================

  it('S node triggers json_object response format when prompt contains JSON instruction', async () => {
    await withTempDir(async (dir) => {
      const dag = new DAG();
      const capturedOpts: any[] = [];
      const llm = new MockLLMClient();
      const origGenerate = llm.generate.bind(llm);
      llm.generate = async (opts: any) => {
        capturedOpts.push(opts);
        return origGenerate(opts);
      };
      llm.setDefaultResponse({ content: '{"result": true}' });

      dag.addNode({
        id: 'json_gen',
        type: 'S',
        dependsOn: [],
        status: 'pending',
        promptBuilder: () => 'Return ONLY valid JSON with the answer',
        errorPolicy: getDefaultPolicy('S'),
      });
      dag.updateReadyNodes();

      const executor = makeExecutor(dag, { llm: llm as any, projectDir: dir });
      await executor.run();

      expect(capturedOpts.length).toBeGreaterThan(0);
      expect(capturedOpts[0].responseFormat).toEqual({ type: 'json_object' });
    });
  });

  // ===========================================================================
  // U node with mock handler
  // ===========================================================================

  it('U node calls user interaction handler', async () => {
    await withTempDir(async (dir) => {
      const dag = new DAG();
      const userHandler = vi.fn().mockResolvedValue('yes');

      dag.addNode({
        id: 'approve',
        type: 'U',
        dependsOn: [],
        status: 'pending',
        questionBuilder: () => ({ question: 'Approve?', isConfirmation: true }),
        errorPolicy: getDefaultPolicy('U'),
      });
      dag.updateReadyNodes();

      const executor = makeExecutor(dag, { userInteraction: userHandler, projectDir: dir });
      const result = await executor.run();

      expect(result.completed).toBe(true);
      expect(userHandler).toHaveBeenCalledWith('approve', 'Approve?', true, undefined, undefined, undefined);
      expect(dag.getNode('approve').result?.userResponse).toBe('yes');
      // U nodes also set content to userResponse
      expect(dag.getNode('approve').result?.content).toBe('yes');
    });
  });

  // ===========================================================================
  // U node interrupted (throws)
  // ===========================================================================

  it('U node interrupted resets to ready and pauses executor', async () => {
    await withTempDir(async (dir) => {
      const dag = new DAG();
      const userHandler = vi.fn().mockRejectedValue(new Error('interrupted'));

      dag.addNode({
        id: 'gate',
        type: 'U',
        dependsOn: [],
        status: 'pending',
        questionBuilder: () => ({ question: 'Continue?', isConfirmation: true }),
        errorPolicy: getDefaultPolicy('U'),
      });
      dag.updateReadyNodes();

      const executor = makeExecutor(dag, { userInteraction: userHandler, projectDir: dir });
      const events = collectEvents(executor);
      const result = await executor.run();

      expect(result.paused).toBe(true);
      expect(result.completed).toBe(false);
      expect(dag.getNode('gate').status).toBe('ready');

      // dag_paused event should be emitted
      const pauseEvents = events.filter(e => e.type === 'dag_paused');
      expect(pauseEvents).toHaveLength(1);
    });
  });

  // ===========================================================================
  // Parallel execution
  // ===========================================================================

  it('independent nodes run in parallel (maxConcurrency=2)', async () => {
    await withTempDir(async (dir) => {
      const dag = new DAG();
      const startTimes: Record<string, number> = {};
      const endTimes: Record<string, number> = {};

      for (const id of ['a', 'b', 'c']) {
        dag.addNode(makeNode({
          id,
          handler: async () => {
            startTimes[id] = Date.now();
            await new Promise(r => setTimeout(r, 80));
            endTimes[id] = Date.now();
            return { content: `${id} done` };
          },
        }));
      }
      dag.updateReadyNodes();

      const executor = makeExecutor(dag, { maxConcurrency: 2, projectDir: dir });
      await executor.run();

      // All should complete
      expect(dag.getNode('a').status).toBe('completed');
      expect(dag.getNode('b').status).toBe('completed');
      expect(dag.getNode('c').status).toBe('completed');

      // a and b should start in the same batch — their start times should be
      // within a few ms of each other (both started before either finished)
      const abStartDelta = Math.abs(startTimes['a']! - startTimes['b']!);
      expect(abStartDelta).toBeLessThan(30); // Started in same batch

      // c should start after the first batch finishes (after a or b ends)
      const earliestFirstBatchEnd = Math.min(endTimes['a']!, endTimes['b']!);
      expect(startTimes['c']!).toBeGreaterThanOrEqual(earliestFirstBatchEnd - 5); // small tolerance
    });
  });

  // ===========================================================================
  // Dynamic expansion via registry
  // ===========================================================================

  it('expander spawns new nodes via registry that complete', async () => {
    await withTempDir(async (dir) => {
      const dag = new DAG();
      dag.registerHandler('child_handler', async () => ({ content: 'child done' }));
      dag.registerExpander('test_expander', () => [
        { id: 'child_1', type: 'D', dependsOn: ['parent'], handlerKey: 'child_handler' },
        { id: 'child_2', type: 'D', dependsOn: ['parent'], handlerKey: 'child_handler' },
      ]);
      dag.registerHandler('parent_handler', async () => ({ content: 'parent done' }));

      dag.addNodeFromDefinition({
        id: 'parent',
        type: 'D',
        dependsOn: [],
        handlerKey: 'parent_handler',
        expanderKey: 'test_expander',
      });
      dag.updateReadyNodes();

      const executor = makeExecutor(dag, { projectDir: dir });
      const events = collectEvents(executor);
      const result = await executor.run();

      expect(result.completed).toBe(true);
      expect(result.stats.completed).toBe(3); // parent + 2 children
      expect(dag.getNode('child_1').status).toBe('completed');
      expect(dag.getNode('child_2').status).toBe('completed');
      expect(dag.getNode('child_1').result?.content).toBe('child done');

      // Expansion event emitted with correct new node IDs
      const expansionEvents = events.filter(e => e.type === 'expansion');
      expect(expansionEvents).toHaveLength(1);
      const expEvent = expansionEvents[0] as any;
      expect(expEvent.sourceNodeId).toBe('parent');
      expect(expEvent.newNodeIds.sort()).toEqual(['child_1', 'child_2']);

      // Expansion logged in DAG
      const log = dag.getExpansionLog();
      expect(log).toHaveLength(1);
      expect(log[0]!.sourceNodeId).toBe('parent');
    });
  });

  // ===========================================================================
  // Validation fail → retry → success (with prompt verification)
  // ===========================================================================

  it('retries on validation failure with error feedback in prompt', async () => {
    await withTempDir(async (dir) => {
      const capturedMessages: Message[][] = [];
      const llm = new MockLLMClient();
      let callCount = 0;

      llm.generate = async (opts: any) => {
        capturedMessages.push([...opts.messages]);
        callCount++;
        if (callCount === 1) {
          return { content: 'not json', toolCalls: [], finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
        }
        return { content: '{"valid": true}', toolCalls: [], finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
      };

      const dag = new DAG();
      dag.addNode({
        id: 'gen',
        type: 'S',
        dependsOn: [],
        status: 'pending',
        promptBuilder: () => 'Return ONLY valid JSON',
        errorPolicy: {
          maxRetries: 3,
          retryStrategy: 'rephrase',
          onExhausted: 'ask_user',
          validation: (result: NodeResult) => {
            try {
              const data = JSON.parse(result.content ?? '');
              return { valid: true, data };
            } catch {
              return { valid: false, error: 'Not valid JSON' };
            }
          },
        },
      });
      dag.updateReadyNodes();

      const executor = makeExecutor(dag, { llm: llm as any, projectDir: dir });
      const events = collectEvents(executor);
      const result = await executor.run();

      expect(result.completed).toBe(true);
      expect(dag.getNode('gen').status).toBe('completed');
      expect(dag.getNode('gen').result?.data).toEqual({ valid: true });

      // First call: fresh prompt (system + user)
      expect(capturedMessages[0]).toHaveLength(2);

      // Second call (retry): should include error feedback
      // retryNode sends: system + original prompt + assistant previous output + user error feedback
      expect(capturedMessages[1]!.length).toBe(4);
      const retryUserMsg = capturedMessages[1]!.find(
        m => m.role === 'user' && m.content?.includes('Not valid JSON')
      );
      expect(retryUserMsg).toBeDefined(); // Error feedback actually sent to LLM

      // The assistant message contains the invalid previous response
      const assistantMsg = capturedMessages[1]!.find(m => m.role === 'assistant');
      expect(assistantMsg?.content).toBe('not json');

      // Retry event emitted
      const retryEvents = events.filter(e => e.type === 'retry');
      expect(retryEvents.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ===========================================================================
  // D node error → retry before exhaustion
  // ===========================================================================

  it('D node retries on error before reaching exhaustion', async () => {
    await withTempDir(async (dir) => {
      const dag = new DAG();
      let callCount = 0;

      dag.addNode(makeNode({
        id: 'flaky_d',
        handler: async () => {
          callCount++;
          if (callCount === 1) throw new Error('transient glitch');
          return { content: 'success on retry' };
        },
        errorPolicy: { maxRetries: 3, retryStrategy: 'same', onExhausted: 'skip' },
      }));
      dag.updateReadyNodes();

      const executor = makeExecutor(dag, { projectDir: dir });
      const events = collectEvents(executor);
      const result = await executor.run();

      expect(result.completed).toBe(true);
      expect(dag.getNode('flaky_d').status).toBe('completed');
      expect(dag.getNode('flaky_d').result?.content).toBe('success on retry');
      expect(callCount).toBe(2); // First call failed, second succeeded

      // Retry event emitted
      const retryEvents = events.filter(e => e.type === 'retry');
      expect(retryEvents).toHaveLength(1);

      // Node has 1 attempt recorded (the failure)
      expect(dag.getNode('flaky_d').attempts).toHaveLength(1);
      expect(dag.getNode('flaky_d').attempts![0]!.error).toBe('transient glitch');
    });
  });

  // ===========================================================================
  // Error exhaustion → skip
  // ===========================================================================

  it('skips node and dependents when exhausted with skip policy', async () => {
    await withTempDir(async (dir) => {
      const dag = new DAG();

      dag.addNode(makeNode({
        id: 'fail',
        handler: async () => { throw new Error('always fails'); },
        errorPolicy: { maxRetries: 1, retryStrategy: 'same', onExhausted: 'skip' },
      }));
      dag.addNode(makeNode({ id: 'child', dependsOn: ['fail'] }));
      dag.addNode(makeNode({ id: 'grandchild', dependsOn: ['child'] }));
      dag.updateReadyNodes();

      const executor = makeExecutor(dag, { projectDir: dir });
      const events = collectEvents(executor);
      const result = await executor.run();

      expect(result.stats.skipped).toBe(3); // fail + child + grandchild
      expect(dag.getNode('fail').status).toBe('skipped');
      expect(dag.getNode('child').status).toBe('skipped');
      expect(dag.getNode('grandchild').status).toBe('skipped');

      // Skip events emitted for each node
      const skipEvents = events.filter(e => e.type === 'node_skipped');
      expect(skipEvents).toHaveLength(3);
    });
  });

  // ===========================================================================
  // Error exhaustion → ask_user → user retries
  // ===========================================================================

  it('asks user on exhaustion and retries when user says retry', async () => {
    await withTempDir(async (dir) => {
      const dag = new DAG();
      let failCount = 0;
      const userQuestions: string[] = [];

      dag.addNode(makeNode({
        id: 'flaky',
        handler: async () => {
          failCount++;
          if (failCount <= 2) throw new Error('transient');
          return { content: 'finally' };
        },
        errorPolicy: { maxRetries: 1, retryStrategy: 'same', onExhausted: 'ask_user' },
      }));
      dag.updateReadyNodes();

      const userHandler: UserInteractionHandler = async (_nodeId, question) => {
        userQuestions.push(question);
        if (question.includes('failed')) return 'retry';
        return 'approved';
      };

      const executor = makeExecutor(dag, { userInteraction: userHandler, projectDir: dir });
      const result = await executor.run();

      expect(result.completed).toBe(true);
      expect(dag.getNode('flaky').result?.content).toBe('finally');

      // Verify the user was actually asked about the failure
      expect(userQuestions.some(q => q.includes('failed'))).toBe(true);
      expect(userQuestions.some(q => q.includes('transient'))).toBe(true);
    });
  });

  // ===========================================================================
  // Error exhaustion → ask_user → user skips
  // ===========================================================================

  it('asks user on exhaustion and skips when user says skip', async () => {
    await withTempDir(async (dir) => {
      const dag = new DAG();

      dag.addNode(makeNode({
        id: 'broken',
        handler: async () => { throw new Error('permanent'); },
        errorPolicy: { maxRetries: 1, retryStrategy: 'same', onExhausted: 'ask_user' },
      }));
      dag.addNode(makeNode({ id: 'dependent', dependsOn: ['broken'] }));
      dag.updateReadyNodes();

      const userHandler: UserInteractionHandler = async (_nodeId, question) => {
        if (question.includes('failed')) return 'skip';
        return 'approved';
      };

      const executor = makeExecutor(dag, { userInteraction: userHandler, projectDir: dir });
      const result = await executor.run();

      // Skipped nodes, not stuck
      expect(dag.getNode('broken').status).toBe('skipped');
      expect(dag.getNode('dependent').status).toBe('skipped');
      expect(result.completed).toBe(true);
    });
  });

  // ===========================================================================
  // Error exhaustion → micro_llm → skip
  // ===========================================================================

  it('micro_llm recovery decides to skip with correct context', async () => {
    await withTempDir(async (dir) => {
      const dag = new DAG();

      dag.addNode(makeNode({
        id: 'fail_node',
        description: 'Generate important content',
        handler: async () => { throw new Error('permanent failure'); },
        errorPolicy: { maxRetries: 1, retryStrategy: 'same', onExhausted: 'micro_llm' },
      }));
      dag.addNode(makeNode({ id: 'downstream', dependsOn: ['fail_node'] }));
      dag.updateReadyNodes();

      const capturedMessages: Message[][] = [];
      const llm = new MockLLMClient();
      const origGenerate = llm.generate.bind(llm);
      llm.generate = async (opts: any) => {
        capturedMessages.push([...opts.messages]);
        return origGenerate(opts);
      };
      llm.setDefaultResponse({
        content: JSON.stringify({ action: 'skip', reason: 'Not critical', skipImpact: 'Minor' }),
      });

      const executor = makeExecutor(dag, { llm: llm as any, projectDir: dir });
      const events = collectEvents(executor);
      await executor.run();

      expect(dag.getNode('fail_node').status).toBe('skipped');
      expect(dag.getNode('downstream').status).toBe('skipped');

      // Recovery event emitted with correct decision
      const recoveryEvents = events.filter(e => e.type === 'micro_llm_recovery');
      expect(recoveryEvents).toHaveLength(1);
      expect((recoveryEvents[0] as any).decision.action).toBe('skip');

      // Verify the micro-LLM received context about the failure
      expect(capturedMessages.length).toBeGreaterThan(0);
      const lastPrompt = capturedMessages[capturedMessages.length - 1]!;
      const userMsg = lastPrompt.find(m => m.role === 'user');
      expect(userMsg?.content).toContain('fail_node');
      expect(userMsg?.content).toContain('permanent failure');
      // Downstream impact should mention the dependent node
      expect(userMsg?.content).toContain('downstream');
    });
  });

  // ===========================================================================
  // Error exhaustion → micro_llm → retry_modified
  // ===========================================================================

  it('micro_llm recovery with retry_modified resets node and stores modified input', async () => {
    await withTempDir(async (dir) => {
      const dag = new DAG();
      let callCount = 0;

      dag.addNode(makeNode({
        id: 'recoverable',
        handler: async () => {
          callCount++;
          // Fail on first call (exhausts retries), then succeed after micro_llm retry_modified
          if (callCount <= 1) throw new Error('format error');
          return { content: 'recovered' };
        },
        // maxRetries: 0 means first failure immediately goes to onExhausted
        errorPolicy: { maxRetries: 0, retryStrategy: 'same', onExhausted: 'micro_llm' },
      }));
      dag.updateReadyNodes();

      const llm = new MockLLMClient();
      llm.setDefaultResponse({
        content: JSON.stringify({
          action: 'retry_modified',
          reason: 'Try different approach',
          modifiedInput: 'use simpler format',
        }),
      });

      const executor = makeExecutor(dag, { llm, projectDir: dir });
      const events = collectEvents(executor);
      const result = await executor.run();

      expect(result.completed).toBe(true);
      expect(dag.getNode('recoverable').status).toBe('completed');
      expect(dag.getNode('recoverable').result?.content).toBe('recovered');

      // Recovery decision was recorded
      expect(dag.getNode('recoverable').recoveryDecisions).toHaveLength(1);
      expect(dag.getNode('recoverable').recoveryDecisions![0]!.action).toBe('retry_modified');
      expect(dag.getNode('recoverable').recoveryDecisions![0]!.modifiedInput).toBe('use simpler format');

      // micro_llm_recovery event emitted
      const recoveryEvents = events.filter(e => e.type === 'micro_llm_recovery');
      expect(recoveryEvents).toHaveLength(1);

      // Modified input stored in metadata
      expect(dag.getNode('recoverable').metadata?.['modifiedInput']).toBe('use simpler format');
    });
  });

  // ===========================================================================
  // Error exhaustion → micro_llm → ask_user escalation
  // ===========================================================================

  it('micro_llm recovery escalates to ask_user and pauses', async () => {
    await withTempDir(async (dir) => {
      const dag = new DAG();

      dag.addNode(makeNode({
        id: 'hard_fail',
        handler: async () => { throw new Error('unrecoverable'); },
        errorPolicy: { maxRetries: 1, retryStrategy: 'same', onExhausted: 'micro_llm' },
      }));
      dag.updateReadyNodes();

      const llm = new MockLLMClient();
      llm.setDefaultResponse({
        content: JSON.stringify({ action: 'ask_user', reason: 'Need human guidance' }),
      });

      const executor = makeExecutor(dag, { llm, projectDir: dir });
      const result = await executor.run();

      expect(result.paused).toBe(true);
      expect(result.completed).toBe(false);
      expect(dag.getNode('hard_fail').status).toBe('failed');
    });
  });

  // ===========================================================================
  // Stuck DAG detection
  // ===========================================================================

  it('detects stuck DAG when no nodes are ready or running', async () => {
    await withTempDir(async (dir) => {
      const dag = new DAG();
      // Create a node depending on a nonexistent dep — it can never become ready
      dag.addNode(makeNode({ id: 'stuck_node', dependsOn: ['nonexistent'] }));
      // Add the missing dep so DAG is valid but leave it in failed state
      dag.addNode(makeNode({ id: 'nonexistent', status: 'failed' }));
      // stuck_node stays pending because failed deps don't count as done

      const executor = makeExecutor(dag, { projectDir: dir });
      const result = await executor.run();

      // The executor should exit the loop without completing
      expect(result.completed).toBe(false);
      expect(result.paused).toBe(false);
      expect(result.aborted).toBe(false);
      // stuck_node is still pending — never got to run
      expect(dag.getNode('stuck_node').status).toBe('pending');
    });
  });

  // ===========================================================================
  // D node without handler throws
  // ===========================================================================

  it('D node without handler fails with clear error', async () => {
    await withTempDir(async (dir) => {
      const dag = new DAG();
      dag.addNode({
        id: 'no_handler',
        type: 'D',
        dependsOn: [],
        status: 'pending',
        errorPolicy: { maxRetries: 0, retryStrategy: 'same', onExhausted: 'skip' },
        // No handler attached
      });
      dag.updateReadyNodes();

      const executor = makeExecutor(dag, { projectDir: dir });
      const events = collectEvents(executor);
      await executor.run();

      expect(dag.getNode('no_handler').status).toBe('skipped');
      const failEvents = events.filter(e => e.type === 'node_failed');
      expect(failEvents).toHaveLength(1);
      expect((failEvents[0] as any).error).toContain('no handler');
    });
  });

  // ===========================================================================
  // S node without promptBuilder throws
  // ===========================================================================

  it('S node without promptBuilder fails with clear error', async () => {
    await withTempDir(async (dir) => {
      const dag = new DAG();
      dag.addNode({
        id: 'no_prompt',
        type: 'S',
        dependsOn: [],
        status: 'pending',
        errorPolicy: { maxRetries: 0, retryStrategy: 'same', onExhausted: 'skip' },
        // No promptBuilder
      });
      dag.updateReadyNodes();

      const executor = makeExecutor(dag, { projectDir: dir });
      const events = collectEvents(executor);
      await executor.run();

      expect(dag.getNode('no_prompt').status).toBe('skipped');
      const failEvents = events.filter(e => e.type === 'node_failed');
      expect(failEvents).toHaveLength(1);
      expect((failEvents[0] as any).error).toContain('no prompt builder');
    });
  });

  // ===========================================================================
  // State persistence emits event
  // ===========================================================================

  it('emits dag_state_saved after each batch', async () => {
    await withTempDir(async (dir) => {
      const dag = new DAG();
      dag.addNode(makeNode({ id: 'a', handler: async () => ({ content: 'done' }) }));
      dag.updateReadyNodes();

      const executor = makeExecutor(dag, { projectDir: dir });
      const events = collectEvents(executor);
      await executor.run();

      const saveEvents = events.filter(e => e.type === 'dag_state_saved');
      expect(saveEvents.length).toBeGreaterThanOrEqual(1);
      expect((saveEvents[0] as any).path).toContain('state.json');
    });
  });

  // ===========================================================================
  // Resume from state
  // ===========================================================================

  it('resumes from persisted state without re-executing completed nodes', async () => {
    await withTempDir(async (dir) => {
      // Create initial DAG and save state with A completed, B running
      const dag1 = new DAG();
      dag1.addNode(makeNode({ id: 'a', status: 'completed', result: { content: 'A result' } }));
      dag1.addNode(makeNode({ id: 'b', dependsOn: ['a'], status: 'running', result: { content: 'partial' } }));
      saveDAGState(dag1, 'dag-1', 'test', dir);

      // Load and prepare for resume
      const state = loadDAGState(dir)!;
      const prepared = prepareStateForResume(state);

      expect(prepared.nodes['b']!.status).toBe('ready');
      expect(prepared.nodes['a']!.status).toBe('completed');
      // B's partial result should be cleared
      expect(prepared.nodes['b']!.result).toBeUndefined();

      // Rebuild DAG from prepared state
      const dag2 = new DAG();
      const handlerCalls: string[] = [];

      for (const [_id, nodeState] of Object.entries(prepared.nodes)) {
        const node: DAGNode = {
          id: nodeState.id,
          type: nodeState.type,
          dependsOn: [...nodeState.dependsOn],
          status: nodeState.status as any,
          result: nodeState.result,
          errorPolicy: getDefaultPolicy(nodeState.type),
          handler: async () => {
            handlerCalls.push(nodeState.id);
            return { content: `${nodeState.id} done` };
          },
        };
        dag2.addNode(node);
      }

      const executor = makeExecutor(dag2, { projectDir: dir });
      const result = await executor.run();

      expect(result.completed).toBe(true);
      // A should NOT be re-executed (already completed)
      expect(handlerCalls).not.toContain('a');
      // B should be re-executed
      expect(handlerCalls).toContain('b');
      expect(dag2.getNode('b').result?.content).toBe('b done');
    });
  });

  // ===========================================================================
  // Abort
  // ===========================================================================

  it('abort stops execution and does not start new nodes', async () => {
    await withTempDir(async (dir) => {
      const dag = new DAG();
      const startedNodes: string[] = [];

      dag.addNode(makeNode({
        id: 'slow',
        handler: async () => {
          startedNodes.push('slow');
          await new Promise(r => setTimeout(r, 200));
          return { content: 'done' };
        },
      }));
      dag.addNode(makeNode({ id: 'after', dependsOn: ['slow'] }));
      dag.updateReadyNodes();

      const executor = makeExecutor(dag, { projectDir: dir });

      // Abort shortly after start
      setTimeout(() => executor.abort(), 50);

      const execResult = await executor.run();
      expect(execResult.aborted).toBe(true);

      // 'slow' started but 'after' should never have started
      expect(startedNodes).toContain('slow');
      expect(startedNodes).not.toContain('after');
    });
  });
});
