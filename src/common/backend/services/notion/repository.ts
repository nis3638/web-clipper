import { NotionRecord, NotionRepository, NotionUserContent } from './types';

const PAGE = 'page';
const COLLECTION_VIEW_PAGE = 'collection_view_page';

type NotionRecordMap = Pick<NotionUserContent['recordMap'], 'block' | 'collection'>;

export type NotionSpace = NonNullable<NotionUserContent['recordMap']['space']>[string]['value'] & {
  id: string;
};

export function getSpacesFromUserContent(userContent: NotionUserContent): NotionSpace[] {
  return Object.entries(userContent.recordMap.space || {}).flatMap(([recordId, record]) => {
    const spaceId = [record.value.id, record.value.space_id, recordId].find(
      (id): id is string => typeof id === 'string' && id.length > 0
    );
    return spaceId ? [{ ...record.value, id: spaceId }] : [];
  });
}

export function getNotionRecordValue<T>(record?: NotionRecord<T>): T | undefined {
  if (!record) return undefined;
  const value = record.value;
  if (value && typeof value === 'object' && 'value' in value && 'role' in value) {
    return value.value;
  }
  return value as T;
}

export function getRepositoriesFromRecordMap(
  recordMap: NotionRecordMap,
  space: NotionSpace,
  blockIds?: string[]
): NotionRepository[] {
  const blocks = recordMap.block || {};
  const collections = recordMap.collection || {};
  const records = blockIds
    ? blockIds.flatMap((id) => (blocks[id] ? [[id, blocks[id]] as const] : []))
    : Object.entries(blocks);

  return records
    .map(([recordId, record]): NotionRepository | null => {
      const value = getNotionRecordValue(record);
      if (!value) return null;
      const recordSpaceId = value.space_id || record.spaceId;
      const belongsToSpace = recordSpaceId ? recordSpaceId === space.id : blockIds !== undefined;
      if (!belongsToSpace || value.alive === false) return null;

      if (value.type === PAGE && value.properties?.title) {
        return {
          id: value.id || recordId,
          name: value.properties.title.toString(),
          groupId: space.id,
          groupName: space.name,
          pageType: PAGE,
        };
      }

      const collectionId = value.collection_id;
      const collection = collectionId ? collections[collectionId] : undefined;
      const collectionValue = getNotionRecordValue(collection);
      if (value.type === COLLECTION_VIEW_PAGE && collectionId && collectionValue?.name) {
        return {
          id: collectionValue.id || collectionId,
          name: collectionValue.name.toString(),
          groupId: space.id,
          groupName: space.name,
          pageType: COLLECTION_VIEW_PAGE,
        };
      }
      return null;
    })
    .filter((repository): repository is NotionRepository => !!repository);
}

export function getRepositoriesFromUserContent(userContent: NotionUserContent): NotionRepository[] {
  return getSpacesFromUserContent(userContent).flatMap((space) =>
    getRepositoriesFromRecordMap(userContent.recordMap, space)
  );
}
