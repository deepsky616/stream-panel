const status = document.querySelector('#status');

chrome.runtime.sendMessage({ type: 'heartbeat' }).then((response) => {
  if (response?.ok) {
    const browserName = response.browserId === 'edge' ? '엣지' : '크롬';
    status.textContent = `${browserName}가 스트림 패널과 연결되었습니다.`;
    status.className = 'connected';
    return;
  }
  status.textContent = response?.message ?? '스트림 패널과 연결되지 않았습니다.';
  status.className = 'disconnected';
}).catch(() => {
  status.textContent = '스트림 패널이 실행 중인지 확인해 주세요.';
  status.className = 'disconnected';
});
