import type { DeckItem } from '../../../shared/types';
import { getItemsAtPath } from '../../../shared/tree';

interface BreadcrumbProps {
  root: DeckItem[];
  path: string[];
  onNavigate: (depth: number) => void;
}

export function Breadcrumb({ root, path, onNavigate }: BreadcrumbProps) {
  const labels = path.map((id, index) => {
    const parentPath = path.slice(0, index);
    return getItemsAtPath(root, parentPath).find((item) => item.id === id)?.label ?? '폴더';
  });
  return (
    <nav className="breadcrumb" aria-label="현재 폴더">
      <button type="button" onClick={() => onNavigate(0)}>
        홈
      </button>
      {labels.map((label, index) => (
        <span key={path[index]}>
          <span aria-hidden="true">›</span>
          <button type="button" onClick={() => onNavigate(index + 1)}>
            {label}
          </button>
        </span>
      ))}
    </nav>
  );
}
