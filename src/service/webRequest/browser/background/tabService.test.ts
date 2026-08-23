import { BackgroundWebRequestService } from './tabService';

describe('BackgroundWebRequestService', () => {
  const updateDynamicRules = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    updateDynamicRules.mockClear();
    vi.stubGlobal('chrome', {
      declarativeNetRequest: {
        updateDynamicRules,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('limits sensitive header changes to the requested hosts and XHR requests', async () => {
    const service = new BackgroundWebRequestService();

    await service.startChangeHeader({
      urls: ['https://app.notion.com/*', 'https://www.notion.so/*'],
      requestHeaders: [{ name: 'cookie', value: 'secret' }],
    });

    const rule = updateDynamicRules.mock.calls[0][0].addRules[0];
    expect(rule.condition).toEqual(
      expect.objectContaining({
        requestDomains: ['app.notion.com', 'www.notion.so'],
        resourceTypes: ['xmlhttprequest'],
      })
    );
  });

  it('removes a sensitive dynamic rule exactly once', async () => {
    const service = new BackgroundWebRequestService();
    const header = await service.startChangeHeader({
      urls: ['https://app.notion.com/*'],
      requestHeaders: [{ name: 'cookie', value: 'secret' }],
    });

    await service.end(header);
    await service.end(header);

    expect(updateDynamicRules).toHaveBeenCalledTimes(2);
    expect(updateDynamicRules.mock.calls[1][0]).toEqual({
      addRules: [],
      removeRuleIds: [expect.any(Number)],
    });
  });

  it('adds the one-time rule marker to the request URL', async () => {
    const service = new BackgroundWebRequestService();

    await expect(
      service.changeUrl('https://app.notion.com/api/v3/loadUserContent', {
        name: 'probe',
        value: 'token',
      })
    ).resolves.toBe('https://app.notion.com/api/v3/loadUserContent?probe=token');
  });
});
