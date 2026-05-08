import { describe, expect, it } from 'vitest';
import { replaceUnresolvedLoadImages } from '../../src/services/providers/comfyui/ComfyUIProvider.js';

describe('replaceUnresolvedLoadImages', () => {
  it('replaces stale optional video frame filenames with the uploaded first frame', () => {
    const workflow = {
      '45': {
        class_type: 'LoadImage',
        inputs: { image: 'uploaded_first.png' },
      },
      '47': {
        class_type: 'LoadImage',
        inputs: { image: 'c4HD71Fv_Scene3_00001_.png' },
      },
    };

    replaceUnresolvedLoadImages(
      workflow,
      new Set(['uploaded_first.png']),
      'uploaded_first.png',
      () => {},
    );

    expect((workflow['45'].inputs as { image: string }).image).toBe('uploaded_first.png');
    expect((workflow['47'].inputs as { image: string }).image).toBe('uploaded_first.png');
  });

  it('leaves known uploaded frame filenames untouched', () => {
    const workflow = {
      '45': {
        class_type: 'LoadImage',
        inputs: { image: 'uploaded_first.png' },
      },
      '47': {
        class_type: 'LoadImage',
        inputs: { image: 'uploaded_last.png' },
      },
    };

    replaceUnresolvedLoadImages(
      workflow,
      new Set(['uploaded_first.png', 'uploaded_last.png']),
      'uploaded_first.png',
      () => {},
    );

    expect((workflow['47'].inputs as { image: string }).image).toBe('uploaded_last.png');
  });
});
