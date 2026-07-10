import { useEffect, useMemo, useState } from 'react';
import type { TMessage } from 'librechat-data-provider';
import {
  formatAigateUsd,
  getAigateMessageCost,
  getAigateStoredMessageCost,
} from '~/utils/aigateBilling';

type CostsResponse = { costs?: Record<string, number> };

const conversationCostRequests = new Map<string, Promise<Record<string, number>>>();

function loadConversationCosts(conversationId: string) {
  const existing = conversationCostRequests.get(conversationId);
  if (existing) {
    return existing;
  }
  const request = fetch(`/api/aigate/costs?conversationId=${encodeURIComponent(conversationId)}`, {
    credentials: 'same-origin',
  })
    .then(async (response) => {
      if (!response.ok) {
        return {};
      }
      const payload = (await response.json()) as CostsResponse;
      return payload.costs ?? {};
    })
    .catch(() => ({}));
  conversationCostRequests.set(conversationId, request);
  return request;
}

type Props = {
  message: TMessage;
  conversationId?: string | null;
};

type CostEvent = CustomEvent<{
  conversationId?: string;
  messageId?: string;
  cost?: number;
}>;

export default function AigateMessageCost({ message, conversationId }: Props) {
  const persistedCost = getAigateMessageCost(message);
  const [localCost, setLocalCost] = useState(() =>
    getAigateStoredMessageCost(conversationId, message.messageId),
  );
  const [remoteCost, setRemoteCost] = useState<number | null>(null);

  useEffect(() => {
    setLocalCost(getAigateStoredMessageCost(conversationId, message.messageId));
  }, [conversationId, message.messageId]);

  useEffect(() => {
    if (!conversationId || message.isCreatedByUser || persistedCost || localCost) {
      return;
    }
    let active = true;
    let retryTimer: number | undefined;
    void loadConversationCosts(conversationId).then((costs) => {
      const cost = costs[message.messageId];
      if (active && Number.isFinite(cost) && cost > 0) {
        setRemoteCost(cost);
        return;
      }
      conversationCostRequests.delete(conversationId);
      retryTimer = window.setTimeout(() => {
        void loadConversationCosts(conversationId).then((freshCosts) => {
          const freshCost = freshCosts[message.messageId];
          if (active && Number.isFinite(freshCost) && freshCost > 0) {
            setRemoteCost(freshCost);
          }
        });
      }, 1000);
    });
    return () => {
      active = false;
      if (retryTimer) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [conversationId, localCost, message.isCreatedByUser, message.messageId, persistedCost]);

  useEffect(() => {
    function handleCost(event: Event) {
      const detail = (event as CostEvent).detail;
      if (detail?.conversationId !== conversationId || detail?.messageId !== message.messageId) {
        return;
      }
      setLocalCost(typeof detail.cost === 'number' && detail.cost > 0 ? detail.cost : null);
    }

    window.addEventListener('aigate-message-cost', handleCost);
    return () => window.removeEventListener('aigate-message-cost', handleCost);
  }, [conversationId, message.messageId]);

  const cost = useMemo(
    () => persistedCost ?? localCost ?? remoteCost,
    [persistedCost, localCost, remoteCost],
  );

  if (!cost || message.isCreatedByUser) {
    return null;
  }

  return (
    <span
      className="inline-flex items-center font-mono text-[11px] text-text-tertiary"
      title="Request cost"
    >
      -{formatAigateUsd(cost)}
    </span>
  );
}
