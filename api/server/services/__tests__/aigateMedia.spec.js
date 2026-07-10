const { expandAigateMediaMarkers } = require('../aigateMedia');

function marker(kind, url) {
  return `[[AIGATE_MEDIA:${kind}:${Buffer.from(url).toString('base64url')}]]`;
}

describe('AIGate media markers', () => {
  it('restores image and video content parts', () => {
    const image = 'data:image/png;base64,abc';
    const video = 'https://aigate.shop/v1/media/video.mp4';
    const result = expandAigateMediaMarkers([
      { type: 'text', text: `done\n\n${marker('image', image)}\n\n${marker('video', video)}` },
    ]);

    expect(result).toEqual([
      { type: 'text', text: 'done\n\n' },
      { type: 'image_url', image_url: { url: image } },
      { type: 'text', text: '\n\n' },
      { type: 'video_url', video_url: { url: video } },
    ]);
  });

  it('leaves ordinary text parts unchanged', () => {
    const parts = [{ type: 'text', text: 'hello' }];
    expect(expandAigateMediaMarkers(parts)).toEqual(parts);
  });
});
