import localeService from '@/common/locales';
import { ICookieService } from '@/service/common/cookie';
import { IWebRequestService } from '@/service/common/webRequest';
import { generateUuid } from '@web-clipper/shared/lib/uuid';
import axios, { AxiosInstance } from 'axios';
import Container from 'typedi';
import { CreateDocumentRequest, DocumentService } from '../../index';
import { CompleteStatus, UnauthorizedError } from './../interface';
import { NOTION_APP_ORIGIN, requestFromAuthenticatedNotionOrigin } from './origin';
import {
  getNotionRecordValue,
  getRepositoriesFromRecordMap,
  getSpacesFromUserContent,
  NotionSpace,
} from './repository';
import { NotionRepository, NotionUserContent } from './types';

const PAGE = 'page';
const COLLECTION_VIEW_PAGE = 'collection_view_page';

class NotionRequestError extends Error {
  constructor(
    public status: number,
    public path: string
  ) {
    super(`Notion request failed with status code ${status} at ${path}`);
    this.name = 'NotionRequestError';
  }
}

function isAuthenticatedUserContent(data: unknown): data is NotionUserContent {
  if (!data || typeof data !== 'object') return false;
  const recordMap = (data as Partial<NotionUserContent>).recordMap;
  if (!recordMap || typeof recordMap !== 'object') return false;
  const notionUser = recordMap.notion_user;
  return !!notionUser && typeof notionUser === 'object' && Object.keys(notionUser).length > 0;
}

interface NotionRecordMapResponse {
  recordMap?: Pick<NotionUserContent['recordMap'], 'block' | 'collection' | 'space_view'>;
}

interface NotionSearchResponse {
  results?: Array<{
    id?: string;
    blockId?: string;
  }>;
}

function getRecordRequests(table: string, ids: string[]) {
  return ids.map((id) => ({ pointer: { table, id }, version: -1 }));
}

interface NotionOperation {
  id: string;
  table: string;
  path: string[];
  command: string;
  args: unknown;
}

function addOperationPointers(operations: NotionOperation[], spaceId: string) {
  return operations.map(({ id, table, ...operation }) => ({
    pointer: { id, table, spaceId },
    ...operation,
  }));
}

function getSpaceViewIds(userContent: NotionUserContent, spaceId: string): string[] {
  const ids = Object.values(userContent.recordMap.user_root || {}).flatMap(({ value }) =>
    (value.space_view_pointers || [])
      .filter((pointer) => pointer.table === 'space_view' && pointer.spaceId === spaceId)
      .map((pointer) => pointer.id)
  );
  return Array.from(new Set(ids));
}

function getPageIdsFromSpaceViews(
  spaceViews: NotionUserContent['recordMap']['space_view'],
  spaceId: string
): string[] {
  const ids = Object.values(spaceViews || {})
    .filter(({ value }) => value.space_id === spaceId)
    .flatMap(({ value }) => [
      ...(value.pages || []),
      ...(value.private_pages || []),
      ...(value.shared_pages || []),
    ]);
  return Array.from(new Set(ids));
}

function getPageIdsFromSearchResults(results: NotionSearchResponse['results']): string[] {
  return Array.from(
    new Set(
      (results || [])
        .map((result) => result.id || result.blockId)
        .filter((id): id is string => !!id)
    )
  );
}

export default class NotionDocumentService implements DocumentService {
  private request: AxiosInstance;
  private repositories: NotionRepository[];
  private userContent?: NotionUserContent;
  private webRequestService: IWebRequestService;
  private cookieService: ICookieService;
  private activeOrigin: string;

  constructor() {
    const request = axios.create({
      baseURL: NOTION_APP_ORIGIN,
      timeout: 10000,
      transformResponse: [
        (data): any => {
          return JSON.parse(data);
        },
      ],
      withCredentials: true,
    });
    this.request = request;
    this.repositories = [];
    this.webRequestService = Container.get(IWebRequestService);
    this.cookieService = Container.get(ICookieService);
    this.activeOrigin = NOTION_APP_ORIGIN;
    this.request.interceptors.response.use(
      (r) => r,
      (error) => {
        if (error.response && error.response.status === 401) {
          return Promise.reject(
            new UnauthorizedError(
              localeService.format({
                id: 'backend.services.notion.unauthorizedErrorMessage',
                defaultMessage: 'Unauthorized! Please Login Notion Web.',
              })
            )
          );
        }
        return Promise.reject(error);
      }
    );
  }

  getId = () => {
    return 'notion';
  };

  getUserInfo = async () => {
    if (!this.userContent) {
      this.userContent = await this.getUserContent();
    }
    const user = this.userContent.recordMap.notion_user;
    const userInfo = Object.values(user)[0];
    const { email, profile_photo, name } = userInfo.value;
    return {
      name,
      avatar: profile_photo,
      homePage: NOTION_APP_ORIGIN,
      description: email,
    };
  };

  getRepositories = async () => {
    if (!this.userContent) {
      this.userContent = await this.getUserContent();
    }

    const spaces = getSpacesFromUserContent(this.userContent);
    const workspaceResults = await Promise.allSettled(
      spaces.map((space) => this.getRepositoriesForSpace(space))
    );

    const successfulResults = workspaceResults.filter(
      (result): result is PromiseFulfilledResult<NotionRepository[]> =>
        result.status === 'fulfilled'
    );
    if (successfulResults.length === 0) {
      const firstFailure = workspaceResults.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );
      if (firstFailure) throw firstFailure.reason;
    }

    this.repositories = successfulResults.flatMap((result) => result.value);
    return this.repositories;
  };

  private getRepositoriesForSpace = async (space: NotionSpace) => {
    const repositoriesInUserContent = getRepositoriesFromRecordMap(
      this.userContent!.recordMap,
      space
    );
    let pageIds = Array.from(
      new Set([
        ...(space.pages || []),
        ...getPageIdsFromSpaceViews(this.userContent!.recordMap.space_view, space.id),
      ])
    );
    if (pageIds.length === 0) {
      const spaceViewIds = getSpaceViewIds(this.userContent!, space.id);
      if (spaceViewIds.length > 0) {
        const spaceViewResult = await this.requestWithCookie.post<NotionRecordMapResponse>(
          'api/v3/syncRecordValues',
          { requests: getRecordRequests('space_view', spaceViewIds) }
        );
        pageIds = getPageIdsFromSpaceViews(spaceViewResult.data.recordMap?.space_view, space.id);
      }
    }
    if (pageIds.length === 0) {
      if (repositoriesInUserContent.length > 0) {
        return repositoriesInUserContent;
      }
      const searchResult = await this.requestWithCookie.post<NotionSearchResponse>(
        'api/v3/search',
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
          spaceId: space.id,
          source: 'quick_find',
        }
      );
      pageIds = getPageIdsFromSearchResults(searchResult.data.results);
    }
    if (pageIds.length === 0) {
      return [];
    }

    const blockResult = await this.requestWithCookie.post<NotionRecordMapResponse>(
      'api/v3/syncRecordValues',
      { requests: getRecordRequests('block', pageIds) }
    );
    const blockRecordMap = blockResult.data.recordMap || {};
    const blocks = blockRecordMap.block || {};
    let collections = { ...(blockRecordMap.collection || {}) };
    const missingCollectionIds = Array.from(
      new Set(
        pageIds
          .map((pageId) => getNotionRecordValue(blocks[pageId])?.collection_id)
          .filter((collectionId): collectionId is string => !!collectionId)
      )
    ).filter((collectionId) => !collections[collectionId]);

    if (missingCollectionIds.length > 0) {
      const collectionResult = await this.requestWithCookie.post<NotionRecordMapResponse>(
        'api/v3/syncRecordValues',
        { requests: getRecordRequests('collection', missingCollectionIds) }
      );
      collections = {
        ...collections,
        ...(collectionResult.data.recordMap?.collection || {}),
      };
    }

    return getRepositoriesFromRecordMap(
      { ...blockRecordMap, collection: collections },
      space,
      pageIds
    );
  };

  createDocument = async ({
    repositoryId,
    title,
    content,
  }: CreateDocumentRequest): Promise<CompleteStatus> => {
    let fileName = `${title}.md`;

    const repository = this.repositories.find((o) => o.id === repositoryId);
    if (!repository) {
      throw new Error('Illegal repository');
    }

    const documentId = await this.createEmptyFile(repository, content);
    const fileUrl = await this.getFileUrl(encodeURI(fileName));
    await axios.put(fileUrl.signedPutUrl, `${content}`, {
      headers: {
        'Content-Type': 'text/markdown',
      },
    });
    const spaceId = repository.groupId;
    await this.requestWithCookie.post('api/v3/enqueueTask', {
      task: {
        eventName: 'importFile',
        request: {
          fileURL: fileUrl.url,
          fileName,
          importType: 'ReplaceBlock',
          block: {
            id: documentId,
            spaceId: spaceId,
          },
          spaceId: spaceId,
          signedToken: fileUrl.signedToken,
        },
      },
    });

    return {
      href: `${NOTION_APP_ORIGIN}${repository.groupId}/${documentId.replace(/-/g, '')}`,
    };
  };

  /** @deprecated A save operation must use its repository's groupId instead. */
  getSpaceId = async () => {
    if (!this.userContent) {
      this.userContent = await this.getUserContent();
    }

    const space = getSpacesFromUserContent(this.userContent)[0];
    if (!space) {
      throw new Error('No Notion workspace is available');
    }
    return space.id;
  };

  createEmptyFile = async (repository: NotionRepository, title: string) => {
    if (!this.userContent) {
      this.userContent = await this.getUserContent();
    }
    const spaceId = repository.groupId;
    const documentId = generateUuid();
    const requestId = generateUuid();
    const inner_requestId = generateUuid();
    const parentId = repository.id;
    const userId = Object.values(this.userContent.recordMap.notion_user)[0].value.id;
    const time = new Date().getDate();
    let operations: NotionOperation[] = [];
    if (repository.pageType === PAGE) {
      operations = [
        {
          id: documentId,
          table: 'block',
          path: [],
          command: 'set',
          args: {
            type: 'page',
            id: documentId,
            space_id: spaceId,
            version: 1,
            parent_id: parentId,
            parent_table: 'block',
            alive: true,
          },
        },
        {
          table: 'block',
          id: parentId,
          path: ['content'],
          command: 'listAfter',
          args: {
            id: documentId,
            space_id: spaceId,
          },
        },
        {
          id: documentId,
          table: 'block',
          path: [],
          command: 'update',
          args: {
            created_by: userId,
            created_time: time,
            last_edited_time: time,
            last_edited_by: userId,
            space_id: spaceId,
          },
        },
        {
          id: parentId,
          table: 'block',
          path: [],
          command: 'update',
          args: {
            last_edited_time: time,
            space_id: spaceId,
          },
        },
        {
          id: documentId,
          table: 'block',
          path: ['properties', 'title'],
          command: 'set',
          args: [[title]],
        },
        {
          id: documentId,
          table: 'block',
          path: [],
          command: 'update',
          args: {
            last_edited_time: time,
            space_id: spaceId,
          },
        },
      ];
    } else if (repository.pageType === COLLECTION_VIEW_PAGE) {
      operations = [
        {
          id: documentId,
          table: 'block',
          path: [],
          command: 'set',
          args: {
            type: 'page',
            id: documentId,
            space_id: spaceId,
            version: 1,
            parent_id: parentId,
            parent_table: 'collection',
            alive: true,
          },
        },
      ];
    }

    await this.requestWithCookie.post('api/v3/saveTransactionsFanout', {
      requestId: requestId,
      transactions: [
        {
          id: inner_requestId,
          operations: addOperationPointers(operations, spaceId),
          spaceId: spaceId,
        },
      ],
    });
    return documentId;
  };

  getFileUrl = async (fileName: string) => {
    const result = await this.requestWithCookie.post<{
      url: string;
      signedPutUrl: string;
      signedToken: string;
    }>('api/v3/getUploadFileUrl', {
      bucket: 'temporary',
      name: fileName,
      contentType: 'text/markdown',
    });
    return result.data;
  };

  private getUserContent = async () => {
    const result = await requestFromAuthenticatedNotionOrigin(async (origin) => {
      const response = await this.requestWithCookie.post<NotionUserContent>(
        'api/v3/loadUserContent',
        {},
        origin
      );
      if (!isAuthenticatedUserContent(response.data)) {
        throw new UnauthorizedError(
          localeService.format({
            id: 'backend.services.notion.unauthorizedErrorMessage',
            defaultMessage: 'Unauthorized! Please Login Notion Web.',
          })
        );
      }
      return response.data;
    });
    this.activeOrigin = result.origin;
    return result.data;
  };

  /**
   * Modify the cookie when request
   */
  private get requestWithCookie() {
    const post = async <T>(url: string, data?: any, requestOrigin = this.activeOrigin) => {
      const requestUrl = new URL(url, requestOrigin).toString();
      const cookies = await this.cookieService.getAll({
        url: requestUrl,
      });
      const cookieString = cookies.map((o) => `${o.name}=${o.value}`).join(';');
      const header = await this.webRequestService.startChangeHeader({
        urls: [`${requestOrigin}*`],
        requestHeaders: [
          {
            name: 'cookie',
            value: cookieString,
          },
          {
            name: `Content-Type`,
            value: 'application/json',
          },
        ],
      });
      try {
        const result = await this.request.post<T>(
          await this.webRequestService.changeUrl(requestUrl, header),
          data,
          {}
        );
        await this.webRequestService.end(header);
        return result;
      } catch (error) {
        await this.webRequestService.end(header);
        if (axios.isAxiosError(error) && error.response) {
          throw new NotionRequestError(error.response.status, new URL(requestUrl).pathname);
        }
        throw error;
      }
    };
    return {
      post,
    };
  }
}
