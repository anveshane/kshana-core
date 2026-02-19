import type { IntentRoute } from './types.js';

const NEW_PROJECT_PATTERNS = [
  /\b(create|generate|make|build|start)\b.*\b(video|project|workflow)\b/i,
  /\bnew\s+(video|project)\b/i,
];

const CONTINUE_PATTERNS = [
  /\b(continue|resume|pick up|next step|where i left off)\b/i,
  /\bcarry on\b/i,
];

const MODIFY_PATTERNS = [
  /\b(regenerate|redo|retry|change|modify|replace|fix)\b/i,
  /\bupdate\b.*\b(image|video|infographic|placement|prompt|scene)\b/i,
];

const QUESTION_PATTERNS = [
  /^\s*(what|how|why|when|where)\b/i,
  /\b(status|progress|summary|state)\b/i,
  /\bshow me\b/i,
];

const AMBIGUOUS_PATTERNS = [
  /\b(make it better|improve|optimize this|fix this)\b/i,
  /^\s*(do it|go ahead|proceed)\s*$/i,
];

const TARGET_ITEM_PATTERN =
  /\b(?:image|video|infographic|placement|scene|phase)\s*(?:#|number\s*)?(\d+)\b/gi;

export class IntentRouter {
  classifyIntent(userInput: string, hasProject: boolean): IntentRoute {
    const input = userInput.trim();
    const lower = input.toLowerCase();
    const targetItems = this.extractTargetItems(lower);

    if (!input) {
      return this.buildRoute('ambiguous', 0.2, false, 'interactive', targetItems);
    }

    if (!hasProject && this.matchesAny(input, NEW_PROJECT_PATTERNS)) {
      return this.buildRoute('simple', 0.9, false, 'direct', targetItems);
    }

    if (this.matchesAny(input, QUESTION_PATTERNS)) {
      return this.buildRoute('question', 0.8, hasProject, hasProject ? 'analyze' : 'direct', targetItems);
    }

    if (hasProject && this.matchesAny(input, CONTINUE_PATTERNS)) {
      return this.buildRoute('continue', 0.85, true, 'analyze', targetItems);
    }

    if (hasProject && (this.matchesAny(input, MODIFY_PATTERNS) || targetItems.length > 0)) {
      return this.buildRoute('modify', 0.82, true, 'analyze', targetItems);
    }

    if (this.matchesAny(input, AMBIGUOUS_PATTERNS)) {
      return this.buildRoute('ambiguous', 0.55, false, 'interactive', targetItems);
    }

    if (hasProject) {
      return this.buildRoute('simple', 0.6, false, 'direct', targetItems);
    }

    return this.buildRoute('ambiguous', 0.4, false, 'interactive', targetItems);
  }

  private extractTargetItems(input: string): string[] {
    const targets: string[] = [];
    const matcher = new RegExp(TARGET_ITEM_PATTERN.source, TARGET_ITEM_PATTERN.flags);
    let match: RegExpExecArray | null = matcher.exec(input);
    while (match) {
      const item = match[0]?.trim();
      if (item) {
        targets.push(item);
      }
      match = matcher.exec(input);
    }
    return targets;
  }

  private matchesAny(input: string, patterns: RegExp[]): boolean {
    return patterns.some(pattern => pattern.test(input));
  }

  private buildRoute(
    intent: IntentRoute['intent'],
    confidence: number,
    requiresStateAnalysis: boolean,
    suggestedStrategy: IntentRoute['suggestedStrategy'],
    targetItems: string[]
  ): IntentRoute {
    return {
      intent,
      confidence,
      requiresStateAnalysis,
      suggestedStrategy,
      targetItems,
    };
  }
}
