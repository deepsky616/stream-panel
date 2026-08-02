import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppConfig, LauncherResult } from '../../../shared/types';
import { LauncherResultRow } from './LauncherResultRow';

const INPUT_HEIGHT = 64;
const RESULT_HEIGHT = 56;

function numberFromCode(code: string): string | null {
  if (/^Digit[1-9]$/.test(code)) return code.slice(-1);
  if (code === 'Digit0') return '0';
  return null;
}

export function LauncherApp() {
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const [text, setText] = useState('');
  const [results, setResults] = useState<LauncherResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<AppConfig['theme']>('system');

  const query = useCallback(async (value: string) => {
    const currentRequest = ++requestId.current;
    const next = await window.api.launcher.query({ text: value });
    if (currentRequest !== requestId.current) return;
    setResults(next);
    setSelectedIndex(0);
    const rowCount = Math.max(1, next.length);
    await window.api.launcher.resize({ height: INPUT_HEIGHT + rowCount * RESULT_HEIGHT });
  }, []);

  useEffect(() => {
    void window.api.config.get().then((config) => setTheme(config.theme));
    const reset = () => {
      setText('');
      setError(null);
      void query('');
      requestAnimationFrame(() => inputRef.current?.focus());
    };
    window.addEventListener('focus', reset);
    reset();
    return () => window.removeEventListener('focus', reset);
  }, [query]);

  useEffect(() => {
    if (error) return;
    void query(text);
  }, [error, query, text]);

  const run = useCallback(async (result: LauncherResult | undefined) => {
    if (!result) return;
    const launchResult = await window.api.launcher.run({ id: result.id });
    if (!launchResult.ok) {
      setError(launchResult.message);
      setResults([]);
      await window.api.launcher.resize({ height: INPUT_HEIGHT + RESULT_HEIGHT });
    }
  }, []);

  const moveSelection = (delta: number) => {
    if (results.length === 0) return;
    setSelectedIndex((current) => (current + delta + results.length) % results.length);
  };

  return (
    <main className={`launcher theme-${theme}`}>
      <div className="launcher-search">
        <span aria-hidden="true">⌕</span>
        <input
          ref={inputRef}
          value={text}
          autoComplete="off"
          spellCheck={false}
          placeholder="실행할 항목 이름을 입력하세요"
          aria-label="퀵 런처 검색"
          onChange={(event) => {
            setError(null);
            setText(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.code === 'Escape') {
              event.preventDefault();
              void window.api.launcher.close();
              return;
            }
            if (event.code === 'ArrowDown' || event.code === 'Tab') {
              event.preventDefault();
              moveSelection(event.shiftKey ? -1 : 1);
              return;
            }
            if (event.code === 'ArrowUp') {
              event.preventDefault();
              moveSelection(-1);
              return;
            }
            if (event.code === 'Enter') {
              event.preventDefault();
              void run(results[selectedIndex]);
              return;
            }
            const number = numberFromCode(event.code);
            if (text.length === 0 && number) {
              event.preventDefault();
              void run(results.find((result) => result.hint === number));
            }
          }}
        />
      </div>
      <div className="launcher-results" role="listbox" aria-label="검색 결과">
        {error ? (
          <div className="launcher-message error" role="alert">{error}</div>
        ) : results.length === 0 ? (
          <div className="launcher-message">일치하는 항목이 없습니다</div>
        ) : (
          results.map((result, index) => (
            <LauncherResultRow
              key={result.id}
              result={result}
              selected={selectedIndex === index}
              onSelect={() => setSelectedIndex(index)}
              onRun={() => void run(result)}
            />
          ))
        )}
      </div>
    </main>
  );
}
