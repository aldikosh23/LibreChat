import type { TMessage } from 'librechat-data-provider';
import {
  formatAigateUsd,
  getAigateBalanceEndpoint,
  getAigateMessageCost,
  getAigateStoredMessageCost,
  getAigateUsageCostDelta,
  parseAigateBalance,
  setAigateStoredMessageCost,
} from './aigateBilling';

describe('aigate billing helpers', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('normalizes token-scoped balance and used quota', () => {
    const balance = parseAigateBalance({
      balance: 4,
      used: 2,
      token: {
        remaining: 3,
        used: 1.25,
        unlimited_quota: false,
      },
    });

    expect(balance).toEqual({
      remainingUsd: 3,
      usedUsd: 1.25,
      unlimited: false,
    });
  });

  it('falls back to account-scoped balance when token usage is absent', () => {
    const balance = parseAigateBalance({ balance: 4, used: 2 });

    expect(balance).toEqual({
      remainingUsd: 4,
      usedUsd: 2,
      unlimited: true,
    });
  });

  it('shows account balance for unlimited keys but keeps token used for deltas', () => {
    const balance = parseAigateBalance({
      balance: 9,
      used: 20,
      token: {
        remaining: 0,
        used: 1.5,
        unlimited_quota: true,
      },
    });

    expect(balance).toEqual({
      remainingUsd: 9,
      usedUsd: 1.5,
      unlimited: true,
    });
  });

  it('computes positive used-cost deltas only', () => {
    expect(
      getAigateUsageCostDelta(
        { remainingUsd: 5, usedUsd: 1, unlimited: false },
        { remainingUsd: 4.75, usedUsd: 1.25, unlimited: false },
      ),
    ).toBe(0.25);
    expect(
      getAigateUsageCostDelta(
        { remainingUsd: 5, usedUsd: 2, unlimited: false },
        { remainingUsd: 4.75, usedUsd: 1.25, unlimited: false },
      ),
    ).toBeNull();
  });

  it('falls back to the balance decrease when token used is unchanged', () => {
    expect(
      getAigateUsageCostDelta(
        { remainingUsd: 10, usedUsd: 0, unlimited: true },
        { remainingUsd: 9.875, usedUsd: 0, unlimited: true },
      ),
    ).toBeCloseTo(0.125);
  });

  it('reads persisted response cost from metadata usage', () => {
    const message = {
      conversationId: 'convo',
      parentMessageId: null,
      text: '',
      messageId: 'msg',
      isCreatedByUser: false,
      metadata: { usage: { cost: 0.012345 } },
    } as TMessage;

    expect(getAigateMessageCost(message)).toBe(0.012345);
  });

  it('uses the custom agent provider name for balance requests', () => {
    expect(
      getAigateBalanceEndpoint({
        endpoint: 'agents',
        agentProvider: 'AIGate',
      }),
    ).toBe('AIGate');
  });

  it('persists local fallback costs by conversation and message', () => {
    setAigateStoredMessageCost('convo', 'msg', 0.0042);

    expect(getAigateStoredMessageCost('convo', 'msg')).toBe(0.0042);
  });

  it('formats small usd values without dropping useful precision', () => {
    expect(formatAigateUsd(0.000148)).toBe('$0.000148');
    expect(formatAigateUsd(0.16)).toBe('$0.16');
  });
});
