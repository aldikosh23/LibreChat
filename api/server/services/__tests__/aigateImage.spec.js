const { buildAigateImageRequest, parseAigateImageResponse } = require('../aigateImage');

describe('AIGate image endpoint routing', () => {
  it('routes generation to images/generations', () => {
    expect(
      buildAigateImageRequest({ model: 'openai/gpt-image-2', prompt: 'cat', imageUrls: [] }),
    ).toEqual({
      path: 'images/generations',
      body: { model: 'openai/gpt-image-2', prompt: 'cat' },
    });
  });

  it('routes requests with images to images/edits', () => {
    expect(
      buildAigateImageRequest({
        model: 'openai/gpt-image-2',
        prompt: 'hat',
        imageUrls: ['data:image/png;base64,abc'],
      }),
    ).toEqual({
      path: 'images/edits',
      body: {
        model: 'openai/gpt-image-2',
        prompt: 'hat',
        image_urls: ['data:image/png;base64,abc'],
      },
    });
  });

  it('normalizes URL and base64 image outputs', () => {
    expect(
      parseAigateImageResponse({
        data: [{ url: 'https://aigate.shop/a.png' }, { b64_json: 'abc' }],
      }),
    ).toEqual(['https://aigate.shop/a.png', 'data:image/png;base64,abc']);
  });
});
