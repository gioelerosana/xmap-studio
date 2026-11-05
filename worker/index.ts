/**
 * Worker della web app: serve gli asset statici e, solo sotto `/nc/`, il
 * proxy verso Nextcloud (che non invia intestazioni CORS). Il proxy non salva
 * né registra nulla: vedi packages/core/src/cloud/proxy.ts.
 */
import { NEXTCLOUD_PROXY_PREFIX, handleNextcloudProxy } from '../packages/core/src/cloud/proxy.js';

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith(NEXTCLOUD_PROXY_PREFIX)) return handleNextcloudProxy(request);
    return env.ASSETS.fetch(request);
  },
};
