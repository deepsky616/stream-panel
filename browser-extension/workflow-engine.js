(function exposeWorkflowEngine(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.StreamPanelWorkflowEngine = api;
})(typeof globalThis === 'object' ? globalThis : this, function createWorkflowEngine() {
  const workflowSteps = Object.freeze({
    'neis-leave': Object.freeze([
      Object.freeze(['복무']),
      Object.freeze(['개인근무상황관리', '개인근무상황']),
    ]),
    'neis-trip': Object.freeze([
      Object.freeze(['복무']),
      Object.freeze(['개인출장관리', '출장관리']),
    ]),
    'edufine-draft': Object.freeze([
      Object.freeze(['업무관리']),
      Object.freeze(['문서관리']),
      Object.freeze(['문서작성', '기안작성', '기안']),
    ]),
    'edufine-purchase': Object.freeze([
      Object.freeze(['학교회계']),
      Object.freeze(['사업관리']),
      Object.freeze(['품의작성', '품의']),
    ]),
  });
  const forbiddenTokens = ['저장', '제출', '결재', '상신', '승인', '확정'];

  function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function getWorkflowSteps(id) {
    const steps = workflowSteps[id];
    if (!steps) throw new Error('지원하지 않는 웹 업무입니다.');
    return steps;
  }

  function isForbiddenActionText(text) {
    const normalized = normalizeText(text);
    return forbiddenTokens.some((token) => normalized.includes(token));
  }

  function selectMenuCandidate(candidates, labels) {
    const normalizedLabels = labels.map(normalizeText).filter(Boolean);
    const ranked = [];
    candidates.forEach((candidate, index) => {
      if (!candidate || candidate.hidden || candidate.disabled) return;
      const text = normalizeText(candidate.text);
      if (!text || isForbiddenActionText(text)) return;
      let best = Number.POSITIVE_INFINITY;
      for (const label of normalizedLabels) {
        if (text === label) best = Math.min(best, 0);
        else if (text.startsWith(label)) best = Math.min(best, 1);
        else if (text.includes(label)) best = Math.min(best, 2);
      }
      if (Number.isFinite(best)) ranked.push({ candidate, score: best, length: text.length, index });
    });
    ranked.sort((left, right) =>
      left.score - right.score || left.length - right.length || left.index - right.index,
    );
    return ranked[0]?.candidate ?? null;
  }

  return {
    getWorkflowSteps,
    isForbiddenActionText,
    normalizeText,
    selectMenuCandidate,
  };
});
