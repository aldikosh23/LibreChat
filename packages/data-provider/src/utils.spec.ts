import { AuthType } from './schemas';
import { getServerManagedKeyName, isServerManagedKeyName } from './utils';

describe('server-managed credentials', () => {
  it('uses a private key namespace distinct from user-provided credentials', () => {
    const keyName = getServerManagedKeyName('AIGate');

    expect(AuthType.SERVER_MANAGED).toBe('server_managed');
    expect(keyName).toBe('__server_managed__:AIGate');
    expect(isServerManagedKeyName(keyName)).toBe(true);
    expect(isServerManagedKeyName('AIGate')).toBe(false);
  });
});
