import { ServiceMeta } from '@/common/backend';
import { NOTION_APP_ORIGIN, NOTION_PERMISSION_ORIGINS } from './origin';
import Service from './service';

export default (): ServiceMeta => {
  return {
    name: 'Notion',
    icon: `${NOTION_APP_ORIGIN}images/favicon.ico`,
    type: 'notion',
    homePage: NOTION_APP_ORIGIN,
    service: Service,
    permission: {
      origins: [...NOTION_PERMISSION_ORIGINS],
      permissions: ['cookies'],
    },
  };
};
