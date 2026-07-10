import { useCallback, useEffect, useRef, useState } from 'react';
import { dataService } from 'librechat-data-provider';
import type { AigateBalanceSnapshot } from '~/utils/aigateBilling';
import {
  formatAigateUsd,
  getAigateUsageCostDelta,
  parseAigateBalance,
  setAigateStoredMessageCost,
} from '~/utils/aigateBilling';
import { useLatestMessageId } from '~/hooks/Messages/useLatestMessage';

type Props = {
  index: number;
  endpoint?: string | null;
  conversationId?: string | null;
  isSubmitting: boolean;
};

export default function AigateBalanceMeter({
  index,
  endpoint,
  conversationId,
  isSubmitting,
}: Props) {
  const latestMessageId = useLatestMessageId(index);
  const [balance, setBalance] = useState<AigateBalanceSnapshot | null>(null);
  const beforeSubmitRef = useRef<AigateBalanceSnapshot | null>(null);
  const wasSubmittingRef = useRef(false);
  const savedMessageRef = useRef<string | null>(null);
  const latestMessageIdRef = useRef(latestMessageId);

  useEffect(() => {
    latestMessageIdRef.current = latestMessageId;
  }, [latestMessageId]);

  const loadBalance = useCallback(async () => {
    if (!endpoint) {
      setBalance(null);
      return null;
    }

    try {
      const payload = await dataService.getAigateBalance(endpoint);
      const nextBalance = parseAigateBalance(payload);
      setBalance(nextBalance);
      return nextBalance;
    } catch {
      setBalance(null);
      return null;
    }
  }, [endpoint]);

  const refreshAfterSubmit = useCallback(
    async (before: AigateBalanceSnapshot | null) => {
      for (const delay of [0, 1000, 2500, 5000]) {
        if (delay > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, delay));
        }
        const after = await loadBalance();
        const cost = getAigateUsageCostDelta(before, after);
        if (cost) {
          return cost;
        }
      }
      return null;
    },
    [loadBalance],
  );

  useEffect(() => {
    void loadBalance();
    const interval = window.setInterval(() => void loadBalance(), 30000);
    return () => window.clearInterval(interval);
  }, [loadBalance]);

  useEffect(() => {
    const wasSubmitting = wasSubmittingRef.current;
    wasSubmittingRef.current = isSubmitting;

    if (isSubmitting && !wasSubmitting) {
      beforeSubmitRef.current = balance;
      if (!balance) {
        void loadBalance().then((snapshot) => {
          beforeSubmitRef.current = snapshot;
        });
      }
      return;
    }

    if (!isSubmitting && wasSubmitting) {
      const before = beforeSubmitRef.current;
      beforeSubmitRef.current = null;
      void refreshAfterSubmit(before).then((cost) => {
        const responseMessageId = latestMessageIdRef.current;
        if (
          !cost ||
          !conversationId ||
          !responseMessageId ||
          savedMessageRef.current === responseMessageId
        ) {
          return;
        }
        savedMessageRef.current = responseMessageId;
        setAigateStoredMessageCost(conversationId, responseMessageId, cost);
      });
    }
  }, [balance, conversationId, isSubmitting, latestMessageId, loadBalance, refreshAfterSubmit]);

  if (!balance) {
    return null;
  }

  const label = balance.unlimited ? 'Баланс' : 'Осталось';

  return (
    <div
      className="flex min-w-fit items-center rounded-full border border-border-light bg-surface-tertiary px-2.5 py-1 text-xs text-text-secondary"
      title="AIGate balance"
    >
      <span className="mr-1 text-text-tertiary">{label}</span>
      <span className="font-mono text-text-primary">{formatAigateUsd(balance.remainingUsd)}</span>
    </div>
  );
}
