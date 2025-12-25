/**
 * Prompt Evaluation Tests
 *
 * These tests run prompt evaluations against eval fixtures.
 * By default, uses mock LLM client for fast, deterministic tests.
 * Set EVAL_MODE=live to run against actual LLM.
 *
 * For live mode, configure your LLM provider in .env:
 *   - LLM_PROVIDER=lmstudio (requires LM Studio running locally)
 *   - LLM_PROVIDER=openai (requires OPENAI_API_KEY)
 *   - LLM_PROVIDER=gemini (requires GOOGLE_API_KEY)
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll } from 'vitest';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  PromptEvaluator,
  MockEvalLLMClient,
  type EvalFixture,
} from '../../src/testing/PromptEvaluator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVAL_MODE = process.env['EVAL_MODE'] ?? 'mock';
// Longer timeout for live LLM calls (60 seconds per test)
const LIVE_TEST_TIMEOUT = 60000;

/**
 * Create a mock client that handles classification prompts correctly.
 * Uses exact phrase matching for approve responses.
 */
function createClassificationMockClient(): MockEvalLLMClient {
  const mock = new MockEvalLLMClient();

  // Plan approval - exact phrases only (surrounded by whitespace/start/end)
  // These are EXACT responses that should be classified as APPROVE
  const exactApproveResponses = [
    'yes', 'ok', 'proceed', 'looks good', 'go ahead', 'lgtm',
    'accept', 'start', 'continue', 'y', '1', 'generate', 'create it', 'make it',
  ];

  // Use exact match patterns by matching the user_response value in the prompt
  for (const phrase of exactApproveResponses) {
    // Match the exact response within the <user_response> tags
    mock.when(`<user_response>\n${phrase}\n</user_response>`, 'APPROVE');
  }

  // Default to FEEDBACK for anything else
  mock.setDefault('FEEDBACK');

  return mock;
}

/**
 * Create a mock client for story validation.
 * Uses patterns specific to the user input section (wrapped in """).
 */
function createValidationMockClient(): MockEvalLLMClient {
  const mock = new MockEvalLLMClient();

  // Valid story patterns - must include the """ wrapper to match user input section
  // These are checked first so story inputs get classified as VALID
  const validStoryInputs = [
    '"""\nA detective',
    '"""\nMake a horror story',
    '"""\nA young wizard',
    '"""\nA robot learns',
    '"""\nAn elderly woman',
    '"""\nA spy must',
    '"""\nCan you make a video based on Little Red Riding Hood',
  ];
  for (const pattern of validStoryInputs) {
    mock.when(pattern, 'VALID');
  }

  // Invalid patterns - also include """ wrapper for specificity
  const invalidInputPatterns = [
    '"""\nThe meaning of life',
    '"""\nHow does video',
    '"""\nThe transformer architecture',
    '"""\nSubscribe to',
    '"""\nasdfasdf',
    '"""\ntest123',
    '"""\nhello',
    '"""\nStories are powerful',
    '"""\nWhat if we could',
    '"""\nAccording to recent',
    '"""\n...',
  ];

  for (const pattern of invalidInputPatterns) {
    mock.when(pattern, 'INVALID: Not a valid story idea');
  }

  // Default to INVALID for anything else
  mock.setDefault('INVALID: Not a valid story idea');

  return mock;
}

const isLiveMode = EVAL_MODE === 'live';

describe('Prompt Evaluations', () => {
  let evaluator: PromptEvaluator;

  describe('Classification: Plan Approval', () => {
    let fixture: EvalFixture;

    beforeAll(() => {
      // In live mode, use real LLM client; in mock mode, use mock client
      if (isLiveMode) {
        evaluator = new PromptEvaluator(undefined, __dirname);
      } else {
        const mockClient = createClassificationMockClient();
        evaluator = new PromptEvaluator(mockClient, __dirname);
      }
      fixture = evaluator.loadFixture('classification/plan-approval.eval.json');
    });

    it('should have all required test cases', () => {
      expect(fixture.cases.length).toBeGreaterThan(10);
      const approveCount = fixture.cases.filter(c => c.tags?.includes('approve')).length;
      const feedbackCount = fixture.cases.filter(c => c.tags?.includes('feedback')).length;
      expect(approveCount).toBeGreaterThan(5);
      expect(feedbackCount).toBeGreaterThan(5);
    });

    it('should correctly classify approval responses', async () => {
      const approveCases = fixture.cases.filter(c => c.tags?.includes('approve'));

      for (const evalCase of approveCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);

    it('should correctly classify feedback responses', async () => {
      const feedbackCases = fixture.cases.filter(c => c.tags?.includes('feedback'));

      for (const evalCase of feedbackCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);
  });

  describe('Classification: Image Approval', () => {
    let fixture: EvalFixture;

    beforeAll(() => {
      if (isLiveMode) {
        evaluator = new PromptEvaluator(undefined, __dirname);
      } else {
        const mockClient = createClassificationMockClient();
        evaluator = new PromptEvaluator(mockClient, __dirname);
      }
      fixture = evaluator.loadFixture('classification/image-approval.eval.json');
    });

    it('should have all required test cases', () => {
      expect(fixture.cases.length).toBeGreaterThan(10);
    });

    it('should correctly classify approval responses', async () => {
      const approveCases = fixture.cases.filter(c => c.tags?.includes('approve'));

      for (const evalCase of approveCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);

    it('should correctly classify feedback responses', async () => {
      const feedbackCases = fixture.cases.filter(c => c.tags?.includes('feedback'));

      for (const evalCase of feedbackCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);
  });

  describe('Validation: Story Input', () => {
    let fixture: EvalFixture;

    beforeAll(() => {
      if (isLiveMode) {
        evaluator = new PromptEvaluator(undefined, __dirname);
      } else {
        const mockClient = createValidationMockClient();
        evaluator = new PromptEvaluator(mockClient, __dirname);
      }
      fixture = evaluator.loadFixture('validation/story-input.eval.json');
    });

    it('should have all required test cases', () => {
      expect(fixture.cases.length).toBeGreaterThan(10);
      const validCount = fixture.cases.filter(c => c.tags?.includes('valid')).length;
      const invalidCount = fixture.cases.filter(c => c.tags?.includes('invalid')).length;
      expect(validCount).toBeGreaterThan(5);
      expect(invalidCount).toBeGreaterThan(5);
    });

    it('should correctly identify valid story inputs', async () => {
      const validCases = fixture.cases.filter(c => c.tags?.includes('valid'));

      for (const evalCase of validCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);

    it('should correctly reject invalid inputs', async () => {
      const invalidCases = fixture.cases.filter(c => c.tags?.includes('invalid'));

      for (const evalCase of invalidCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);
  });

  describe('Workflow: Context Usage', () => {
    let fixture: EvalFixture;

    /**
     * Create a mock client for context usage tests.
     * Returns appropriate tool calls based on the phase context.
     */
    function createContextUsageMockClient(): MockEvalLLMClient {
      const mock = new MockEvalLLMClient();

      // Plot phase: use $original_input
      mock.when('Plot Development', JSON.stringify({
        tool_calls: [{
          name: 'Task',
          arguments: {
            subagent_type: 'content-creator',
            content_type: 'plot',
            task: 'Create plot outline',
            context_refs: ['$original_input']
          }
        }]
      }));

      // Story phase: use $plot
      mock.when('Story Development', JSON.stringify({
        tool_calls: [{
          name: 'Task',
          arguments: {
            subagent_type: 'content-creator',
            content_type: 'story',
            task: 'Create full story',
            context_refs: ['$plot']
          }
        }]
      }));

      // Characters/Settings phase - Setting: use $story
      // Check for "setting description" first (more specific)
      mock.when('setting description', JSON.stringify({
        tool_calls: [{
          name: 'Task',
          arguments: {
            subagent_type: 'content-creator',
            content_type: 'setting',
            task: 'Create setting description',
            context_refs: ['$story']
          }
        }]
      }));

      // Characters/Settings phase - Character: use $story
      mock.when('Character & Setting Descriptions', JSON.stringify({
        tool_calls: [{
          name: 'Task',
          arguments: {
            subagent_type: 'content-creator',
            content_type: 'character',
            task: 'Create character profile',
            context_refs: ['$story']
          }
        }]
      }));

      // Scenes phase: use $story
      mock.when('Scene Breakdown', JSON.stringify({
        tool_calls: [{
          name: 'Task',
          arguments: {
            subagent_type: 'content-creator',
            content_type: 'scene',
            task: 'Create scene description',
            context_refs: ['$story']
          }
        }]
      }));

      // Image phases: use read_project
      mock.when('Reference Images', JSON.stringify({
        tool_calls: [
          { name: 'read_project', arguments: {} },
          {
            name: 'Task',
            arguments: {
              subagent_type: 'image-generator',
              task: 'Generate reference image'
            }
          }
        ]
      }));

      mock.when('Scene Image', JSON.stringify({
        tool_calls: [
          { name: 'read_project', arguments: {} },
          {
            name: 'Task',
            arguments: {
              subagent_type: 'image-generator',
              task: 'Generate scene image'
            }
          }
        ]
      }));

      // Video phase: use read_project
      mock.when('Video Generation', JSON.stringify({
        tool_calls: [
          { name: 'read_project', arguments: {} },
          {
            name: 'Task',
            arguments: {
              subagent_type: 'video-assembler',
              task: 'Generate video clip'
            }
          }
        ]
      }));

      // Default fallback
      mock.setDefault(JSON.stringify({
        tool_calls: [{
          name: 'Task',
          arguments: {
            subagent_type: 'content-creator',
            content_type: 'character',
            task: 'Create character profile',
            context_refs: ['$story']
          }
        }]
      }));

      return mock;
    }

    beforeAll(() => {
      if (isLiveMode) {
        evaluator = new PromptEvaluator(undefined, __dirname);
      } else {
        const mockClient = createContextUsageMockClient();
        evaluator = new PromptEvaluator(mockClient, __dirname);
      }
      fixture = evaluator.loadFixture('workflow/context-usage.eval.json');
    });

    it('should have context usage test cases for all phases', () => {
      expect(fixture.cases.length).toBeGreaterThan(5);
      const phases = ['plot', 'story', 'character', 'setting', 'scene', 'image', 'video'];
      for (const phase of phases) {
        const phaseCases = fixture.cases.filter(c => c.tags?.includes(phase) || c.tags?.includes(`${phase}-source`));
        expect(phaseCases.length, `Should have test cases for ${phase}`).toBeGreaterThan(0);
      }
    });

    it('PLOT phase should use $original_input', async () => {
      const plotCases = fixture.cases.filter(c => c.tags?.includes('original-input'));
      for (const evalCase of plotCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);

    it('STORY phase should use $plot (not $original_input)', async () => {
      const storyCases = fixture.cases.filter(c => c.tags?.includes('plot-source'));
      for (const evalCase of storyCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: Task should use $plot, not $original_input. ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);

    it('CHARACTERS_SETTINGS phase should use $story', async () => {
      const charSettingCases = fixture.cases.filter(c => c.tags?.includes('story-source'));
      for (const evalCase of charSettingCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: Task should use $story. ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);

    it('Later phases should use read_project (not context_refs)', async () => {
      const projectDataCases = fixture.cases.filter(c => c.tags?.includes('project-data'));
      for (const evalCase of projectDataCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: Should use read_project for approved data. ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);
  });

  describe('Workflow: Plan Mode Usage', () => {
    let fixture: EvalFixture;

    /**
     * Create a mock client for plan mode tests.
     * Returns appropriate tool calls based on project state.
     *
     * The patterns must match strings that actually appear in the rendered workflow.md prompt.
     * Context fields like phase_display_name get inserted into the template.
     */
    function createPlanModeMockClient(): MockEvalLLMClient {
      const mock = new MockEvalLLMClient();

      // New project (phase is null): "Current Phase**: null" appears in rendered prompt
      mock.when('Current Phase**: null', JSON.stringify({
        tool_calls: [{ name: 'EnterPlanMode', arguments: {} }]
      }));

      // In plan mode, plan created, needs approval - match on task text
      mock.when('Present it to the user for approval', JSON.stringify({
        tool_calls: [{
          name: 'AskUserQuestion',
          arguments: {
            question: 'Ready to proceed with this plan?',
            options: [{ label: 'Approve and proceed' }, { label: 'Modify' }]
          }
        }]
      }));

      // User approved the plan - match on "call ExitPlanMode" in phase_instructions
      mock.when('call ExitPlanMode', JSON.stringify({
        tool_calls: [{ name: 'ExitPlanMode', arguments: {} }]
      }));

      // Phase completion with user approval - match on "user_approved_content" and "Mark this phase complete"
      mock.when('Mark this phase complete', JSON.stringify({
        tool_calls: [{
          name: 'update_planner_stage',
          arguments: { stage: 'complete' }
        }]
      }));

      // Plot phase complete, need to transition - match on "planner_stage": "complete" and "Transition to"
      mock.when('Transition to the story phase', JSON.stringify({
        tool_calls: [{
          name: 'transition_phase',
          arguments: { next_phase: 'story' }
        }]
      }));

      // Plot phase planning (not completion): use Task
      mock.when('Plot Development', JSON.stringify({
        tool_calls: [{
          name: 'Task',
          arguments: {
            subagent_type: 'content-creator',
            task: 'Create plot outline'
          }
        }]
      }));

      // Story phase: use Task
      mock.when('Story Development', JSON.stringify({
        tool_calls: [{
          name: 'Task',
          arguments: {
            subagent_type: 'content-creator',
            task: 'Create full story'
          }
        }]
      }));

      // Characters phase: use Task
      mock.when('Character & Setting Descriptions', JSON.stringify({
        tool_calls: [{
          name: 'Task',
          arguments: {
            subagent_type: 'content-creator',
            task: 'Create character profile'
          }
        }]
      }));

      // Image phase: use Task
      mock.when('Reference Images', JSON.stringify({
        tool_calls: [{
          name: 'Task',
          arguments: {
            subagent_type: 'image-generator',
            task: 'Generate reference image'
          }
        }]
      }));

      // Video phase: use Task
      mock.when('Video Generation', JSON.stringify({
        tool_calls: [{
          name: 'Task',
          arguments: {
            subagent_type: 'video-assembler',
            task: 'Generate video clip'
          }
        }]
      }));

      // Existing project with progress: use read_project
      mock.when('Resume work on', JSON.stringify({
        tool_calls: [{ name: 'read_project', arguments: {} }]
      }));

      // Default: Task call (no plan mode tools)
      mock.setDefault(JSON.stringify({
        tool_calls: [{
          name: 'Task',
          arguments: {
            subagent_type: 'content-creator',
            task: 'Work on current phase'
          }
        }]
      }));

      return mock;
    }

    beforeAll(() => {
      if (isLiveMode) {
        evaluator = new PromptEvaluator(undefined, __dirname);
      } else {
        const mockClient = createPlanModeMockClient();
        evaluator = new PromptEvaluator(mockClient, __dirname);
      }
      fixture = evaluator.loadFixture('workflow/plan-mode.eval.json');
    });

    it('should have plan mode test cases for all scenarios', () => {
      expect(fixture.cases.length).toBeGreaterThan(8);
      const newProjectCases = fixture.cases.filter(c => c.tags?.includes('new-project'));
      const workflowCases = fixture.cases.filter(c => c.tags?.includes('workflow'));
      expect(newProjectCases.length).toBeGreaterThan(0);
      expect(workflowCases.length).toBeGreaterThan(5);
    });

    it('NEW project should call EnterPlanMode', async () => {
      const newProjectCases = fixture.cases.filter(c => c.tags?.includes('new-project') && c.tags?.includes('enter'));
      for (const evalCase of newProjectCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);

    it('After plan approval should call ExitPlanMode', async () => {
      const exitCases = fixture.cases.filter(c => c.tags?.includes('exit') && c.tags?.includes('approved'));
      for (const evalCase of exitCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);

    it('Workflow phases should NOT call EnterPlanMode or ExitPlanMode', async () => {
      const negativeCases = fixture.cases.filter(c => c.tags?.includes('workflow') && c.tags?.includes('negative'));
      for (const evalCase of negativeCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: Should NOT call plan mode tools during workflow. ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);

    it('Phase completion should use update_planner_stage', async () => {
      const stageUpdateCases = fixture.cases.filter(c => c.tags?.includes('stage-update'));
      for (const evalCase of stageUpdateCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: Should use update_planner_stage. ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);

    it('Phase transitions should use transition_phase', async () => {
      const transitionCases = fixture.cases.filter(c => c.tags?.includes('transition'));
      for (const evalCase of transitionCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: Should use transition_phase. ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);

    it('Existing project resume should NOT call EnterPlanMode', async () => {
      const resumeCases = fixture.cases.filter(c => c.tags?.includes('resume'));
      for (const evalCase of resumeCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: Should NOT call EnterPlanMode for existing project. ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);
  });

  describe('Workflow: Characters & Settings Individual Files', () => {
    let fixture: EvalFixture;

    /**
     * Create a mock client for characters-settings tests.
     * Returns appropriate tool calls that create individual files (not bundled).
     */
    function createCharactersSettingsMockClient(): MockEvalLLMClient {
      const mock = new MockEvalLLMClient();

      // Character creation - should use individual file paths
      mock.when('character profile for Kira', JSON.stringify({
        tool_calls: [{
          name: 'Task',
          arguments: {
            subagent_type: 'content-creator',
            content_type: 'character',
            task: 'Create detailed character profile for Kira',
            output_file: 'characters/kira.md',
            context_refs: ['$story']
          }
        }]
      }));

      mock.when('character profile for Daniel', JSON.stringify({
        tool_calls: [{
          name: 'Task',
          arguments: {
            subagent_type: 'content-creator',
            content_type: 'character',
            task: 'Create detailed character profile for Daniel',
            output_file: 'characters/daniel.md',
            context_refs: ['$story']
          }
        }]
      }));

      mock.when('character profile for Sarah', JSON.stringify({
        tool_calls: [{
          name: 'Task',
          arguments: {
            subagent_type: 'content-creator',
            content_type: 'character',
            task: 'Create detailed character profile for Sarah',
            output_file: 'characters/sarah.md',
            context_refs: ['$story']
          }
        }]
      }));

      mock.when('Commander Rex', JSON.stringify({
        tool_calls: [{
          name: 'Task',
          arguments: {
            subagent_type: 'content-creator',
            content_type: 'character',
            task: 'Create character profile for Commander Rex',
            output_file: 'characters/commander_rex.md',
            context_refs: ['$story']
          }
        }]
      }));

      mock.when('profile for Elena', JSON.stringify({
        tool_calls: [{
          name: 'Task',
          arguments: {
            subagent_type: 'content-creator',
            content_type: 'character',
            task: 'Create character profile for Elena',
            output_file: 'characters/elena.md',
            context_refs: ['$story']
          }
        }]
      }));

      // Setting creation - should use individual file paths
      mock.when('setting description for the Ancient Forest', JSON.stringify({
        tool_calls: [{
          name: 'Task',
          arguments: {
            subagent_type: 'content-creator',
            content_type: 'setting',
            task: 'Create detailed setting description for the Ancient Forest',
            output_file: 'settings/ancient_forest.md',
            context_refs: ['$story']
          }
        }]
      }));

      mock.when('setting description for the Train Station', JSON.stringify({
        tool_calls: [{
          name: 'Task',
          arguments: {
            subagent_type: 'content-creator',
            content_type: 'setting',
            task: 'Create setting description for the Train Station',
            output_file: 'settings/train_station.md',
            context_refs: ['$story']
          }
        }]
      }));

      mock.when('setting description for the Castle', JSON.stringify({
        tool_calls: [{
          name: 'Task',
          arguments: {
            subagent_type: 'content-creator',
            content_type: 'setting',
            task: 'Create setting description for the Castle',
            output_file: 'settings/castle.md',
            context_refs: ['$story']
          }
        }]
      }));

      // TodoWrite for planning - should have individual items
      mock.when('Alice, Bob, Charlie', JSON.stringify({
        tool_calls: [{
          name: 'TodoWrite',
          arguments: {
            merge: false,
            todos: [
              { id: 'char-alice', content: 'Create character: Alice', status: 'in_progress' },
              { id: 'char-bob', content: 'Create character: Bob', status: 'pending' },
              { id: 'char-charlie', content: 'Create character: Charlie', status: 'pending' }
            ]
          }
        }]
      }));

      // File extension tests - MUST use .md, NOT .json
      mock.when('character profile for Marcus', JSON.stringify({
        tool_calls: [{
          name: 'Task',
          arguments: {
            subagent_type: 'content-creator',
            content_type: 'character',
            task: 'Create character profile for Marcus',
            output_file: 'characters/marcus.md',
            context_refs: ['$story']
          }
        }]
      }));

      mock.when('setting description for the Mountain Cave', JSON.stringify({
        tool_calls: [{
          name: 'Task',
          arguments: {
            subagent_type: 'content-creator',
            content_type: 'setting',
            task: 'Create setting description for the Mountain Cave',
            output_file: 'settings/mountain_cave.md',
            context_refs: ['$story']
          }
        }]
      }));

      mock.when('character profile for Nina', JSON.stringify({
        tool_calls: [{
          name: 'Task',
          arguments: {
            subagent_type: 'content-creator',
            content_type: 'character',
            task: 'Create character profile for Nina',
            output_file: 'characters/nina.md',
            context_refs: ['$story']
          }
        }]
      }));

      mock.when('setting description for the Harbor', JSON.stringify({
        tool_calls: [{
          name: 'Task',
          arguments: {
            subagent_type: 'content-creator',
            content_type: 'setting',
            task: 'Create setting description for the Harbor',
            output_file: 'settings/harbor.md',
            context_refs: ['$story']
          }
        }]
      }));

      // Default: character creation with individual file
      mock.setDefault(JSON.stringify({
        tool_calls: [{
          name: 'Task',
          arguments: {
            subagent_type: 'content-creator',
            content_type: 'character',
            task: 'Create character profile',
            output_file: 'characters/default.md',
            context_refs: ['$story']
          }
        }]
      }));

      return mock;
    }

    beforeAll(() => {
      if (isLiveMode) {
        evaluator = new PromptEvaluator(undefined, __dirname);
      } else {
        const mockClient = createCharactersSettingsMockClient();
        evaluator = new PromptEvaluator(mockClient, __dirname);
      }
      fixture = evaluator.loadFixture('workflow/characters-settings.eval.json');
    });

    it('should have test cases for individual file creation', () => {
      expect(fixture.cases.length).toBeGreaterThan(5);
      const characterCases = fixture.cases.filter(c => c.tags?.includes('character'));
      const settingCases = fixture.cases.filter(c => c.tags?.includes('setting'));
      expect(characterCases.length).toBeGreaterThan(3);
      expect(settingCases.length).toBeGreaterThan(2);
    });

    it('Character files should be saved to characters/<name>.md', async () => {
      const charFileCases = fixture.cases.filter(
        c => c.tags?.includes('character') && c.tags?.includes('individual-file')
      );
      for (const evalCase of charFileCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: output_file should be characters/<name>.md. ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);

    it('Setting files should be saved to settings/<name>.md', async () => {
      const settingFileCases = fixture.cases.filter(
        c => c.tags?.includes('setting') && c.tags?.includes('individual-file')
      );
      for (const evalCase of settingFileCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: output_file should be settings/<name>.md. ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);

    it('Should NOT use bundled files like plans/characters.md', async () => {
      const negativeCases = fixture.cases.filter(c => c.tags?.includes('negative'));
      for (const evalCase of negativeCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: Should NOT use bundled file paths. ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);

    it('Task should be for single item, not batch creation', async () => {
      const singleItemCases = fixture.cases.filter(c => c.tags?.includes('single-item'));
      for (const evalCase of singleItemCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: Task should be for single character/setting. ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);

    it('File names should use lowercase', async () => {
      const lowercaseCases = fixture.cases.filter(c => c.tags?.includes('lowercase'));
      for (const evalCase of lowercaseCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: File path should be lowercase. ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);

    it('Should use $story as context source', async () => {
      const contextCases = fixture.cases.filter(c => c.tags?.includes('story-source'));
      for (const evalCase of contextCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: context_refs should include $story. ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);

    it('Files MUST use .md extension, NOT .json', async () => {
      const fileExtCases = fixture.cases.filter(c => c.tags?.includes('file-extension'));
      expect(fileExtCases.length).toBeGreaterThan(0);
      for (const evalCase of fileExtCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: output_file MUST use .md, NOT .json. ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);
  });

  describe('Workflow: Scenes Individual Files', () => {
    let fixture: EvalFixture;

    /**
     * Create a mock client for scenes tests.
     * Returns appropriate tool calls that create individual scene files (not bundled).
     */
    function createScenesMockClient(): MockEvalLLMClient {
      const mock = new MockEvalLLMClient();

      // Scene creation - should use individual file paths
      mock.when('scene 1', JSON.stringify({
        tool_calls: [{
          name: 'Task',
          arguments: {
            subagent_type: 'content-creator',
            content_type: 'scene',
            task: 'Create scene 1: Opening',
            output_file: 'scenes/scene_01.md',
            context_refs: ['$story']
          }
        }]
      }));

      mock.when('scene 2', JSON.stringify({
        tool_calls: [{
          name: 'Task',
          arguments: {
            subagent_type: 'content-creator',
            content_type: 'scene',
            task: 'Create scene 2: Rising action',
            output_file: 'scenes/scene_02.md',
            context_refs: ['$story']
          }
        }]
      }));

      mock.when('scene 3', JSON.stringify({
        tool_calls: [{
          name: 'Task',
          arguments: {
            subagent_type: 'content-creator',
            content_type: 'scene',
            task: 'Create scene 3: Climax',
            output_file: 'scenes/scene_03.md',
            context_refs: ['$story']
          }
        }]
      }));

      mock.when('scene 4', JSON.stringify({
        tool_calls: [{
          name: 'Task',
          arguments: {
            subagent_type: 'content-creator',
            content_type: 'scene',
            task: 'Create scene 4',
            output_file: 'scenes/scene_04.md',
            context_refs: ['$story']
          }
        }]
      }));

      mock.when('scene 5', JSON.stringify({
        tool_calls: [{
          name: 'Task',
          arguments: {
            subagent_type: 'content-creator',
            content_type: 'scene',
            task: 'Create scene 5: Resolution',
            output_file: 'scenes/scene_05.md',
            context_refs: ['$story']
          }
        }]
      }));

      mock.when('scene 6', JSON.stringify({
        tool_calls: [{
          name: 'Task',
          arguments: {
            subagent_type: 'content-creator',
            content_type: 'scene',
            task: 'Create scene 6',
            output_file: 'scenes/scene_06.md',
            context_refs: ['$story']
          }
        }]
      }));

      // TodoWrite for planning scenes
      mock.when('Opening, Inciting incident, Rising action, Climax, Resolution', JSON.stringify({
        tool_calls: [{
          name: 'TodoWrite',
          arguments: {
            merge: false,
            todos: [
              { id: 'scene-1', content: 'Create scene 1: Opening', status: 'in_progress' },
              { id: 'scene-2', content: 'Create scene 2: Inciting incident', status: 'pending' },
              { id: 'scene-3', content: 'Create scene 3: Rising action', status: 'pending' },
              { id: 'scene-4', content: 'Create scene 4: Climax', status: 'pending' },
              { id: 'scene-5', content: 'Create scene 5: Resolution', status: 'pending' }
            ]
          }
        }]
      }));

      // Scene approval - TodoWrite update
      mock.when('Scene 2 has been approved', JSON.stringify({
        tool_calls: [
          {
            name: 'update_project',
            arguments: { action: 'add_scene', data: { scene_number: 2, title: 'Rising action' } }
          },
          {
            name: 'TodoWrite',
            arguments: {
              merge: true,
              todos: [
                { id: 'scene-2', status: 'completed' },
                { id: 'scene-3', status: 'in_progress' }
              ]
            }
          }
        ]
      }));

      // Middle scene - no premature complete
      mock.when('Scene 2 of 6', JSON.stringify({
        tool_calls: [
          {
            name: 'update_project',
            arguments: { action: 'add_scene', data: { scene_number: 2 } }
          },
          {
            name: 'TodoWrite',
            arguments: {
              merge: true,
              todos: [
                { id: 'scene-2', status: 'completed' },
                { id: 'scene-3', status: 'in_progress' }
              ]
            }
          }
        ]
      }));

      // Last scene - now call complete
      mock.when('LAST scene', JSON.stringify({
        tool_calls: [
          {
            name: 'update_project',
            arguments: { action: 'add_scene', data: { scene_number: 6, title: 'Resolution' } }
          },
          {
            name: 'TodoWrite',
            arguments: { merge: true, todos: [{ id: 'scene-6', status: 'completed' }] }
          },
          {
            name: 'update_project',
            arguments: { action: 'update_planner_stage', data: { phase: 'scenes', stage: 'complete' } }
          },
          {
            name: 'update_project',
            arguments: { action: 'transition_phase', data: { next_phase: 'character_setting_images' } }
          }
        ]
      }));

      // Scene 3 register
      mock.when('Scene 3: Rising Action has been approved', JSON.stringify({
        tool_calls: [{
          name: 'update_project',
          arguments: { action: 'add_scene', data: { scene_number: 3, title: 'Rising Action' } }
        }]
      }));

      // Scene 4 todo update
      mock.when('Scene 4 approved', JSON.stringify({
        tool_calls: [{
          name: 'TodoWrite',
          arguments: {
            merge: true,
            todos: [
              { id: 'scene-4', status: 'completed' },
              { id: 'scene-5', status: 'in_progress' }
            ]
          }
        }]
      }));

      // Default: scene creation with individual file
      mock.setDefault(JSON.stringify({
        tool_calls: [{
          name: 'Task',
          arguments: {
            subagent_type: 'content-creator',
            content_type: 'scene',
            task: 'Create scene',
            output_file: 'scenes/scene_01.md',
            context_refs: ['$story']
          }
        }]
      }));

      return mock;
    }

    beforeAll(() => {
      if (isLiveMode) {
        evaluator = new PromptEvaluator(undefined, __dirname);
      } else {
        const mockClient = createScenesMockClient();
        evaluator = new PromptEvaluator(mockClient, __dirname);
      }
      fixture = evaluator.loadFixture('workflow/scenes.eval.json');
    });

    it('should have test cases for individual scene file creation', () => {
      expect(fixture.cases.length).toBeGreaterThan(5);
      const sceneCases = fixture.cases.filter(c => c.tags?.includes('scene'));
      expect(sceneCases.length).toBeGreaterThan(5);
    });

    it('Scene files should be saved to scenes/scene_XX.md', async () => {
      const sceneFileCases = fixture.cases.filter(
        c => c.tags?.includes('scene') && c.tags?.includes('individual-file')
      );
      for (const evalCase of sceneFileCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: output_file should be scenes/scene_XX.md. ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);

    it('Should NOT use bundled files like plans/scenes.md', async () => {
      const noBundledCases = fixture.cases.filter(c => c.tags?.includes('no-bundled-file'));
      for (const evalCase of noBundledCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: Should NOT use plans/scenes.md. ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);

    it('Task should be for single scene, not batch creation', async () => {
      const singleItemCases = fixture.cases.filter(c => c.tags?.includes('single-item') || c.tags?.includes('no-batch'));
      for (const evalCase of singleItemCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: Task should be for single scene. ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);

    it('Scene file names should use numbered convention', async () => {
      const numberedCases = fixture.cases.filter(c => c.tags?.includes('numbered'));
      for (const evalCase of numberedCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: File path should use numbered naming. ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);

    it('Should use $story as context source', async () => {
      const contextCases = fixture.cases.filter(c => c.tags?.includes('story-source'));
      for (const evalCase of contextCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: context_refs should include $story. ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);

    it('Scene files MUST use .md extension, NOT .json', async () => {
      const fileExtCases = fixture.cases.filter(c => c.tags?.includes('file-extension'));
      expect(fileExtCases.length).toBeGreaterThan(0);
      for (const evalCase of fileExtCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: output_file MUST use .md, NOT .json. ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);

    it('Task description should specify scene number', async () => {
      const sceneNumCases = fixture.cases.filter(c => c.tags?.includes('scene-number'));
      for (const evalCase of sceneNumCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: Task should mention specific scene number. ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);

    it('Should call TodoWrite after scene approval', async () => {
      const todoUpdateCases = fixture.cases.filter(c => c.tags?.includes('todo-update'));
      expect(todoUpdateCases.length).toBeGreaterThan(0);
      for (const evalCase of todoUpdateCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: Should call TodoWrite after approval. ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);

    it('Should call add_scene after scene approval', async () => {
      const registerCases = fixture.cases.filter(c => c.tags?.includes('register'));
      for (const evalCase of registerCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: Should register scene with add_scene. ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);

    it('Should call update_planner_stage complete ONLY after last scene', async () => {
      const lastSceneCases = fixture.cases.filter(c => c.tags?.includes('last-scene'));
      for (const evalCase of lastSceneCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: Should only complete phase after last scene. ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);
  });

  describe('Workflow: Phase Completion and Transitions', () => {
    let fixture: EvalFixture;

    /**
     * Create a mock client for phase completion tests.
     * Returns appropriate tool calls for marking todos complete and transitioning phases.
     * Note: transition_phase is an ACTION within update_project, not a separate tool.
     */
    function createPhaseCompletionMockClient(): MockEvalLLMClient {
      const mock = new MockEvalLLMClient();

      // Mark final todo completed
      mock.when('Mark setting-1 as completed', JSON.stringify({
        tool_calls: [{
          name: 'TodoWrite',
          arguments: {
            merge: true,
            todos: [{ id: 'setting-1', status: 'completed' }]
          }
        }]
      }));

      // Full sequence: todo + stage + transition
      mock.when('setting: Ancient Forest', JSON.stringify({
        tool_calls: [
          {
            name: 'TodoWrite',
            arguments: { merge: true, todos: [{ id: 'setting-forest', status: 'completed' }] }
          },
          {
            name: 'update_project',
            arguments: { action: 'update_planner_stage', data: { phase: 'characters_settings', stage: 'complete' } }
          },
          {
            name: 'update_project',
            arguments: { action: 'transition_phase', data: { next_phase: 'scenes' } }
          }
        ]
      }));

      // Characters_settings to scenes transition
      mock.when('transition_phase', JSON.stringify({
        tool_calls: [
          {
            name: 'update_project',
            arguments: { action: 'update_planner_stage', data: { phase: 'characters_settings', stage: 'complete' } }
          },
          {
            name: 'update_project',
            arguments: { action: 'transition_phase', data: { next_phase: 'scenes' } }
          }
        ]
      }));

      // Plot to story transition
      mock.when('next_phase: \'story\'', JSON.stringify({
        tool_calls: [{
          name: 'update_project',
          arguments: { action: 'transition_phase', data: { next_phase: 'story' } }
        }]
      }));

      // Story to characters_settings transition
      mock.when('next_phase: \'characters_settings\'', JSON.stringify({
        tool_calls: [{
          name: 'update_project',
          arguments: { action: 'transition_phase', data: { next_phase: 'characters_settings' } }
        }]
      }));

      // Scenes to character_setting_images transition
      mock.when('next_phase: \'character_setting_images\'', JSON.stringify({
        tool_calls: [{
          name: 'update_project',
          arguments: { action: 'transition_phase', data: { next_phase: 'character_setting_images' } }
        }]
      }));

      // Default: transition via update_project
      mock.setDefault(JSON.stringify({
        tool_calls: [{
          name: 'update_project',
          arguments: { action: 'transition_phase', data: { next_phase: 'scenes' } }
        }]
      }));

      return mock;
    }

    beforeAll(() => {
      if (isLiveMode) {
        evaluator = new PromptEvaluator(undefined, __dirname);
      } else {
        const mockClient = createPhaseCompletionMockClient();
        evaluator = new PromptEvaluator(mockClient, __dirname);
      }
      fixture = evaluator.loadFixture('workflow/phase-completion.eval.json');
    });

    it('should have test cases for phase completion behaviors', () => {
      expect(fixture.cases.length).toBeGreaterThan(5);
      const phaseCompleteCases = fixture.cases.filter(c => c.tags?.includes('phase-complete'));
      const todoCases = fixture.cases.filter(c => c.tags?.includes('todo'));
      expect(phaseCompleteCases.length).toBeGreaterThan(3);
      expect(todoCases.length).toBeGreaterThan(1);
    });

    it('Should mark final todo as completed', async () => {
      const todoCases = fixture.cases.filter(c => c.tags?.includes('mark-completed'));
      for (const evalCase of todoCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: Should mark todo completed. ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);

    it('Should call update_project when phase is complete', async () => {
      // Test that update_project is called when a phase completes
      // Note: transition_phase action testing is WIP - LLM tends to default to update_planner_stage
      const phaseCompleteCases = fixture.cases.filter(
        c => c.tags?.includes('phase-complete') && !c.tags?.includes('todo') && !c.tags?.includes('negative')
      );
      for (const evalCase of phaseCompleteCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: Should call update_project. ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);

    it('Should NOT call Task after marking phase complete', async () => {
      const negativeCases = fixture.cases.filter(c => c.tags?.includes('negative'));
      for (const evalCase of negativeCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: Should NOT call Task after phase complete. ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);

    it('Should mark todo completed when item is done', async () => {
      const itemDoneCases = fixture.cases.filter(c => c.tags?.includes('item-done'));
      for (const evalCase of itemDoneCases) {
        const result = await evaluator.runCase(fixture, evalCase);
        expect(result.passed, `${evalCase.name}: Should mark todo completed. ${result.errors.join(', ')}`).toBe(true);
      }
    }, isLiveMode ? LIVE_TEST_TIMEOUT : undefined);
  });

  describe('Full Suite', () => {
    it('should discover all eval fixtures', () => {
      // Always use mock for discovery test (doesn't need LLM)
      if (!isLiveMode) {
        const mockClient = createClassificationMockClient();
        evaluator = new PromptEvaluator(mockClient, __dirname);
      }
      const fixtures = evaluator.discoverFixtures();

      expect(fixtures).toContain('classification/plan-approval.eval.json');
      expect(fixtures).toContain('classification/image-approval.eval.json');
      expect(fixtures).toContain('validation/story-input.eval.json');
      expect(fixtures).toContain('workflow/context-usage.eval.json');
      expect(fixtures).toContain('workflow/plan-mode.eval.json');
      expect(fixtures).toContain('workflow/characters-settings.eval.json');
      expect(fixtures).toContain('workflow/phase-completion.eval.json');
    });
  });
});
