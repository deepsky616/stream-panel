(function startWebWorkflowContentScript() {
  const engine = globalThis.StreamPanelWorkflowEngine;
  const allowedOrigins = new Set([
    'https://goe.neis.go.kr',
    'https://klef.goe.go.kr',
  ]);
  if (!engine || !allowedOrigins.has(location.origin)) return;

  const resultMessages = {
    'neis-leave': '나이스 복무 화면을 열었습니다. 내용을 확인한 뒤 직접 저장하거나 제출해 주세요.',
    'neis-trip': '나이스 출장 화면을 열었습니다. 내용을 확인한 뒤 직접 저장하거나 제출해 주세요.',
    'edufine-draft': '에듀파인 기안 작성 화면을 열었습니다. 내용을 확인한 뒤 직접 저장하거나 결재를 요청해 주세요.',
    'edufine-purchase': '에듀파인 품의 작성 화면을 열었습니다. 내용을 확인한 뒤 직접 저장하거나 결재를 요청해 주세요.',
  };
  let busy = false;

  function elementText(element) {
    return (
      element.getAttribute('aria-label') ||
      element.getAttribute('title') ||
      ('value' in element ? element.value : '') ||
      element.innerText ||
      element.textContent ||
      ''
    );
  }

  function elementHidden(element) {
    if (
      element.hidden ||
      element.getAttribute('aria-hidden') === 'true' ||
      element.getAttribute('aria-disabled') === 'true' ||
      'disabled' in element && element.disabled
    ) {
      return true;
    }
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      return true;
    }
    const rect = element.getBoundingClientRect();
    return rect.width <= 0 || rect.height <= 0;
  }

  function candidates() {
    return Array.from(
      document.querySelectorAll(
        'a, button, [role="button"], [role="menuitem"], [role="tab"], [onclick], input[type="button"], input[type="submit"]',
      ),
    ).map((element) => ({
      element,
      text: elementText(element),
      hidden: elementHidden(element),
      disabled: element.getAttribute('aria-disabled') === 'true' || ('disabled' in element && element.disabled),
    }));
  }

  function findCandidate(labels) {
    return engine.selectMenuCandidate(candidates(), labels)?.element ?? null;
  }

  async function waitForCandidate(labels, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const found = findCandidate(labels);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
  }

  function hasAnyWorkflowStep() {
    for (const workflowId of Object.keys(resultMessages)) {
      for (const labels of engine.getWorkflowSteps(workflowId)) {
        if (findCandidate(labels)) return true;
      }
    }
    return false;
  }

  async function send(message) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch {
      return null;
    }
  }

  async function run(command) {
    const steps = engine.getWorkflowSteps(command.workflowId);
    for (let index = 0; index < steps.length; index += 1) {
      const element = await waitForCandidate(steps[index], 15_000);
      if (!element) {
        throw new Error(
          `${index + 1}번째 메뉴를 찾지 못했습니다. 화면 구성이 바뀌었거나 업무 권한이 없을 수 있습니다.`,
        );
      }
      if (typeof element.focus === 'function') {
        element.focus({ preventScroll: false });
      }
      if (typeof element.click !== 'function') {
        throw new Error(`${index + 1}번째 메뉴를 누를 수 없습니다. 화면 구성이 바뀌었을 수 있습니다.`);
      }
      element.click();
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
  }

  async function poll() {
    if (busy || !hasAnyWorkflowStep()) return;
    busy = true;
    try {
      const response = await send({ type: 'claim', origin: location.origin });
      const command = response?.ok ? response.command : null;
      if (!command) return;
      try {
        await run(command);
        await send({
          type: 'result',
          commandId: command.commandId,
          ok: true,
          message: resultMessages[command.workflowId],
        });
      } catch (error) {
        await send({
          type: 'result',
          commandId: command.commandId,
          ok: false,
          message: error instanceof Error
            ? `웹 업무 화면을 자동으로 열지 못했습니다. ${error.message}`
            : '웹 업무 화면을 자동으로 열지 못했습니다. 페이지를 새로 고친 뒤 다시 시도해 주세요.',
        });
      }
    } finally {
      busy = false;
    }
  }

  setInterval(() => void poll(), 1_200);
  void poll();
})();
