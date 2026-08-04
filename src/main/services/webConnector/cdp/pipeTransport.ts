import type { CdpTransport, CdpTransportMessageListener } from './transport';

const MAX_PIPE_MESSAGE_BYTES = 2 * 1024 * 1024;

export function createPipeTransport(
  input: NodeJS.WritableStream,
  output: NodeJS.ReadableStream,
): CdpTransport {
  const messageListeners = new Set<CdpTransportMessageListener>();
  const closeListeners = new Set<(reason?: Error) => void>();
  let buffer = Buffer.alloc(0);
  let closed = false;

  const emitClose = (reason?: Error): void => {
    if (closed) return;
    closed = true;
    for (const listener of closeListeners) listener(reason);
  };
  const onData = (chunk: string | Buffer): void => {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    if (buffer.length > MAX_PIPE_MESSAGE_BYTES && !buffer.includes(0)) {
      emitClose(new Error('업무용 브라우저 응답이 너무 큽니다. 브라우저를 다시 열어 주세요.'));
      return;
    }
    let delimiter = buffer.indexOf(0);
    while (delimiter >= 0) {
      const frame = buffer.subarray(0, delimiter);
      buffer = buffer.subarray(delimiter + 1);
      if (frame.length > MAX_PIPE_MESSAGE_BYTES) {
        emitClose(new Error('업무용 브라우저 응답이 너무 큽니다. 브라우저를 다시 열어 주세요.'));
        return;
      }
      if (frame.length > 0) {
        const message = frame.toString('utf8');
        for (const listener of messageListeners) listener(message);
      }
      delimiter = buffer.indexOf(0);
    }
  };
  const onError = (error: Error): void => emitClose(error);
  const onClose = (): void => emitClose();

  output.on('data', onData);
  output.on('error', onError);
  output.on('close', onClose);

  return {
    send(message) {
      if (closed) throw new Error('업무용 브라우저 파이프가 닫혔습니다.');
      if (message.includes('\0')) throw new TypeError('브라우저 제어 메시지에 허용되지 않은 문자가 있습니다.');
      input.write(Buffer.from(`${message}\0`, 'utf8'));
    },
    onMessage(listener) {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    },
    onClose(listener) {
      closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
    close() {
      if (!closed) emitClose();
      output.off('data', onData);
      output.off('error', onError);
      output.off('close', onClose);
      if ('end' in input && typeof input.end === 'function') input.end();
    },
  };
}
