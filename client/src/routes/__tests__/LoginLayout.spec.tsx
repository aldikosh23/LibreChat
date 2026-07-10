import { getAigateSsoRedirect } from '~/routes/Layouts/Login';

describe('LoginLayout AIGate SSO', () => {
  it('redirects unauthenticated chat users through AIGate SSO', () => {
    expect(getAigateSsoRedirect('chat.aigate.shop', false)).toBe(
      'https://aigate.shop/api/chat/sso',
    );
  });

  it('does not redirect authenticated users or other hosts', () => {
    expect(getAigateSsoRedirect('chat.aigate.shop', true)).toBeNull();
    expect(getAigateSsoRedirect('localhost', false)).toBeNull();
  });
});
