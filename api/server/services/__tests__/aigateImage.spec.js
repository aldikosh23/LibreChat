const {
  buildAigateImageRequest,
  extractAigateImageInput,
  inferAigateImagePlan,
  isAigateImageModel,
  parseAigateImagePlan,
  parseAigateImageResponse,
} = require('../aigateImage');

describe('AIGate image endpoint routing', () => {
  it('routes generation to images/generations', () => {
    expect(
      buildAigateImageRequest({
        model: 'openai/gpt-image-2',
        prompt: 'cat in 4K, 21:9',
        currentImageUrls: [],
        previousImageUrls: [],
        plan: { action: 'generate', aspectRatio: '21:9', imageSize: '4K' },
      }),
    ).toEqual({
      path: 'images/generations',
      body: {
        model: 'openai/gpt-image-2',
        prompt: 'cat in 4K, 21:9',
        image_config: { aspect_ratio: '21:9', image_size: '4K' },
      },
    });
  });

  it('routes current image attachments to images/edits', () => {
    expect(
      buildAigateImageRequest({
        model: 'openai/gpt-image-2',
        prompt: 'hat',
        currentImageUrls: ['data:image/png;base64,abc'],
        previousImageUrls: [],
        plan: { action: 'generate', aspectRatio: '1:1', imageSize: '2K' },
      }),
    ).toEqual({
      path: 'images/edits',
      body: {
        model: 'openai/gpt-image-2',
        prompt: 'hat',
        images: [{ image_url: 'data:image/png;base64,abc' }],
        size: '1024x1024',
      },
    });
  });

  it('edits the latest prior image only when the planner chooses edit', () => {
    expect(
      buildAigateImageRequest({
        model: 'openai/gpt-image-2',
        prompt: 'make the previous image darker',
        currentImageUrls: [],
        previousImageUrls: ['https://aigate.shop/media/cat.png'],
        plan: { action: 'edit', aspectRatio: '16:9', imageSize: '2K' },
      }),
    ).toEqual({
      path: 'images/edits',
      body: {
        model: 'openai/gpt-image-2',
        prompt: 'make the previous image darker',
        images: [{ image_url: 'https://aigate.shop/media/cat.png' }],
        size: '1536x1024',
      },
    });
  });

  it('keeps a new generation separate from images already in chat history', () => {
    expect(
      buildAigateImageRequest({
        model: 'openai/gpt-image-2',
        prompt: 'generate a new dog',
        currentImageUrls: [],
        previousImageUrls: ['https://aigate.shop/media/cat.png'],
        plan: { action: 'generate' },
      }),
    ).toEqual({
      path: 'images/generations',
      body: { model: 'openai/gpt-image-2', prompt: 'generate a new dog' },
    });
  });

  it('recognizes AIGate image models behind an OpenAI-compatible provider', () => {
    expect(isAigateImageModel('openAI', 'openai/gpt-image-2')).toBe(true);
    expect(isAigateImageModel('AIGate', 'openai/gpt-5.6-sol')).toBe(false);
  });

  it('extracts current and latest previous image inputs separately', () => {
    const input = extractAigateImageInput([
      {
        _getType: () => 'ai',
        content: [{ type: 'image_url', image_url: { url: 'https://aigate.shop/cat.png' } }],
      },
      { _getType: () => 'human', content: 'make that image darker' },
    ]);

    expect(input).toEqual({
      prompt: 'make that image darker',
      currentImageUrls: [],
      previousImageUrls: ['https://aigate.shop/cat.png'],
    });
  });

  it('parses a strict planner response and falls back to prompt hints', () => {
    expect(
      parseAigateImagePlan(
        '```json\n{"action":"generate","aspect_ratio":"21:9","image_size":"4K","quality":"high"}\n```',
      ),
    ).toEqual({ action: 'generate', aspectRatio: '21:9', imageSize: '4K', quality: 'high' });
    expect(inferAigateImagePlan('make a new cinematic cat, 4k 21:9', false, true)).toEqual({
      action: 'generate',
      aspectRatio: '21:9',
      imageSize: '4K',
    });
    expect(inferAigateImagePlan('подправь эту картинку', false, true).action).toBe('edit');
  });

  it('normalizes URL and base64 image outputs', () => {
    expect(
      parseAigateImageResponse({
        data: [{ url: 'https://aigate.shop/a.png' }, { b64_json: 'abc' }],
      }),
    ).toEqual(['https://aigate.shop/a.png', 'data:image/png;base64,abc']);
  });
});
