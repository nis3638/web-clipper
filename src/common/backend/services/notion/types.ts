import { Repository } from '../interface';

export interface NotionBlockValue {
  id?: string;
  alive?: boolean;
  version?: string;
  parent_id?: string;
  parent_table?: string;
  type?: string;
  space_id?: string;
  created_time?: number;
  properties?: {
    title?: string[][];
    content?: string[];
  };
  collection_id?: string;
}

export interface NotionCollectionValue {
  id?: string;
  version?: string;
  parent_id?: string;
  name?: string[][];
}

export interface NotionRecord<T> {
  role?: string;
  spaceId?: string;
  value: T | { role?: string; value: T };
}

export interface NotionUserContent {
  recordMap: {
    notion_user: {
      [uuid: string]: {
        role: string;
        value: {
          name: string;
          id: string;
          email: string;
          profile_photo: string;
        };
      };
    };
    space?: {
      [id: string]: {
        role: string;
        value: {
          id?: string;
          space_id?: string;
          name: string;
          domain: string;
          pages?: string[];
        };
      };
    };
    user_root?: {
      [id: string]: {
        role: string;
        value: {
          space_view_pointers?: Array<{
            id: string;
            table: string;
            spaceId: string;
          }>;
        };
      };
    };
    space_view?: {
      [id: string]: {
        role: string;
        value: {
          id: string;
          space_id: string;
          pages?: string[];
          private_pages?: string[];
          shared_pages?: string[];
        };
      };
    };
    block?: {
      [uuid: string]: NotionRecord<NotionBlockValue>;
    };
    collection?: {
      [uuid: string]: NotionRecord<NotionCollectionValue>;
    };
  };
}

export interface RecentPages {
  recordMap: {
    collection?: {
      [uuid: string]: {
        role: string;
        value: {
          id: string;
          version: string;
          parent_id: string;
          name: string[][];
        };
      };
    };
  };
}

export interface NotionRepository extends Repository {
  pageType: string;
}

export interface NotionOperation {
  id: string;
  table: string;
  path: string[];
  command: string;
  args: unknown;
}
