(async () => {
  const status = document.querySelector('#connection-status');
  const parameters = new URLSearchParams(location.hash.slice(1));
  const token = parameters.get('token') ?? '';
  const expectedBrowserId = parameters.get('browserId') ?? '';
  history.replaceState(null, '', `${location.pathname}${location.search}`);

  const show = (message, ok) => {
    if (!status) return;
    status.textContent = message;
    status.style.color = ok ? '#32b36b' : '#d94a4a';
  };

  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token) || !['chrome', 'edge'].includes(expectedBrowserId)) {
    show('연결 정보가 올바르지 않습니다. 스트림 패널 설정에서 다시 시작해 주세요.', false);
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'pair',
      token,
      expectedBrowserId,
    });
    if (!response?.ok) throw new Error(response?.message ?? '확장 기능이 응답하지 않았습니다.');
    const browserName = response.browserId === 'edge' ? '엣지' : '크롬';
    show(`${browserName} 연결이 끝났습니다. 스트림 패널 설정으로 돌아가세요.`, true);
  } catch (error) {
    show(
      error instanceof Error
        ? error.message
        : '스트림 패널과 연결하지 못했습니다. 앱이 실행 중인지 확인해 주세요.',
      false,
    );
  }
})();
