const CONNECTOR_ORIGIN = 'http://127.0.0.1:38473';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const BROWSER_IDS = new Set(['chrome', 'edge']);
const WORKFLOW_IDS = new Set([
  'neis-leave',
  'neis-trip',
  'edufine-draft',
  'edufine-purchase',
]);
const ALLOWED_ORIGINS = new Set([
  'https://goe.neis.go.kr',
  'https://klef.goe.go.kr',
]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value, keys) {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function currentBrowserId() {
  const brands = navigator.userAgentData?.brands ?? [];
  if (brands.some((brand) => /Microsoft Edge/i.test(brand.brand))) return 'edge';
  return /Edg\//.test(navigator.userAgent) ? 'edge' : 'chrome';
}

async function readToken() {
  const stored = await chrome.storage.local.get('connectorToken');
  return TOKEN_PATTERN.test(stored.connectorToken ?? '') ? stored.connectorToken : null;
}

async function connectorFetch(path, options = {}) {
  const token = options.token ?? await readToken();
  if (!token) throw new Error('스트림 패널과 연결되지 않았습니다. 앱 설정에서 연결 시험을 해 주세요.');
  const response = await fetch(`${CONNECTOR_ORIGIN}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    cache: 'no-store',
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.message ?? '스트림 패널 연결 요청이 실패했습니다.');
  }
  return data;
}

function validCommand(value, requestedOrigin) {
  if (!isRecord(value)) return null;
  if (!hasOnlyKeys(value, ['commandId', 'workflowId', 'browserId', 'target', 'origin', 'createdAt', 'expiresAt'])) {
    return null;
  }
  if (
    typeof value.commandId !== 'string' ||
    value.commandId.length < 1 ||
    value.commandId.length > 100 ||
    !WORKFLOW_IDS.has(value.workflowId) ||
    value.browserId !== currentBrowserId() ||
    typeof value.target !== 'string' ||
    value.origin !== requestedOrigin ||
    !ALLOWED_ORIGINS.has(value.origin) ||
    !Number.isFinite(value.createdAt) ||
    !Number.isFinite(value.expiresAt) ||
    value.expiresAt <= Date.now()
  ) {
    return null;
  }
  try {
    if (new URL(value.target).origin !== requestedOrigin) return null;
  } catch {
    return null;
  }
  return value;
}

async function handleMessage(message) {
  if (!isRecord(message) || typeof message.type !== 'string') {
    return { ok: false, message: '확장 기능 요청 형식이 올바르지 않습니다.' };
  }
  const browserId = currentBrowserId();
  const extensionVersion = chrome.runtime.getManifest().version;

  if (message.type === 'pair') {
    if (
      !hasOnlyKeys(message, ['type', 'token', 'expectedBrowserId']) ||
      !TOKEN_PATTERN.test(message.token ?? '') ||
      !BROWSER_IDS.has(message.expectedBrowserId) ||
      message.expectedBrowserId !== browserId
    ) {
      return { ok: false, message: '연결하려는 브라우저가 현재 브라우저와 다릅니다.' };
    }
    await chrome.storage.local.set({ connectorToken: message.token });
    await connectorFetch('/v1/pair', {
      token: message.token,
      method: 'POST',
      body: { browserId, extensionVersion },
    });
    return { ok: true, browserId };
  }

  if (message.type === 'heartbeat') {
    if (!hasOnlyKeys(message, ['type'])) return { ok: false, message: '상태 요청이 올바르지 않습니다.' };
    await connectorFetch('/v1/heartbeat', {
      method: 'POST',
      body: { browserId, extensionVersion },
    });
    return { ok: true, browserId };
  }

  if (message.type === 'claim') {
    if (
      !hasOnlyKeys(message, ['type', 'origin']) ||
      typeof message.origin !== 'string' ||
      !ALLOWED_ORIGINS.has(message.origin)
    ) {
      return { ok: false, message: '허용되지 않은 업무 사이트입니다.' };
    }
    const query = new URLSearchParams({ browserId, origin: message.origin });
    const command = await connectorFetch(`/v1/claim?${query.toString()}`);
    return { ok: true, command: command === null ? null : validCommand(command, message.origin) };
  }

  if (message.type === 'result') {
    if (
      !hasOnlyKeys(message, ['type', 'commandId', 'ok', 'message']) ||
      typeof message.commandId !== 'string' ||
      message.commandId.length < 1 ||
      message.commandId.length > 100 ||
      typeof message.ok !== 'boolean' ||
      typeof message.message !== 'string' ||
      message.message.length < 1 ||
      message.message.length > 500
    ) {
      return { ok: false, message: '웹 업무 결과 형식이 올바르지 않습니다.' };
    }
    await connectorFetch('/v1/result', {
      method: 'POST',
      body: {
        browserId,
        commandId: message.commandId,
        ok: message.ok,
        message: message.message,
      },
    });
    return { ok: true };
  }

  return { ok: false, message: '지원하지 않는 확장 기능 요청입니다.' };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((error) =>
      sendResponse({
        ok: false,
        message: error instanceof Error ? error.message : '스트림 패널과 통신하지 못했습니다.',
      }),
    );
  return true;
});
