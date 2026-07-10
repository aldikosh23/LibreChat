import { getAigateSsoRedirect } from '~/routes/Layouts/Login';

describe('LoginLayout AIGate SSO', () => {
  it('redirects unauthenticated chat users through AIGate SSO', () => {
    expect(getAigateSsoRedirect('chat.aigate.shop', false, true)).toBe(
      'https://aigate.shop/api/chat/sso',
    );
  });

  it('waits for silent auth refresh before redirecting', () => {
    expect(getAigateSsoRedirect('chat.aigate.shop', false, false)).toBeNull();
  });

  it('does not redirect authenticated users or other hosts', () => {
    expect(getAigateSsoRedirect('chat.aigate.shop', true, true)).toBeNull();
    expect(getAigateSsoRedirect('localhost', false, true)).toBeNull();
  });
});
