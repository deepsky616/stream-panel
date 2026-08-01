import type { DeckItem } from '../../../shared/types';
import { Breadcrumb } from '../common/Breadcrumb';
import { PageDots } from '../common/PageDots';

interface FooterProps {
  root: DeckItem[];
  path: string[];
  page: number;
  pageCount: number;
  onNavigate: (depth: number) => void;
  onPageChange: (page: number) => void;
}

export function Footer({
  root,
  path,
  page,
  pageCount,
  onNavigate,
  onPageChange,
}: FooterProps) {
  return (
    <footer className="panel-footer">
      <Breadcrumb root={root} path={path} onNavigate={onNavigate} />
      <PageDots count={pageCount} page={page} onChange={onPageChange} />
    </footer>
  );
}
