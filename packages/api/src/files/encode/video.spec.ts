import { Providers } from '@librechat/agents';
import { formatVideoBlock } from './video';

describe('formatVideoBlock', () => {
  it('uses OpenAI-compatible video_url for AIGate', () => {
    expect(formatVideoBlock(Providers.OPENAI, 'AIGate', 'video/mp4', 'abc')).toEqual({
      type: 'video_url',
      video_url: { url: 'data:video/mp4;base64,abc' },
    });
  });

  it('does not enable video_url for arbitrary OpenAI endpoints', () => {
    expect(formatVideoBlock(Providers.OPENAI, 'Other', 'video/mp4', 'abc')).toBeNull();
  });
});
