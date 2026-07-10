import type { TMessage } from 'librechat-data-provider';

export type AigateBalanceSnapshot = {
  remainingUsd: number;
  usedUsd: number;
  unlimited: boolean;
};

type AigateBalanceEndpointParams = {
  endpoint?: string | null;
  agentProvider?: string | null;
};

const STORAGE_PREFIX = 'aigate:message-cost';

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function getAigateBalanceEndpoint({
  endpoint,
  agentProvider,
}: AigateBalanceEndpointParams): string | null {
  return agentProvider ?? endpoint ?? null;
}

export function parseAigateBalance(payload: unknown): AigateBalanceSnapshot | null {
  const root = asRecord(payload);
  if (!root) {
    return null;
  }

  const token = asRecord(root.token);
  const unlimited = token ? Boolean(token.unlimited_quota) : true;
  const remainingUsd = unlimited
    ? (readNumber(root.balance) ?? readNumber(token?.remaining))
    : (readNumber(token?.remaining) ?? readNumber(root.balance));
  const usedUsd = readNumber(token?.used) ?? readNumber(root.used);
  if (remainingUsd == null || usedUsd == null) {
    return null;
  }

  return {
    remainingUsd,
    usedUsd,
    unlimited,
  };
}

export function getAigateUsageCostDelta(
  before: AigateBalanceSnapshot | null,
  after: AigateBalanceSnapshot | null,
): number | null {
  if (!before || !after) {
    return null;
  }
  const delta = after.usedUsd - before.usedUsd;
  return delta > 0 ? delta : null;
}

export function getAigateMessageCost(message?: TMessage | null): number | null {
  if (!message || message.isCreatedByUser) {
    return null;
  }
  const metadata = asRecord(message.metadata);
  const usage = asRecord(metadata?.usage);
  const cost = readNumber(usage?.cost) ?? readNumber(usage?.cost_usd) ?? readNumber(usage?.costUSD);
  return cost != null && cost > 0 ? cost : null;
}

export function getAigateCostStorageKey(conversationId?: string | null, messageId?: string | null) {
  if (!conversationId || !messageId) {
    return null;
  }
  return `${STORAGE_PREFIX}:${conversationId}:${messageId}`;
}

export function getAigateStoredMessageCost(
  conversationId?: string | null,
  messageId?: string | null,
): number | null {
  const key = getAigateCostStorageKey(conversationId, messageId);
  if (!key || typeof window === 'undefined') {
    return null;
  }
  return readNumber(window.localStorage.getItem(key));
}

export function setAigateStoredMessageCost(
  conversationId: string,
  messageId: string,
  cost: number,
) {
  const key = getAigateCostStorageKey(conversationId, messageId);
  if (!key || typeof window === 'undefined' || cost <= 0) {
    return;
  }
  window.localStorage.setItem(key, String(cost));
  window.dispatchEvent(
    new CustomEvent('aigate-message-cost', {
      detail: { conversationId, messageId, cost },
    }),
  );
}

export function formatAigateUsd(value: number): string {
  if (value < 0.01) {
    return `$${value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`;
  }
  return `$${value.toFixed(2)}`;
}
