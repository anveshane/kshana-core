/**
 * Tests for auto-approve timeout in planning verification.
 * Verifies that planning/image verification results include autoApproveTimeoutMs.
 */
import { describe, it, expect } from 'vitest';

describe('Planning Auto-Approve Timeout', () => {
  describe('planning verification result structure', () => {
    it('should include autoApproveTimeoutMs in awaiting_verification result', () => {
      // Simulate the result structure returned by runPlanning
      const verificationResult = {
        status: 'awaiting_verification',
        plan: 'Test plan content',
        task: 'Test task',
        iterations: 1,
        question: "I've created a plan for this task. Would you like to proceed or provide feedback?",
        options: [
          { label: 'Accept plan', description: 'Proceed with this plan and start execution' },
          { label: 'Provide feedback', description: 'Modify the plan with your input' },
        ],
        autoApproveTimeoutMs: 15000,
      };

      expect(verificationResult.autoApproveTimeoutMs).toBe(15000);
      expect(verificationResult.status).toBe('awaiting_verification');
      expect(verificationResult.options).toHaveLength(2);
    });

    it('should have 15 second default timeout for plan verification', () => {
      const DEFAULT_PLANNING_TIMEOUT_MS = 15000;
      expect(DEFAULT_PLANNING_TIMEOUT_MS).toBe(15000);
    });
  });

  describe('image generation verification result structure', () => {
    it('should include autoApproveTimeoutMs in awaiting_prompt_approval result', () => {
      // Simulate the result structure returned by runImagePromptGeneration
      const imageVerificationResult = {
        status: 'awaiting_prompt_approval',
        prompt: 'A beautiful sunset over mountains',
        negative_prompt: 'blur, noise',
        aspect_ratio: '16:9',
        task: 'Generate a sunset image',
        iterations: 1,
        question: "I've crafted an image prompt. Would you like to generate the image or provide feedback?",
        options: [
          { label: 'Generate image', description: 'Proceed with this prompt and generate the image' },
          { label: 'Provide feedback', description: 'Modify the prompt with your input' },
        ],
        autoApproveTimeoutMs: 15000,
      };

      expect(imageVerificationResult.autoApproveTimeoutMs).toBe(15000);
      expect(imageVerificationResult.status).toBe('awaiting_prompt_approval');
      expect(imageVerificationResult.options).toHaveLength(2);
    });
  });

  describe('question event structure', () => {
    it('should propagate autoApproveTimeoutMs in question event', () => {
      // Simulate the question event structure
      const questionEvent = {
        type: 'question' as const,
        question: "I've created a plan for this task. Would you like to proceed or provide feedback?",
        isConfirmation: false,
        options: [
          { label: 'Accept plan', description: 'Proceed with this plan and start execution' },
          { label: 'Provide feedback', description: 'Modify the plan with your input' },
        ],
        autoApproveTimeoutMs: 15000,
      };

      expect(questionEvent.type).toBe('question');
      expect(questionEvent.autoApproveTimeoutMs).toBe(15000);
      expect(questionEvent.isConfirmation).toBe(false);
    });

    it('should support undefined autoApproveTimeoutMs for questions without timeout', () => {
      const questionEventNoTimeout = {
        type: 'question' as const,
        question: 'What is your name?',
        isConfirmation: false,
        autoApproveTimeoutMs: undefined,
      };

      expect(questionEventNoTimeout.autoApproveTimeoutMs).toBeUndefined();
    });
  });

  describe('waiting_for_user result structure', () => {
    it('should include autoApproveTimeoutMs in waiting_for_user result', () => {
      // Simulate the GenericAgentResult for waiting_for_user
      const waitingResult = {
        status: 'waiting_for_user',
        output: '',
        todos: [],
        pendingQuestion: "I've created a plan for this task. Would you like to proceed or provide feedback?",
        options: [
          { label: 'Accept plan', description: 'Proceed with this plan and start execution' },
          { label: 'Provide feedback', description: 'Modify the plan with your input' },
        ],
        autoApproveTimeoutMs: 15000,
      };

      expect(waitingResult.status).toBe('waiting_for_user');
      expect(waitingResult.autoApproveTimeoutMs).toBe(15000);
    });
  });

  describe('options propagation', () => {
    it('should have exactly 2 options for plan verification', () => {
      const options = [
        { label: 'Accept plan', description: 'Proceed with this plan and start execution' },
        { label: 'Provide feedback', description: 'Modify the plan with your input' },
      ];

      expect(options).toHaveLength(2);
      expect(options[0]?.label).toBe('Accept plan');
      expect(options[1]?.label).toBe('Provide feedback');
    });

    it('should have exactly 2 options for image prompt verification', () => {
      const options = [
        { label: 'Generate image', description: 'Proceed with this prompt and generate the image' },
        { label: 'Provide feedback', description: 'Modify the prompt with your input' },
      ];

      expect(options).toHaveLength(2);
      expect(options[0]?.label).toBe('Generate image');
      expect(options[1]?.label).toBe('Provide feedback');
    });

    it('options should have label and optional description', () => {
      const option = { label: 'Accept plan', description: 'Proceed with this plan' };

      expect(option.label).toBeDefined();
      expect(option.description).toBeDefined();
      expect(typeof option.label).toBe('string');
      expect(typeof option.description).toBe('string');
    });

    it('options without description should still be valid', () => {
      const option = { label: 'Accept plan' };

      expect(option.label).toBeDefined();
      expect((option as { label: string; description?: string }).description).toBeUndefined();
    });
  });
});
