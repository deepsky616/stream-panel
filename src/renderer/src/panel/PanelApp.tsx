import { useEffect, useMemo } from 'react';
import { getPageCount } from '../../../shared/layout';
import { getItemsAtPath } from '../../../shared/tree';
import { useConfig } from '../hooks/useConfig';
import { useDeckStore } from '../store/deckStore';
import { Footer } from './Footer';
import { PanelGrid } from './PanelGrid';
import { TitleBar } from './TitleBar';
import { Toast } from '../common/Toast';

export function PanelApp() {
  const config = useConfig();
  const location = useDeckStore((state) => state.location);
  const setLocation = useDeckStore((state) => state.setLocation);
  const error = useDeckStore((state) => state.error);
  const items = useMemo(
    () => (config ? getItemsAtPath(config.root, location.path) : []),
    [config, location.path],
  );
  const pageCount = config ? getPageCount(items, config.grid, location.path.length > 0) : 1;
  const showFooter = location.path.length > 0 || pageCount > 1;

  useEffect(() => {
    document.title = showFooter ? 'Stream Panel [footer]' : 'Stream Panel';
    void window.api.window.relayout();
  }, [showFooter]);

  useEffect(() => {
    if (location.page >= pageCount) setLocation({ ...location, page: pageCount - 1 });
  }, [location, pageCount, setLocation]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Backspace' && location.path.length > 0) {
        event.preventDefault();
        setLocation({ path: location.path.slice(0, -1), page: 0 });
      }
      if (event.ctrlKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        const delta = event.key === 'ArrowLeft' ? -1 : 1;
        setLocation({ ...location, page: Math.max(0, Math.min(pageCount - 1, location.page + delta)) });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [location, pageCount, setLocation]);

  if (!config) return <main className="panel loading">패널을 불러오는 중입니다...</main>;

  const changePage = (page: number) => setLocation({ ...location, page });
  const onWheel = (event: React.WheelEvent) => {
    if (pageCount < 2 || Math.abs(event.deltaY) < 4) return;
    changePage(Math.max(0, Math.min(pageCount - 1, location.page + (event.deltaY > 0 ? 1 : -1))));
  };

  return (
    <main className={`panel theme-${config.theme}`} onWheel={onWheel}>
      <TitleBar config={config} />
      <PanelGrid
        config={config}
        items={items}
        path={location.path}
        page={location.page}
        onEnterFolder={(id) => setLocation({ path: [...location.path, id], page: 0 })}
        onBack={() => setLocation({ path: location.path.slice(0, -1), page: 0 })}
      />
      {showFooter && (
        <Footer
          root={config.root}
          path={location.path}
          page={location.page}
          pageCount={pageCount}
          onNavigate={(depth) => setLocation({ path: location.path.slice(0, depth), page: 0 })}
          onPageChange={changePage}
        />
      )}
      {error && <div className="panel-error">{error}</div>}
      <Toast />
    </main>
  );
}
