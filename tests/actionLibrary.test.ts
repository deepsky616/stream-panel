import { describe, expect, it } from 'vitest';
import { createWebWorkflowTemplatesForPlatform } from '../src/shared/webWorkflows';
import { getLibraryDragId } from '../src/renderer/src/editor/dndTypes';

describe('action library drag identifiers', () => {
  it('gives every built-in web workflow a stable unique draggable id', () => {
    const templates = createWebWorkflowTemplatesForPlatform('win32', 'goe');
    const ids = templates.map(getLibraryDragId);

    expect(new Set(ids).size).toBe(templates.length);
    expect(templates.map((entry, index) => ({
      workflowId: entry.webWorkflow?.id,
      dragId: ids[index],
    }))).toEqual(expect.arrayContaining([
      expect.objectContaining({
        workflowId: 'neis-leave',
        dragId: 'library:web-work:neis-leave:edge:goe:',
      }),
      expect.objectContaining({
        workflowId: 'neis-trip',
        dragId: 'library:web-work:neis-trip:edge:goe:',
      }),
      expect.objectContaining({
        workflowId: 'edufine-draft',
        dragId: 'library:web-work:edufine-draft:edge:goe:',
      }),
      expect.objectContaining({
        workflowId: 'edufine-purchase',
        dragId: 'library:web-work:edufine-purchase:edge:goe:',
      }),
    ]));
  });

  it('does not reuse a generic URL template id for a web workflow', () => {
    const generic = {
      kind: 'action-template' as const,
      type: 'url' as const,
      label: '웹사이트',
      emoji: '🔗',
    };
    const purchase = createWebWorkflowTemplatesForPlatform('win32', 'goe').find(
      (entry) => entry.webWorkflow?.id === 'edufine-purchase',
    );

    expect(purchase).toBeDefined();
    expect(getLibraryDragId(generic)).toBe('library:action:url:웹사이트');
    expect(getLibraryDragId(purchase!)).not.toBe(getLibraryDragId(generic));
  });
});
