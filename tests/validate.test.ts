import { describe, expect, it } from 'vitest';
import type { ActionItem, DeckItem } from '../src/shared/types';
import {
  validateActionTarget,
  validateDeck,
  validateDeckItemShallow,
  validatePathTarget,
  validateUrl,
} from '../src/main/security/validate';

function action(overrides: Partial<ActionItem> = {}): ActionItem {
  return {
    id: 'item',
    kind: 'action',
    type: 'url',
    target: 'https://example.com',
    args: [],
    label: '시험',
    icon: { kind: 'auto' },
    color: '#5B8CFF',
    position: 0,
    ...overrides,
  };
}

describe('security validation', () => {
  it('allows only the documented URL protocols', () => {
    expect(validateUrl('https://example.com').protocol).toBe('https:');
    expect(validateUrl('mailto:test@example.com').protocol).toBe('mailto:');
    expect(() => validateUrl('javascript:alert(1)')).toThrow(/보안/);
    expect(() => validateUrl('file:///tmp/a')).toThrow(/보안/);
    expect(() => validateUrl('spotify:track')).toThrow(/현재/);
  });

  it('rejects relative paths and traversal segments', () => {
    const relative = action({ type: 'file', target: 'notes.txt' });
    expect(() => validatePathTarget(relative)).toThrow(/상대 경로/);
    const traversal = action({ type: 'file', target: '/tmp/folder/../secret.txt' });
    expect(() => validatePathTarget(traversal)).toThrow(/상대 경로/);
  });

  it('validates path kinds and app extensions without requiring a real file', () => {
    const dependencies = {
      exists: () => true,
      stat: () => ({ isDirectory: () => true }),
    };
    expect(() => validatePathTarget(action({ type: 'folder', target: '/tmp/folder' }), dependencies)).not.toThrow();
    expect(() => validatePathTarget(action({ type: 'file', target: '/tmp/folder' }), dependencies)).toThrow(/파일/);
    expect(() => validateActionTarget(action({ type: 'app', target: '/tmp/app.sh' }))).toThrow(/exe/);
  });

  it('limits labels, arguments, target length, and colors', () => {
    expect(() => validateDeckItemShallow(action({ label: '' }))).toThrow(/제목/);
    expect(() => validateDeckItemShallow(action({ label: '가'.repeat(25) }))).toThrow(/24/);
    expect(() => validateDeckItemShallow(action({ args: Array(17).fill('a') }))).toThrow(/16/);
    expect(() => validateDeckItemShallow(action({ args: ['a'.repeat(513)] }))).toThrow(/512/);
    expect(() => validateDeckItemShallow(action({ target: 'a'.repeat(2049) }))).toThrow(/2048/);
    expect(() => validateDeckItemShallow(action({ color: 'red' }))).toThrow(/색상/);
  });

  it('enforces layer, depth, and total item limits', () => {
    const layer = Array.from({ length: 121 }, (_, index) => action({ id: `id-${index}`, position: index }));
    expect(() => validateDeck(layer)).toThrow(/120/);

    let nested: DeckItem = {
      id: 'bottom',
      kind: 'folder',
      label: '폴더',
      icon: { kind: 'auto' },
      color: '#5B8CFF',
      position: 0,
      children: [],
    };
    for (let depth = 0; depth < 5; depth += 1) {
      nested = { ...nested, id: `folder-${depth}`, children: [nested] };
    }
    expect(() => validateDeck([nested])).toThrow(/다섯 단계/);

    const roots = Array.from({ length: 5 }, (_, rootIndex) => ({
      id: `root-${rootIndex}`,
      kind: 'folder' as const,
      label: '묶음',
      icon: { kind: 'auto' as const },
      color: '#5B8CFF',
      position: rootIndex,
      children: Array.from({ length: 100 }, (_, index) =>
        action({ id: `item-${rootIndex}-${index}`, position: index }),
      ),
    }));
    expect(() => validateDeck(roots)).toThrow(/500/);
  });
});
