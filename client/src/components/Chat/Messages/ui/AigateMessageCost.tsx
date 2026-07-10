import { useEffect, useMemo, useState } from 'react';
import type { TMessage } from 'librechat-data-provider';
import {
  formatAigateUsd,
  getAigateMessageCost,
  getAigateStoredMessageCost,
} from '~/utils/aigateBilling';

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

  useEffect(() => {
    setLocalCost(getAigateStoredMessageCost(conversationId, message.messageId));
  }, [conversationId, message.messageId]);

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

  const cost = useMemo(() => persistedCost ?? localCost, [persistedCost, localCost]);

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
