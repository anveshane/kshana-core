import { WorkflowPhase } from '../../tasks/video/workflow/types.js';
import type { ContinuationPlan, ContinuationStrategy, IntentRoute, StateAnalysis } from './types.js';

export class ContinuationPlanner {
  createContinuationPlan(stateAnalysis: StateAnalysis, intentRoute: IntentRoute): ContinuationPlan {
    if (!stateAnalysis.hasProject) {
      return {
        strategy: 'resume_phase',
        specificTasks: ['No active project found. Create or load a project before continuing.'],
        checkpoints: ['Confirm the correct workspace/project path first.'],
        blockers: stateAnalysis.blockers,
        guidanceText: 'Project state is unavailable. Pause execution and establish project context.',
      };
    }

    const strategy = this.pickStrategy(stateAnalysis, intentRoute);
    const specificTasks = this.buildSpecificTasks(strategy, stateAnalysis, intentRoute);
    const checkpoints = this.buildCheckpoints(strategy, stateAnalysis);
    const guidanceText = this.buildGuidance(strategy, stateAnalysis, intentRoute, specificTasks);

    return {
      strategy,
      specificTasks,
      checkpoints,
      blockers: stateAnalysis.blockers,
      guidanceText,
    };
  }

  private pickStrategy(stateAnalysis: StateAnalysis, intentRoute: IntentRoute): ContinuationStrategy {
    if (stateAnalysis.blockers.length > 0) {
      return 'unblock';
    }

    if (intentRoute.intent === 'modify' && intentRoute.targetItems.length > 0) {
      return 'retry_failed';
    }

    const completion = stateAnalysis.completion;
    if (completion.total > 0 && completion.percentage >= 100) {
      return 'move_forward';
    }

    if (completion.completed > 0 && completion.pending > 0) {
      return 'complete_partial';
    }

    return 'resume_phase';
  }

  private buildSpecificTasks(
    strategy: ContinuationStrategy,
    stateAnalysis: StateAnalysis,
    intentRoute: IntentRoute
  ): string[] {
    switch (strategy) {
      case 'unblock':
        return stateAnalysis.missingDependencies.map(dep => `Resolve dependency: ${dep.filePath}`);
      case 'move_forward':
        return ['Phase appears complete. Validate outputs and transition to the next phase.'];
      case 'complete_partial':
        return stateAnalysis.completion.missingItems.map(item => `Complete ${item}`);
      case 'retry_failed':
        return intentRoute.targetItems.map(item => `Regenerate or adjust ${item}`);
      case 'resume_phase':
      default:
        return stateAnalysis.actionableRemainingWork;
    }
  }

  private buildCheckpoints(strategy: ContinuationStrategy, stateAnalysis: StateAnalysis): string[] {
    const phase = stateAnalysis.currentPhase;
    const checkpoints: string[] = [];

    if (strategy === 'unblock') {
      checkpoints.push('Do not start expensive generation until blockers are resolved.');
    }

    if (strategy === 'complete_partial' || strategy === 'retry_failed') {
      checkpoints.push('After each generated asset, verify it was registered in agent/manifest.json.');
      checkpoints.push('Avoid re-generating already completed placements unless explicitly requested.');
    }

    if (strategy === 'move_forward') {
      checkpoints.push('Confirm deliverables exist before calling transition_phase.');
    }

    if (phase === WorkflowPhase.VIDEO_PLACEMENT) {
      checkpoints.push('Ensure video placements do not conflict with image/infographic segments.');
    }

    if (checkpoints.length === 0) {
      checkpoints.push('Proceed with the current phase instructions and keep project state consistent.');
    }

    return checkpoints;
  }

  private buildGuidance(
    strategy: ContinuationStrategy,
    stateAnalysis: StateAnalysis,
    intentRoute: IntentRoute,
    specificTasks: string[]
  ): string {
    const phase = stateAnalysis.currentPhase ?? 'unknown_phase';
    const base = `Intent=${intentRoute.intent}, phase=${phase}, strategy=${strategy}.`;

    if (strategy === 'unblock') {
      return `${base} Resolve blockers first, then continue phase execution.`;
    }

    if (specificTasks.length > 0) {
      return `${base} Prioritize only the listed tasks for this turn.`;
    }

    return `${base} Follow normal phase workflow.`;
  }
}
