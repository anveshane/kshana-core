/**
 * Unit tests for micro-LLM recovery decisions.
 */

import { describe, it, expect } from 'vitest';
import { microLLMRecover } from '../../../src/core/dag/microLLM.js';
import { DAG } from '../../../src/core/dag/DAG.js';
import { makeNode } from '../../helpers/dag/DAGTestHelpers.js';
import { MockLLMClient } from '../../integration/MockLLMClient.js';
import type { Message } from '../../../src/core/llm/types.js';

function setupDAGAndNode() {
  const dag = new DAG();
  dag.addNode(makeNode({ id: 'a', status: 'failed', description: 'Generate plot' }));
  dag.addNode(makeNode({ id: 'b', dependsOn: ['a'], description: 'Downstream task' }));
  const node = dag.getNode('a');
  return { dag, node };
}

describe('microLLM', () => {
  it('retry_modified returns decision with modifiedInput', async () => {
    const { dag, node } = setupDAGAndNode();
    const llm = new MockLLMClient();
    llm.setDefaultResponse({
      content: JSON.stringify({
        action: 'retry_modified',
        reason: 'Fix the prompt',
        modifiedInput: 'new prompt text',
      }),
    });

    const decision = await microLLMRecover(node, 'bad format', [], dag, llm as any);
    expect(decision.action).toBe('retry_modified');
    expect(decision.modifiedInput).toBe('new prompt text');
    expect(decision.reason).toBe('Fix the prompt');
  });

  it('skip returns decision with skipImpact', async () => {
    const { dag, node } = setupDAGAndNode();
    const llm = new MockLLMClient();
    llm.setDefaultResponse({
      content: JSON.stringify({
        action: 'skip',
        reason: 'Not critical',
        skipImpact: '1 downstream node affected',
      }),
    });

    const decision = await microLLMRecover(node, 'service down', [], dag, llm as any);
    expect(decision.action).toBe('skip');
    expect(decision.skipImpact).toBe('1 downstream node affected');
  });

  it('ask_user returns correct decision', async () => {
    const { dag, node } = setupDAGAndNode();
    const llm = new MockLLMClient();
    llm.setDefaultResponse({
      content: JSON.stringify({
        action: 'ask_user',
        reason: 'Need human guidance',
      }),
    });

    const decision = await microLLMRecover(node, 'unclear error', [], dag, llm as any);
    expect(decision.action).toBe('ask_user');
    expect(decision.reason).toBe('Need human guidance');
  });

  it('empty LLM response falls back to ask_user', async () => {
    const { dag, node } = setupDAGAndNode();
    const llm = new MockLLMClient();
    llm.setDefaultResponse({ content: '' });

    const decision = await microLLMRecover(node, 'error', [], dag, llm as any);
    expect(decision.action).toBe('ask_user');
    expect(decision.reason).toContain('empty');
  });

  it('non-JSON response falls back to ask_user', async () => {
    const { dag, node } = setupDAGAndNode();
    const llm = new MockLLMClient();
    llm.setDefaultResponse({ content: 'not json at all' });

    const decision = await microLLMRecover(node, 'error', [], dag, llm as any);
    expect(decision.action).toBe('ask_user');
    expect(decision.reason).toContain('parse');
  });

  it('invalid action falls back to ask_user', async () => {
    const { dag, node } = setupDAGAndNode();
    const llm = new MockLLMClient();
    llm.setDefaultResponse({
      content: JSON.stringify({ action: 'destroy_everything', reason: 'chaos' }),
    });

    const decision = await microLLMRecover(node, 'error', [], dag, llm as any);
    expect(decision.action).toBe('ask_user');
    expect(decision.reason).toContain('Invalid action');
  });

  it('LLM throw falls back to ask_user', async () => {
    const { dag, node } = setupDAGAndNode();
    const llm = new MockLLMClient();
    llm.generate = async () => { throw new Error('network down'); };

    const decision = await microLLMRecover(node, 'error', [], dag, llm as any);
    expect(decision.action).toBe('ask_user');
    expect(decision.reason).toContain('network down');
  });

  // ===========================================================================
  // Prompt verification — what the LLM actually receives
  // ===========================================================================

  it('sends node ID, error, and downstream impact in prompt to LLM', async () => {
    const { dag, node } = setupDAGAndNode();
    const capturedMessages: Message[][] = [];
    const llm = new MockLLMClient();
    const origGenerate = llm.generate.bind(llm);
    llm.generate = async (opts: any) => {
      capturedMessages.push([...opts.messages]);
      return origGenerate(opts);
    };
    llm.setDefaultResponse({
      content: JSON.stringify({ action: 'ask_user', reason: 'unsure' }),
    });

    const attempts = [
      { strategy: 'same' as const, error: 'first attempt failed', timestamp: new Date().toISOString() },
    ];

    await microLLMRecover(node, 'critical error', attempts, dag, llm as any);

    expect(capturedMessages).toHaveLength(1);
    const messages = capturedMessages[0]!;

    // System message about recovery
    const sysMsg = messages.find(m => m.role === 'system');
    expect(sysMsg?.content).toContain('recovery');

    // User prompt includes: node ID, error, attempt history, downstream impact
    const userMsg = messages.find(m => m.role === 'user');
    expect(userMsg).toBeDefined();
    const prompt = userMsg!.content!;
    expect(prompt).toContain('a'); // node ID
    expect(prompt).toContain('critical error'); // current error
    expect(prompt).toContain('first attempt failed'); // attempt history
    expect(prompt).toContain('b'); // downstream dependent node ID
  });

  it('includes node description in prompt when available', async () => {
    const { dag, node } = setupDAGAndNode();
    const capturedMessages: Message[][] = [];
    const llm = new MockLLMClient();
    const origGenerate = llm.generate.bind(llm);
    llm.generate = async (opts: any) => {
      capturedMessages.push([...opts.messages]);
      return origGenerate(opts);
    };
    llm.setDefaultResponse({
      content: JSON.stringify({ action: 'ask_user', reason: 'unsure' }),
    });

    await microLLMRecover(node, 'error', [], dag, llm as any);

    const userMsg = capturedMessages[0]!.find(m => m.role === 'user');
    expect(userMsg!.content).toContain('Generate plot'); // node description
  });

  it('reports no downstream impact for leaf nodes', async () => {
    const dag = new DAG();
    dag.addNode(makeNode({ id: 'leaf', status: 'failed' }));
    // No dependents

    const capturedMessages: Message[][] = [];
    const llm = new MockLLMClient();
    const origGenerate = llm.generate.bind(llm);
    llm.generate = async (opts: any) => {
      capturedMessages.push([...opts.messages]);
      return origGenerate(opts);
    };
    llm.setDefaultResponse({
      content: JSON.stringify({ action: 'skip', reason: 'safe' }),
    });

    await microLLMRecover(dag.getNode('leaf'), 'error', [], dag, llm as any);

    const userMsg = capturedMessages[0]!.find(m => m.role === 'user');
    expect(userMsg!.content).toContain('none'); // no downstream impact
  });
});
