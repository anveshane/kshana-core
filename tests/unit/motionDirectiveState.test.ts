/**
 * TDD Tests for motion directive state integration.
 *
 * Motion directive should:
 * 1. Depend on shot_image_prompt (to know what the first frame looks like)
 * 2. Receive scene state (previous → target) to describe the transition
 * 3. The delta between states IS the motion to describe
 */

import { describe, it, expect } from 'vitest';

describe('Motion directive: template dependencies', () => {
  it('shot_motion_directive depends on shot_image_prompt', async () => {
    const { narrativeTemplate } = await import('../../src/templates/narrative.js');
    const types = narrativeTemplate.artifactTypes as Record<string, any>;
    const motionType = types['shot_motion_directive'];
    expect(motionType).toBeDefined();

    const sipDep = motionType.dependencies.find((d: any) => d.artifactTypeId === 'shot_image_prompt');
    expect(sipDep).toBeDefined();
    expect(sipDep.required).toBe(true);
    expect(sipDep.scope).toBe('matching');
  });

  it('shot_motion_directive depends on scene_video_prompt', async () => {
    const { narrativeTemplate } = await import('../../src/templates/narrative.js');
    const types = narrativeTemplate.artifactTypes as Record<string, any>;
    const motionType = types['shot_motion_directive'];

    const svpDep = motionType.dependencies.find((d: any) => d.artifactTypeId === 'scene_video_prompt');
    expect(svpDep).toBeDefined();
  });

  it('shot_motion_directive does NOT depend on character/setting text (redundant with shot_image_prompt)', async () => {
    const { narrativeTemplate } = await import('../../src/templates/narrative.js');
    const types = narrativeTemplate.artifactTypes as Record<string, any>;
    const motionType = types['shot_motion_directive'];

    const charDep = motionType.dependencies.find((d: any) => d.artifactTypeId === 'character');
    const settingDep = motionType.dependencies.find((d: any) => d.artifactTypeId === 'setting');
    expect(charDep).toBeUndefined();
    expect(settingDep).toBeUndefined();
  });
});

describe('Motion directive: state context formatting', () => {
  it('buildMotionStateContext formats state delta for motion description', async () => {
    const { buildMotionStateContext, initializeSceneState } = await import('../../src/core/planner/sceneState.js');

    const prevState = initializeSceneState('scene_1', ['elena', 'marcus'], 'alley');
    prevState.shotNumber = 1;
    prevState.characters['elena'] = {
      ...prevState.characters['elena'],
      position: 'center_frame',
      pose: 'standing',
      expression: 'neutral',
      facing: 'right',
      inFrame: true,
      leftHand: 'at_side',
      rightHand: 'at_side',
      legs: 'standing',
      headTilt: 'neutral',
    };

    const targetState = { ...prevState, shotNumber: 2 };
    targetState.characters = {
      elena: { ...prevState.characters['elena'], position: 'left_frame', facing: 'camera', expression: 'alert' },
      marcus: { position: 'entering_from_right', pose: 'walking', expression: 'determined', facing: 'left', inFrame: true, leftHand: 'at_side', rightHand: 'at_side', legs: 'mid_stride', headTilt: 'neutral' },
    };

    const context = buildMotionStateContext(prevState, targetState);

    expect(context).toContain('STATE CHANGES');
    expect(context).toContain('elena');
    expect(context).toContain('marcus');
    expect(context).toContain('ENTERED');
    expect(context).toContain('MOTION');
  });

  it('buildMotionStateContext returns empty when no changes', async () => {
    const { buildMotionStateContext, initializeSceneState } = await import('../../src/core/planner/sceneState.js');

    const state = initializeSceneState('scene_1', ['elena'], 'alley');
    state.shotNumber = 1;
    state.characters['elena'].inFrame = true;

    const context = buildMotionStateContext(state, state);
    expect(context).toContain('No state changes');
  });
});
