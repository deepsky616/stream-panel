import { describe, expect, it } from 'vitest';
import { findActionPath, getHangulInitials, searchDeckItems } from '../src/shared/search';
import type { ActionItem, DeckItem, FolderItem, GridConfig } from '../src/shared/types';

const grid: GridConfig = { cols: 5, rows: 3, buttonSize: 88, gap: 8 };

function action(
  id: string,
  label: string,
  position: number,
  target = `https://${id}.example.com`,
): ActionItem {
  return {
    id,
    kind: 'action',
    type: 'url',
    target,
    args: [],
    label,
    icon: { kind: 'auto' },
    color: '#5B8CFF',
    position,
  };
}

function folder(
  id: string,
  label: string,
  position: number,
  children: DeckItem[],
): FolderItem {
  return {
    id,
    kind: 'folder',
    label,
    position,
    children,
    icon: { kind: 'emoji', value: '📁' },
    color: '#5B8CFF',
  };
}

describe('quick launcher search', () => {
  it('excludes folders while finding actions at any tree depth with breadcrumbs', () => {
    const root = [
      folder('tools', '개발도구', 0, [
        folder('docs', '문서', 0, [
          folder('references', '참고', 0, [action('deep', '개발 안내서', 0)]),
        ]),
      ]),
    ];

    expect(searchDeckItems(root, '개발', grid)).toEqual([
      {
        id: 'deep',
        label: '개발 안내서',
        type: 'url',
        breadcrumb: '개발도구 › 문서 › 참고',
        hint: '1',
        matchRanges: [[0, 2]],
      },
    ]);
  });

  it('uses root first-page slot numbers for an empty query and preserves gaps', () => {
    const root = [
      action('first', '첫 항목', 0),
      folder('folder', '실행하지 않는 폴더', 1, []),
      action('fourth', '넷째 슬롯', 3),
      action('tenth', '열째 슬롯', 9),
      action('later', '다음 화면', 15),
    ];

    expect(searchDeckItems(root, '', grid).map(({ id, hint }) => [id, hint])).toEqual([
      ['first', '1'],
      ['fourth', '4'],
      ['tenth', '0'],
    ]);
  });

  it('orders Latin matches by prefix, word start, initials, substring, path, then target', () => {
    const root = [
      action('target', '다른 항목', 0, 'https://vsc.example.com/path'),
      folder('path', 'VSC 모음', 1, [action('path-action', '관련 없는 항목', 0)]),
      action('substring', 'Xvsc 도구', 2),
      action('initials', 'Visual Studio Code', 3),
      action('word', '나의 VSC 문서', 4),
      action('prefix', 'VSC 바로 실행', 5),
    ];

    expect(searchDeckItems(root, 'vsc', grid).map(({ id }) => id)).toEqual([
      'prefix',
      'word',
      'initials',
      'substring',
      'path-action',
      'target',
    ]);
  });

  it('ranks Korean initial matches below direct word starts and above label substrings', () => {
    const root = [
      action('substring-jamo', '안ㄱㅂ내', 0),
      action('initials', '개발 도구', 1),
      action('word-jamo', '안내 ㄱㅂ', 2),
      action('prefix-jamo', 'ㄱㅂ 직접', 3),
    ];

    expect(searchDeckItems(root, 'ㄱㅂ', grid).map(({ id }) => id)).toEqual([
      'prefix-jamo',
      'word-jamo',
      'initials',
      'substring-jamo',
    ]);
  });

  it('calculates Korean initials including tense consonants and mixed characters', () => {
    expect(getHangulInitials('개발 문서 코드')).toBe('ㄱㅂ ㅁㅅ ㅋㄷ');
    expect(getHangulInitials('까치 싸움 뿌리')).toBe('ㄲㅊ ㅆㅇ ㅃㄹ');
    expect(getHangulInitials('A개발-1')).toBe('aㄱㅂ-1');
  });

  it('searches common Korean initials after an emoji and keeps UTF-16 label ranges', () => {
    const root = [
      action('development', '💻개발', 0),
      action('document', '문서', 1),
      action('code', '코드', 2),
    ];

    expect(searchDeckItems(root, 'ㄱㅂ', grid)[0]).toMatchObject({
      id: 'development',
      matchRanges: [[2, 4]],
    });
    expect(searchDeckItems(root, 'ㅁㅅ', grid)[0]?.id).toBe('document');
    expect(searchDeckItems(root, 'ㅋㄷ', grid)[0]?.id).toBe('code');
    expect(searchDeckItems([action('mixed-jamo', '💻ㄱ발', 0)], 'ㄱㅂ', grid)).toEqual([]);
  });

  it('matches English initials case-insensitively and returns their label ranges', () => {
    const [result] = searchDeckItems([action('vscode', 'Visual Studio Code', 0)], 'VSC', grid);

    expect(result).toMatchObject({
      id: 'vscode',
      matchRanges: [[0, 1], [7, 8], [14, 15]],
    });
  });

  it('requires every whitespace-separated term to match across label and breadcrumb', () => {
    const root = [
      folder('docs', '문서', 0, [
        action('both', '개발 안내', 0),
        action('path-only', '일반 안내', 1),
      ]),
      action('label-only', '개발 도구', 1),
    ];

    expect(searchDeckItems(root, '개발 문서', grid).map(({ id }) => id)).toEqual(['both']);
  });

  it('breaks equal-rank ties by shallow depth and then position', () => {
    const root = [
      action('root-later', '도구 나중', 5),
      folder('folder', '모음', 0, [action('nested', '도구 안쪽', 0)]),
      action('root-first', '도구 먼저', 1),
    ];

    expect(searchDeckItems(root, '도구', grid).map(({ id }) => id)).toEqual([
      'root-first',
      'root-later',
      'nested',
    ]);
  });

  it('limits visible results to eight and numbers them in result order', () => {
    const root = Array.from({ length: 12 }, (_, position) =>
      action(`item-${position}`, `실행 ${position}`, position),
    );

    const results = searchDeckItems(root, '실행', grid);

    expect(results).toHaveLength(8);
    expect(results.map(({ hint }) => hint)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
  });

  it('resolves only executable action ids back to their exact tree path', () => {
    const root = [
      folder('tools', '도구', 0, [
        folder('docs', '문서', 0, [action('deep', '깊은 실행', 0)]),
      ]),
    ];

    expect(findActionPath(root, 'deep')).toEqual(['tools', 'docs']);
    expect(findActionPath(root, 'tools')).toBeNull();
    expect(findActionPath(root, 'missing')).toBeNull();
  });
});
