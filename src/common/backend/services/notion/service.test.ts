import { ICookieService } from '@/service/common/cookie';
import { IWebRequestService } from '@/service/common/webRequest';
import axios, { AxiosInstance } from 'axios';
import Container from 'typedi';
import { UnauthorizedError } from '../interface';
import NotionDocumentService from './service';

vi.mock('@/common/locales', () => ({
  default: {
    format: vi.fn(({ defaultMessage }: { defaultMessage: string }) => defaultMessage),
  },
}));

describe('NotionDocumentService authentication', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Container.reset();
  });

  it('keeps each Notion origin paired with its own cookies while probing login', async () => {
    const userContent = {
      recordMap: {
        notion_user: {
          user: {
            value: {
              id: 'user',
              email: 'user@example.com',
              name: 'User',
              profile_photo: 'avatar',
            },
          },
        },
      },
    };
    const post = vi.fn((url: string) => {
      if (url.startsWith('https://app.notion.com/')) {
        return Promise.reject(new UnauthorizedError());
      }
      return Promise.resolve({ data: userContent });
    });
    vi.spyOn(axios, 'create').mockReturnValue({
      post,
      interceptors: {
        response: {
          use: vi.fn(),
        },
      },
    } as unknown as AxiosInstance);

    const getAll = vi.fn(({ url }: chrome.cookies.GetAllDetails) =>
      Promise.resolve([
        {
          name: 'token_v2',
          value: url!.startsWith('https://app.notion.com/') ? 'app-token' : 'legacy-token',
        },
      ] as chrome.cookies.Cookie[])
    );
    Container.set(ICookieService, {
      get: vi.fn(),
      getAll,
      getAllCookieStores: vi.fn(),
    });

    const startChangeHeader = vi.fn().mockResolvedValue({ name: 'probe', value: 'probe' });
    Container.set(IWebRequestService, {
      startChangeHeader,
      end: vi.fn().mockResolvedValue(undefined),
      changeUrl: vi.fn((url: string) => Promise.resolve(url)),
      requestInBackground: vi.fn(),
    });

    const service = new NotionDocumentService();
    await expect(service.getUserInfo()).resolves.toEqual({
      name: 'User',
      avatar: 'avatar',
      homePage: 'https://app.notion.com/',
      description: 'user@example.com',
    });

    expect(getAll.mock.calls.map(([details]) => details.url)).toEqual([
      'https://app.notion.com/api/v3/loadUserContent',
      'https://www.notion.so/api/v3/loadUserContent',
    ]);
    expect(post.mock.calls.map(([, data]) => data)).toEqual([{}, {}]);
    expect(startChangeHeader.mock.calls.map(([details]) => details)).toEqual([
      expect.objectContaining({
        urls: ['https://app.notion.com/*'],
        requestHeaders: expect.arrayContaining([{ name: 'cookie', value: 'token_v2=app-token' }]),
      }),
      expect.objectContaining({
        urls: ['https://www.notion.so/*'],
        requestHeaders: expect.arrayContaining([
          { name: 'cookie', value: 'token_v2=legacy-token' },
        ]),
      }),
    ]);
  });

  it('turns an empty loadUserContent response into an authentication error', async () => {
    const post = vi.fn().mockResolvedValue({ data: {} });
    vi.spyOn(axios, 'create').mockReturnValue({
      post,
      interceptors: {
        response: {
          use: vi.fn(),
        },
      },
    } as unknown as AxiosInstance);

    Container.set(ICookieService, {
      get: vi.fn(),
      getAll: vi.fn().mockResolvedValue([]),
      getAllCookieStores: vi.fn(),
    });
    Container.set(IWebRequestService, {
      startChangeHeader: vi.fn().mockResolvedValue({ name: 'probe', value: 'probe' }),
      end: vi.fn().mockResolvedValue(undefined),
      changeUrl: vi.fn((url: string) => Promise.resolve(url)),
      requestInBackground: vi.fn(),
    });

    const service = new NotionDocumentService();
    await expect(service.getUserInfo()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('handles an authenticated account with no workspace pointers', async () => {
    const userContent = {
      recordMap: {
        notion_user: {
          user: {
            value: {
              id: 'user',
              email: 'user@example.com',
              name: 'User',
              profile_photo: 'avatar',
            },
          },
        },
      },
    };
    const post = vi.fn((url: string) => {
      if (url.includes('loadUserContent')) return Promise.resolve({ data: userContent });
      return Promise.resolve({ data: {} });
    });
    vi.spyOn(axios, 'create').mockReturnValue({
      post,
      interceptors: { response: { use: vi.fn() } },
    } as unknown as AxiosInstance);
    Container.set(ICookieService, {
      get: vi.fn(),
      getAll: vi.fn().mockResolvedValue([]),
      getAllCookieStores: vi.fn(),
    });
    Container.set(IWebRequestService, {
      startChangeHeader: vi.fn().mockResolvedValue({ name: 'probe', value: 'probe' }),
      end: vi.fn().mockResolvedValue(undefined),
      changeUrl: vi.fn((url: string) => Promise.resolve(url)),
      requestInBackground: vi.fn(),
    });

    const service = new NotionDocumentService();
    await expect(service.getRepositories()).resolves.toEqual([]);
  });

  it('loads repositories from workspace page pointers when loadUserContent has no blocks', async () => {
    const userContent = {
      recordMap: {
        notion_user: {
          user: { value: { id: 'user', email: 'user@example.com', name: 'User' } },
        },
        space: {
          space: {
            value: {
              id: 'space-1',
              name: 'Workspace',
              pages: ['page-1', 'database-page'],
            },
          },
        },
      },
    };
    const blockResult = {
      recordMap: {
        block: {
          'page-1': {
            value: {
              id: 'page-1',
              type: 'page',
              space_id: 'space-1',
              properties: { title: [['Home']] },
            },
          },
          'database-page': {
            value: {
              id: 'database-page',
              type: 'collection_view_page',
              space_id: 'space-1',
              collection_id: 'collection-1',
            },
          },
        },
      },
    };
    const collectionResult = {
      recordMap: {
        collection: {
          'collection-1': {
            value: {
              id: 'collection-1',
              name: [['Tasks']],
            },
          },
        },
      },
    };
    const post = vi.fn((url: string, data?: any) => {
      if (url.includes('loadUserContent')) return Promise.resolve({ data: userContent });
      if (data?.requests?.[0]?.pointer?.table === 'block') {
        return Promise.resolve({ data: blockResult });
      }
      if (data?.requests?.[0]?.pointer?.table === 'collection') {
        return Promise.resolve({ data: collectionResult });
      }
      return Promise.reject(new Error(`Unexpected Notion request: ${url}`));
    });
    vi.spyOn(axios, 'create').mockReturnValue({
      post,
      interceptors: { response: { use: vi.fn() } },
    } as unknown as AxiosInstance);
    Container.set(ICookieService, {
      get: vi.fn(),
      getAll: vi.fn().mockResolvedValue([]),
      getAllCookieStores: vi.fn(),
    });
    Container.set(IWebRequestService, {
      startChangeHeader: vi.fn().mockResolvedValue({ name: 'probe', value: 'probe' }),
      end: vi.fn().mockResolvedValue(undefined),
      changeUrl: vi.fn((url: string) => Promise.resolve(url)),
      requestInBackground: vi.fn(),
    });

    const service = new NotionDocumentService();
    await expect(service.getRepositories()).resolves.toEqual([
      {
        id: 'page-1',
        name: 'Home',
        groupId: 'space-1',
        groupName: 'Workspace',
        pageType: 'page',
      },
      {
        id: 'collection-1',
        name: 'Tasks',
        groupId: 'space-1',
        groupName: 'Workspace',
        pageType: 'collection_view_page',
      },
    ]);
    expect(post).toHaveBeenCalledTimes(3);
    expect(post).toHaveBeenNthCalledWith(
      2,
      'https://app.notion.com/api/v3/syncRecordValues',
      {
        requests: [
          { pointer: { table: 'block', id: 'page-1' }, version: -1 },
          { pointer: { table: 'block', id: 'database-page' }, version: -1 },
        ],
      },
      {}
    );
    expect(post).toHaveBeenNthCalledWith(
      3,
      'https://app.notion.com/api/v3/syncRecordValues',
      {
        requests: [{ pointer: { table: 'collection', id: 'collection-1' }, version: -1 }],
      },
      {}
    );
  });

  it('loads repositories through user-root space-view pointers', async () => {
    const userContent = {
      recordMap: {
        notion_user: {
          user: { value: { id: 'user', email: 'user@example.com', name: 'User' } },
        },
        user_root: {
          user: {
            value: {
              space_view_pointers: [
                { id: 'space-view-1', table: 'space_view', spaceId: 'space-1' },
              ],
            },
          },
        },
        space: {
          'space-1': { value: { name: 'Workspace' } },
        },
      },
    };
    const post = vi.fn((url: string, data?: any) => {
      if (url.includes('loadUserContent')) return Promise.resolve({ data: userContent });
      if (data?.requests?.[0]?.pointer?.table === 'space_view') {
        return Promise.resolve({
          data: {
            recordMap: {
              space_view: {
                'space-view-1': {
                  value: {
                    id: 'space-view-1',
                    space_id: 'space-1',
                    private_pages: ['page-1'],
                    shared_pages: ['database-page'],
                  },
                },
              },
            },
          },
        });
      }
      if (data?.requests?.[0]?.pointer?.table === 'block') {
        return Promise.resolve({
          data: {
            recordMap: {
              block: {
                'page-1': {
                  spaceId: 'space-1',
                  value: {
                    value: {
                      id: 'page-1',
                      type: 'page',
                      properties: { title: [['Home']] },
                      space_id: 'space-1',
                    },
                    role: 'editor',
                  },
                },
                'database-page': {
                  spaceId: 'space-1',
                  value: {
                    value: {
                      id: 'database-page',
                      type: 'collection_view_page',
                      collection_id: 'collection-1',
                      space_id: 'space-1',
                    },
                    role: 'editor',
                  },
                },
              },
            },
          },
        });
      }
      if (data?.requests?.[0]?.pointer?.table === 'collection') {
        return Promise.resolve({
          data: {
            recordMap: {
              collection: {
                'collection-1': {
                  spaceId: 'space-1',
                  value: {
                    value: { id: 'collection-1', name: [['Tasks']] },
                    role: 'editor',
                  },
                },
              },
            },
          },
        });
      }
      return Promise.reject(new Error(`Unexpected Notion request: ${url}`));
    });
    vi.spyOn(axios, 'create').mockReturnValue({
      post,
      interceptors: { response: { use: vi.fn() } },
    } as unknown as AxiosInstance);
    Container.set(ICookieService, {
      get: vi.fn(),
      getAll: vi.fn().mockResolvedValue([]),
      getAllCookieStores: vi.fn(),
    });
    Container.set(IWebRequestService, {
      startChangeHeader: vi.fn().mockResolvedValue({ name: 'probe', value: 'probe' }),
      end: vi.fn().mockResolvedValue(undefined),
      changeUrl: vi.fn((url: string) => Promise.resolve(url)),
      requestInBackground: vi.fn(),
    });

    const service = new NotionDocumentService();
    await expect(service.getRepositories()).resolves.toEqual([
      {
        id: 'page-1',
        name: 'Home',
        groupId: 'space-1',
        groupName: 'Workspace',
        pageType: 'page',
      },
      {
        id: 'collection-1',
        name: 'Tasks',
        groupId: 'space-1',
        groupName: 'Workspace',
        pageType: 'collection_view_page',
      },
    ]);
    expect(post).toHaveBeenNthCalledWith(
      2,
      'https://app.notion.com/api/v3/syncRecordValues',
      {
        requests: [{ pointer: { table: 'space_view', id: 'space-view-1' }, version: -1 }],
      },
      {}
    );
  });

  it('searches a workspace when loadUserContent contains no page pointers or blocks', async () => {
    const userContent = {
      recordMap: {
        notion_user: {
          user: { value: { id: 'user', email: 'user@example.com', name: 'User' } },
        },
        space: {
          'space-1': { value: { name: 'Workspace' } },
        },
      },
    };
    const post = vi.fn((url: string, data?: any) => {
      if (url.includes('loadUserContent')) return Promise.resolve({ data: userContent });
      if (url.includes('/search')) {
        return Promise.resolve({
          data: {
            results: [{ id: 'page-1' }, { id: 'database-page' }],
          },
        });
      }
      if (data?.requests?.[0]?.pointer?.table === 'block') {
        return Promise.resolve({
          data: {
            recordMap: {
              block: {
                'page-1': {
                  value: {
                    type: 'page',
                    properties: { title: [['Home']] },
                  },
                },
                'database-page': {
                  value: {
                    type: 'collection_view_page',
                    collection_id: 'collection-1',
                  },
                },
              },
            },
          },
        });
      }
      if (data?.requests?.[0]?.pointer?.table === 'collection') {
        return Promise.resolve({
          data: {
            recordMap: {
              collection: {
                'collection-1': { value: { name: [['Tasks']] } },
              },
            },
          },
        });
      }
      return Promise.reject(new Error(`Unexpected Notion request: ${url}`));
    });
    vi.spyOn(axios, 'create').mockReturnValue({
      post,
      interceptors: { response: { use: vi.fn() } },
    } as unknown as AxiosInstance);
    Container.set(ICookieService, {
      get: vi.fn(),
      getAll: vi.fn().mockResolvedValue([]),
      getAllCookieStores: vi.fn(),
    });
    Container.set(IWebRequestService, {
      startChangeHeader: vi.fn().mockResolvedValue({ name: 'probe', value: 'probe' }),
      end: vi.fn().mockResolvedValue(undefined),
      changeUrl: vi.fn((url: string) => Promise.resolve(url)),
      requestInBackground: vi.fn(),
    });

    const service = new NotionDocumentService();
    await expect(service.getRepositories()).resolves.toEqual([
      {
        id: 'page-1',
        name: 'Home',
        groupId: 'space-1',
        groupName: 'Workspace',
        pageType: 'page',
      },
      {
        id: 'collection-1',
        name: 'Tasks',
        groupId: 'space-1',
        groupName: 'Workspace',
        pageType: 'collection_view_page',
      },
    ]);
    expect(post).toHaveBeenNthCalledWith(
      2,
      'https://app.notion.com/api/v3/search',
      {
        type: 'BlocksInSpace',
        query: '',
        filters: {
          isDeletedOnly: false,
          excludeTemplates: true,
          isNavigableOnly: true,
          requireEditPermissions: true,
          ancestors: [],
          createdBy: [],
          editedBy: [],
          lastEditedTime: {},
          createdTime: {},
        },
        sort: { field: 'relevance' },
        limit: 100,
        spaceId: 'space-1',
        source: 'quick_find',
      },
      {}
    );
  });

  it('keeps repositories from healthy workspaces when another workspace cannot load records', async () => {
    const userContent = {
      recordMap: {
        notion_user: {
          user: { value: { id: 'user', email: 'user@example.com', name: 'User' } },
        },
        space: {
          healthy: {
            value: { id: 'space-1', name: 'Healthy Workspace', pages: ['page-1'] },
          },
          inaccessible: {
            value: { id: 'space-2', name: 'Inaccessible Workspace', pages: ['page-2'] },
          },
        },
      },
    };
    const post = vi.fn((url: string, data?: any) => {
      if (url.includes('loadUserContent')) return Promise.resolve({ data: userContent });
      if (
        data?.requests?.some(
          ({ pointer }: { pointer: { table: string; id: string } }) =>
            pointer.table === 'block' && pointer.id === 'page-1'
        )
      ) {
        return Promise.resolve({
          data: {
            recordMap: {
              block: {
                'page-1': {
                  value: {
                    id: 'page-1',
                    type: 'page',
                    space_id: 'space-1',
                    properties: { title: [['Home']] },
                  },
                },
              },
            },
          },
        });
      }
      return Promise.reject(
        Object.assign(new Error('inaccessible workspace'), {
          isAxiosError: true,
          response: { status: 400 },
        })
      );
    });
    vi.spyOn(axios, 'create').mockReturnValue({
      post,
      interceptors: { response: { use: vi.fn() } },
    } as unknown as AxiosInstance);
    Container.set(ICookieService, {
      get: vi.fn(),
      getAll: vi.fn().mockResolvedValue([]),
      getAllCookieStores: vi.fn(),
    });
    Container.set(IWebRequestService, {
      startChangeHeader: vi.fn().mockResolvedValue({ name: 'probe', value: 'probe' }),
      end: vi.fn().mockResolvedValue(undefined),
      changeUrl: vi.fn((url: string) => Promise.resolve(url)),
      requestInBackground: vi.fn(),
    });

    const service = new NotionDocumentService();
    await expect(service.getRepositories()).resolves.toEqual([
      {
        id: 'page-1',
        name: 'Home',
        groupId: 'space-1',
        groupName: 'Healthy Workspace',
        pageType: 'page',
      },
    ]);
  });

  it('reports the record loading error when every workspace rejects the request', async () => {
    const userContent = {
      recordMap: {
        notion_user: {
          user: { value: { id: 'user', email: 'user@example.com', name: 'User' } },
        },
        space: {
          inaccessible: {
            value: { id: 'space-1', name: 'Inaccessible Workspace', pages: ['page-1'] },
          },
        },
      },
    };
    const post = vi.fn((url: string) => {
      if (url.includes('loadUserContent')) return Promise.resolve({ data: userContent });
      return Promise.reject(
        Object.assign(new Error('inaccessible workspace'), {
          isAxiosError: true,
          response: { status: 400 },
        })
      );
    });
    vi.spyOn(axios, 'create').mockReturnValue({
      post,
      interceptors: { response: { use: vi.fn() } },
    } as unknown as AxiosInstance);
    Container.set(ICookieService, {
      get: vi.fn(),
      getAll: vi.fn().mockResolvedValue([]),
      getAllCookieStores: vi.fn(),
    });
    Container.set(IWebRequestService, {
      startChangeHeader: vi.fn().mockResolvedValue({ name: 'probe', value: 'probe' }),
      end: vi.fn().mockResolvedValue(undefined),
      changeUrl: vi.fn((url: string) => Promise.resolve(url)),
      requestInBackground: vi.fn(),
    });

    const service = new NotionDocumentService();
    await expect(service.getRepositories()).rejects.toThrow(
      'Notion request failed with status code 400 at /api/v3/syncRecordValues'
    );
  });

  it('creates a child page using the workspace loaded during authentication', async () => {
    const userContent = {
      recordMap: {
        notion_user: {
          user: { value: { id: 'user', email: 'user@example.com', name: 'User' } },
        },
        space: {
          'space-1': { value: { name: 'Workspace' } },
        },
      },
    };
    const post = vi.fn((url: string) => {
      if (url.includes('loadUserContent')) return Promise.resolve({ data: userContent });
      if (url.includes('saveTransactionsFanout')) return Promise.resolve({ data: {} });
      return Promise.reject(new Error(`Unexpected Notion request: ${url}`));
    });
    vi.spyOn(axios, 'create').mockReturnValue({
      post,
      interceptors: { response: { use: vi.fn() } },
    } as unknown as AxiosInstance);
    Container.set(ICookieService, {
      get: vi.fn(),
      getAll: vi.fn().mockResolvedValue([]),
      getAllCookieStores: vi.fn(),
    });
    Container.set(IWebRequestService, {
      startChangeHeader: vi.fn().mockResolvedValue({ name: 'probe', value: 'probe' }),
      end: vi.fn().mockResolvedValue(undefined),
      changeUrl: vi.fn((url: string) => Promise.resolve(url)),
      requestInBackground: vi.fn(),
    });

    const service = new NotionDocumentService();
    const documentId = await service.createEmptyFile(
      {
        id: 'page-1',
        name: 'Home',
        groupId: 'space-1',
        groupName: 'Workspace',
        pageType: 'page',
      },
      'Article'
    );

    expect(documentId).toEqual(expect.any(String));
    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenNthCalledWith(
      2,
      'https://app.notion.com/api/v3/saveTransactionsFanout',
      expect.objectContaining({
        transactions: [
          expect.objectContaining({
            spaceId: 'space-1',
            operations: expect.arrayContaining([
              expect.objectContaining({
                id: documentId,
                command: 'set',
                args: expect.objectContaining({ type: 'page', space_id: 'space-1' }),
              }),
              expect.objectContaining({
                id: documentId,
                path: ['properties', 'title'],
                command: 'set',
                args: [['Article']],
              }),
            ]),
          }),
        ],
      }),
      {}
    );
  });
});
