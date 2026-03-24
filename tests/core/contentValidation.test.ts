import { describe, expect, it } from 'vitest';

import {
  extractHeadingName,
  validateGeneratedSceneContent,
  validateGeneratedSceneMotionPromptContent,
} from '../../src/core/contentValidation.js';

describe('contentValidation', () => {
  it('rejects scene content that is really tool chatter', () => {
    expect(
      validateGeneratedSceneContent(
        'I need to check for reference image paths before generating the scene content.\n\nread_project()',
        2
      )
    ).toEqual({
      valid: false,
      error: 'scene content contains tool-chatter text instead of a scene breakdown',
    });
  });

  it('rejects scene content that is actually motion prompt JSON', () => {
    expect(
      validateGeneratedSceneContent(
        JSON.stringify({
          sceneNumber: 3,
          sceneTitle: 'The Revelation',
          shots: [{ shotNumber: 1, duration: 5 }],
        }),
        3
      )
    ).toEqual({
      valid: false,
      error: 'scene content looks like scene_video_prompt JSON and cannot be saved as a scene',
    });
  });

  it('accepts valid motion prompt JSON', () => {
    expect(
      validateGeneratedSceneMotionPromptContent(
        JSON.stringify({
          sceneNumber: 1,
          sceneTitle: 'The Descent',
          shots: [{ shotNumber: 1, duration: 4, prompt: 'Marcus descends.' }],
        })
      )
    ).toEqual({
      valid: true,
      content: JSON.stringify({
        sceneNumber: 1,
        sceneTitle: 'The Descent',
        shots: [{ shotNumber: 1, duration: 4, prompt: 'Marcus descends.' }],
      }),
    });
  });

  it('normalizes profile headings to stable names', () => {
    expect(extractHeadingName('# Character Profile: The Elder')).toBe('The Elder');
    expect(extractHeadingName('# Setting Profile: The Descent Tunnel')).toBe(
      'The Descent Tunnel'
    );
  });
});
