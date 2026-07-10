import { useEffect } from 'react';
import { useRecoilState } from 'recoil';
import { useAuthContext } from '~/hooks/AuthContext';
import StartupLayout from './Startup';
import store from '~/store';

const AIGATE_CHAT_HOST = 'chat.aigate.shop';
const AIGATE_SSO_URL = 'https://aigate.shop/api/chat/sso';

export function getAigateSsoRedirect(hostname: string, isAuthenticated?: boolean) {
  return hostname === AIGATE_CHAT_HOST && !isAuthenticated ? AIGATE_SSO_URL : null;
}

export default function LoginLayout() {
  const { isAuthenticated } = useAuthContext();
  const [queriesEnabled, setQueriesEnabled] = useRecoilState<boolean>(store.queriesEnabled);

  useEffect(() => {
    const redirectUrl = getAigateSsoRedirect(window.location.hostname, isAuthenticated);
    if (redirectUrl) {
      window.location.replace(redirectUrl);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (queriesEnabled) {
      return;
    }
    const timeout: NodeJS.Timeout = setTimeout(() => {
      setQueriesEnabled(true);
    }, 500);

    return () => {
      clearTimeout(timeout);
    };
  }, [queriesEnabled, setQueriesEnabled]);
  return <StartupLayout isAuthenticated={isAuthenticated} />;
}
