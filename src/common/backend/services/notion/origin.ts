import { UnauthorizedError } from '../interface';

export const NOTION_APP_ORIGIN = 'https://app.notion.com/';
export const NOTION_LEGACY_ORIGIN = 'https://www.notion.so/';
export const NOTION_ORIGINS = [NOTION_APP_ORIGIN, NOTION_LEGACY_ORIGIN] as const;
export const NOTION_PERMISSION_ORIGINS = NOTION_ORIGINS.map((origin) => `${origin}*`);

export async function requestFromAuthenticatedNotionOrigin<T>(
  request: (origin: string) => Promise<T>
): Promise<{ origin: string; data: T }> {
  let lastUnauthorizedError: UnauthorizedError | undefined;

  for (const origin of NOTION_ORIGINS) {
    try {
      return {
        origin,
        data: await request(origin),
      };
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) {
        throw error;
      }
      lastUnauthorizedError = error;
    }
  }

  throw lastUnauthorizedError || new UnauthorizedError();
}
