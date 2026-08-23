import { UnauthorizedError } from '../interface';
import {
  NOTION_APP_ORIGIN,
  NOTION_LEGACY_ORIGIN,
  NOTION_ORIGINS,
  NOTION_PERMISSION_ORIGINS,
  requestFromAuthenticatedNotionOrigin,
} from './origin';

describe('Notion origin selection', () => {
  it('uses the current Notion app origin first', async () => {
    const request = vi.fn().mockResolvedValue('ok');

    const result = await requestFromAuthenticatedNotionOrigin(request);

    expect(result).toEqual({ origin: NOTION_APP_ORIGIN, data: 'ok' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(NOTION_APP_ORIGIN);
  });

  it('falls back to the legacy origin after an unauthorized response', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new UnauthorizedError())
      .mockResolvedValueOnce('legacy');

    const result = await requestFromAuthenticatedNotionOrigin(request);

    expect(result).toEqual({ origin: NOTION_LEGACY_ORIGIN, data: 'legacy' });
    expect(request.mock.calls).toEqual(NOTION_ORIGINS.map((origin) => [origin]));
  });

  it('does not hide non-authentication failures', async () => {
    const error = new Error('network unavailable');
    const request = vi.fn().mockRejectedValue(error);

    await expect(requestFromAuthenticatedNotionOrigin(request)).rejects.toBe(error);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('requests host permission for current and legacy Notion origins', () => {
    expect(NOTION_PERMISSION_ORIGINS).toEqual([
      'https://app.notion.com/*',
      'https://www.notion.so/*',
    ]);
  });
});
