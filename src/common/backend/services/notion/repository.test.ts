import { getRepositoriesFromUserContent, getSpacesFromUserContent } from './repository';
import { NotionUserContent } from './types';

describe('getRepositoriesFromUserContent', () => {
  it('uses the recordMap key when a workspace value omits its id', () => {
    const userContent = {
      recordMap: {
        notion_user: {},
        space: {
          'space-1': { value: { name: 'Workspace' } },
        },
      },
    } as unknown as NotionUserContent;

    expect(getSpacesFromUserContent(userContent)).toEqual([
      expect.objectContaining({ id: 'space-1', name: 'Workspace' }),
    ]);
  });

  it('ignores deleted, untitled, unsupported, and cross-workspace blocks', () => {
    const userContent = {
      recordMap: {
        notion_user: {},
        space: {
          space: { value: { id: 'space-1', name: 'Workspace' } },
        },
        block: {
          deleted: {
            value: {
              id: 'deleted',
              type: 'page',
              space_id: 'space-1',
              alive: false,
              properties: { title: [['Deleted']] },
            },
          },
          untitled: {
            value: { id: 'untitled', type: 'page', space_id: 'space-1' },
          },
          unsupported: {
            value: { id: 'text', type: 'text', space_id: 'space-1' },
          },
          foreign: {
            value: {
              id: 'foreign',
              type: 'page',
              space_id: 'space-2',
              properties: { title: [['Foreign']] },
            },
          },
          unknownWorkspace: {
            value: {
              type: 'page',
              properties: { title: [['Unknown workspace']] },
            },
          },
          missingCollection: {
            value: {
              id: 'database',
              type: 'collection_view_page',
              space_id: 'space-1',
              collection_id: 'missing',
            },
          },
        },
      },
    } as unknown as NotionUserContent;

    expect(getRepositoriesFromUserContent(userContent)).toEqual([]);
  });
});
