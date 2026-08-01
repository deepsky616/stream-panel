import { useEffect } from 'react';
import type { AppConfig } from '../../../shared/types';
import { useDeckStore } from '../store/deckStore';

function isAppConfig(payload: unknown): payload is AppConfig {
  return Boolean(payload && typeof payload === 'object' && 'version' in payload && 'root' in payload);
}

export function useConfig(): AppConfig | null {
  const config = useDeckStore((state) => state.config);
  const setConfig = useDeckStore((state) => state.setConfig);
  const setError = useDeckStore((state) => state.setError);

  useEffect(() => {
    let active = true;
    void window.api.config
      .get()
      .then((next) => active && setConfig(next))
      .catch(() => active && setError('설정을 불러오지 못했습니다. 앱을 다시 시작해 주세요.'));
    const unsubscribe = window.api.on('config:changed', (payload) => {
      if (active && isAppConfig(payload)) setConfig(payload);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [setConfig, setError]);

  return config;
}
