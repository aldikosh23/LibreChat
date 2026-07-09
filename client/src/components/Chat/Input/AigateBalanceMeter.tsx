import { useCallback, useEffect, useRef, useState } from 'react';
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

  const loadBalance = useCallback(async () => {
    if (!endpoint) {
      setBalance(null);
      return null;
    }

    try {
      const res = await fetch(`/api/aigate/balance?endpoint=${encodeURIComponent(endpoint)}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) {
        setBalance(null);
        return null;
      }
      const payload = await res.json().catch(() => null);
      const nextBalance = parseAigateBalance(payload);
      setBalance(nextBalance);
      return nextBalance;
    } catch {
      setBalance(null);
      return null;
    }
  }, [endpoint]);

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
      void loadBalance().then((after) => {
        const cost = getAigateUsageCostDelta(before, after);
        if (
          !cost ||
          !conversationId ||
          !latestMessageId ||
          savedMessageRef.current === latestMessageId
        ) {
          return;
        }
        savedMessageRef.current = latestMessageId;
        setAigateStoredMessageCost(conversationId, latestMessageId, cost);
      });
    }
  }, [balance, conversationId, isSubmitting, latestMessageId, loadBalance]);

  if (!balance) {
    return null;
  }

  const label = balance.unlimited ? 'balance' : 'key left';

  return (
    <div
      className="hidden min-w-fit items-center rounded-full border border-border-light bg-surface-tertiary px-2.5 py-1 text-xs text-text-secondary sm:flex"
      title="AIGate balance"
    >
      <span className="mr-1 text-text-tertiary">{label}</span>
      <span className="font-mono text-text-primary">{formatAigateUsd(balance.remainingUsd)}</span>
    </div>
  );
}
