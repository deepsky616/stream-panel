export const APPROVAL_CHECK_CANCELLED_MESSAGE =
  '사용자가 요청한 웹 업무를 열기 위해 배경 업무 알림 확인을 중단했습니다.';

export function createApprovalCheckCancelledError(): Error {
  const error = new Error(APPROVAL_CHECK_CANCELLED_MESSAGE);
  error.name = 'AbortError';
  return error;
}

export function isApprovalCheckCancelled(error: unknown): boolean {
  return error instanceof Error && (
    error.name === 'AbortError' ||
    error.message === APPROVAL_CHECK_CANCELLED_MESSAGE
  );
}

export function throwIfApprovalCheckCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw createApprovalCheckCancelledError();
}
