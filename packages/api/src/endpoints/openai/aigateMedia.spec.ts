import {
  createAigateMediaFetch,
  normalizeAigateMediaPayload,
  transformAigateMediaSseLine,
} from './aigateMedia';

describe('AIGate media response normalization', () => {
  it('moves chat completion images and videos into safe text markers', () => {
    const payload = normalizeAigateMediaPayload({
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'done',
            images: [{ image_url: { url: 'data:image/png;base64,abc' } }],
            videos: [{ video_url: { url: 'https://aigate.shop/v1/media/video.mp4' } }],
          },
        },
      ],
    });

    expect(payload.choices[0].message.content).toContain('done');
    expect(payload.choices[0].message.content).toContain('[[AIGATE_MEDIA:image:');
    expect(payload.choices[0].message.content).toContain('[[AIGATE_MEDIA:video:');
  });

  it('normalizes streaming media without touching the SSE envelope', () => {
    const line = transformAigateMediaSseLine(
      'data: {"choices":[{"delta":{"videos":[{"video_url":{"url":"https://aigate.shop/v.mp4"}}]}}]}',
    );

    expect(JSON.parse(line.slice(6)).choices[0].delta.content).toContain('[[AIGATE_MEDIA:video:');
    expect(transformAigateMediaSseLine('data: [DONE]')).toBe('data: [DONE]');
  });

  it('wraps b64_json images in a data URL', () => {
    const payload = normalizeAigateMediaPayload<{
      choices: Array<{
        message: { images: Array<{ b64_json: string }>; content?: unknown };
      }>;
    }>({
      choices: [{ message: { images: [{ b64_json: 'abc' }] } }],
    });

    expect(payload.choices[0].message.content).toContain('[[AIGATE_MEDIA:image:');
  });

  it('uses video/mp4 for base64 videos without an explicit mime type', () => {
    const payload = normalizeAigateMediaPayload({
      choices: [{ message: { videos: [{ b64_json: 'abc' }] } }],
    });

    expect(payload.choices[0].message.content).toContain('[[AIGATE_MEDIA:video:');
  });

  it('drops stale content-length after rewriting a JSON response', async () => {
    const fetch = createAigateMediaFetch(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'done', images: [{ b64_json: 'abc' }] } }],
          }),
          {
            headers: {
              'content-type': 'application/json',
              'content-length': '1',
            },
          },
        ),
      ),
    );

    const response = await fetch('https://api.aigate.shop/v1/chat/completions');
    expect(response.headers.get('content-length')).toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      choices: [{ message: { content: expect.stringContaining('[[AIGATE_MEDIA:image:') } }],
    });
  });

  it('does not change ordinary text responses', () => {
    const payload = normalizeAigateMediaPayload({
      choices: [{ delta: { content: 'hello' } }],
    });

    expect(payload.choices[0].delta.content).toBe('hello');
  });
});
