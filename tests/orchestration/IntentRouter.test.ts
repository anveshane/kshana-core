import { describe, expect, it } from 'vitest';
import { IntentRouter } from '../../src/core/orchestration/IntentRouter.js';

describe('IntentRouter', () => {
  const router = new IntentRouter();

  it('classifies new project requests as simple', () => {
    const route = router.classifyIntent('Create a video about AI history', false);
    expect(route.intent).toBe('simple');
    expect(route.suggestedStrategy).toBe('direct');
    expect(route.requiresStateAnalysis).toBe(false);
  });

  it('classifies continue requests as analyze', () => {
    const route = router.classifyIntent('continue where I left off', true);
    expect(route.intent).toBe('continue');
    expect(route.suggestedStrategy).toBe('analyze');
    expect(route.requiresStateAnalysis).toBe(true);
  });

  it('classifies targeted modify requests and extracts targets', () => {
    const route = router.classifyIntent('regenerate image 5 and video 2', true);
    expect(route.intent).toBe('modify');
    expect(route.targetItems).toContain('image 5');
    expect(route.targetItems).toContain('video 2');
    expect(route.requiresStateAnalysis).toBe(true);
  });

  it('classifies ambiguous requests as interactive', () => {
    const route = router.classifyIntent('make it better', true);
    expect(route.intent).toBe('ambiguous');
    expect(route.suggestedStrategy).toBe('interactive');
    expect(route.requiresStateAnalysis).toBe(false);
  });

  it('classifies status questions', () => {
    const route = router.classifyIntent("what's the status?", true);
    expect(route.intent).toBe('question');
    expect(route.suggestedStrategy).toBe('analyze');
  });
});
