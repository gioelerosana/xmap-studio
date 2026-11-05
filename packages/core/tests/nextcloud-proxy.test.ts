import { describe, expect, it } from 'vitest';
import {
  checkProxyPath,
  checkProxyServer,
  handleNextcloudProxy,
  NEXTCLOUD_PROXY_MAX_BODY,
} from '../src/cloud/proxy.js';

const SERVER = 'https://cloud.example.com/nextcloud/';
const BASE = 'https://xmap.example';

interface Upstream {
  url: string;
  init: RequestInit;
  headers: Headers;
}

function proxyRequest(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string
): Request {
  const init: RequestInit = { method, headers: { 'X-Nextcloud-Server': SERVER, ...headers } };
  if (body !== undefined) init.body = body;
  return new Request(`${BASE}${path}`, init);
}

function recordingFetch(response: () => Response): { fetch: typeof fetch; calls: Upstream[] } {
  const calls: Upstream[] = [];
  const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init: init ?? {}, headers: new Headers(init?.headers) });
    return response();
  };
  return { fetch: fake as typeof fetch, calls };
}

async function errorOf(response: Response): Promise<string> {
  expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  const parsed: unknown = await response.json();
  if (typeof parsed !== 'object' || parsed === null || !('error' in parsed) || typeof parsed.error !== 'string') {
    throw new Error('risposta di errore non valida');
  }
  return parsed.error;
}

describe('checkProxyServer', () => {
  it('accetta https con dominio pubblico e restituisce la base senza barra finale', () => {
    expect(checkProxyServer('https://cloud.example.com/nextcloud/')).toEqual({
      ok: true,
      base: 'https://cloud.example.com/nextcloud',
    });
    expect(checkProxyServer('https://cloud.example.com:8443')).toEqual({
      ok: true,
      base: 'https://cloud.example.com:8443',
    });
  });

  it('rifiuta http, IP, localhost, nomi locali, credenziali e query', () => {
    const rejected = [
      null,
      'http://cloud.example.com',
      'https://192.168.1.10',
      'https://127.0.0.1',
      'https://0x7f.1',
      'https://[::1]',
      'https://localhost',
      'https://sub.localhost',
      'https://nas.local',
      'https://db.internal',
      'https://router.lan',
      'https://x.home.arpa',
      'https://cloud',
      'https://joe:pw@cloud.example.com',
      'https://cloud.example.com/?x=1',
      'non un url',
    ];
    for (const server of rejected) {
      const result = checkProxyServer(server);
      expect(result.ok, String(server)).toBe(false);
    }
  });
});

describe('checkProxyPath', () => {
  it('rifiuta i segmenti di risalita, anche codificati', () => {
    expect(checkProxyPath('remote.php/dav/files/joe/../x', 'GET')).toMatchObject({ ok: false, status: 403 });
    expect(checkProxyPath('remote.php/dav/files/joe/%2e%2e/x', 'GET')).toMatchObject({ ok: false, status: 403 });
    expect(checkProxyPath('remote.php/dav/files/joe/%2E/x', 'GET')).toMatchObject({ ok: false, status: 403 });
    expect(checkProxyPath('remote.php/dav/files/joe/a%5Cb', 'GET')).toMatchObject({ ok: false, status: 403 });
    expect(checkProxyPath('remote.php/dav/files/joe/a%0Ab', 'GET')).toMatchObject({ ok: false, status: 403 });
  });

  it('rifiuta percorsi fuori dalla lista e metodi non consentiti', () => {
    expect(checkProxyPath('admin/users', 'GET')).toMatchObject({ ok: false, status: 403 });
    expect(checkProxyPath('remote.php/dav/files/joe//x', 'GET')).toMatchObject({ ok: false, status: 403 });
    expect(checkProxyPath('remote.php/dav/files/joe/a.xmind', 'DELETE')).toMatchObject({ ok: false, status: 405 });
    expect(checkProxyPath('status.php', 'POST')).toMatchObject({ ok: false, status: 405 });
  });

  it('accetta il login flow con e senza index.php (URL "belli")', () => {
    expect(checkProxyPath('index.php/login/v2', 'POST')).toEqual({ ok: true });
    expect(checkProxyPath('login/v2', 'POST')).toEqual({ ok: true });
    expect(checkProxyPath('login/v2/poll', 'POST')).toEqual({ ok: true });
    expect(checkProxyPath('index.php/login/v2/poll', 'POST')).toEqual({ ok: true });
    expect(checkProxyPath('login/v2/flow', 'POST')).toMatchObject({ ok: false, status: 403 });
  });

  it('accetta PROPFIND su una cartella (ultimo segmento vuoto)', () => {
    expect(checkProxyPath('remote.php/dav/files/joe/Mappe%20%C3%A8/', 'PROPFIND')).toEqual({ ok: true });
    expect(checkProxyPath('index.php/login/v2', 'POST')).toEqual({ ok: true });
  });
});

describe('handleNextcloudProxy', () => {
  it('risponde 404 fuori dal prefisso', async () => {
    const { fetch, calls } = recordingFetch(() => new Response('x'));
    const response = await handleNextcloudProxy(proxyRequest('GET', '/altro/status.php'), { fetch });
    expect(response.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('OPTIONS risponde 204 senza inoltrare', async () => {
    const { fetch, calls } = recordingFetch(() => new Response('x'));
    const response = await handleNextcloudProxy(proxyRequest('OPTIONS', '/nc/status.php'), { fetch });
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('rifiuta server http e IP con 400 e messaggio JSON', async () => {
    const { fetch, calls } = recordingFetch(() => new Response('x'));
    const http = await handleNextcloudProxy(
      proxyRequest('GET', '/nc/status.php', { 'X-Nextcloud-Server': 'http://cloud.example.com' }),
      { fetch }
    );
    expect(http.status).toBe(400);
    expect(await errorOf(http)).toMatch(/https/);

    const ip = await handleNextcloudProxy(
      proxyRequest('GET', '/nc/status.php', { 'X-Nextcloud-Server': 'https://10.0.0.5' }),
      { fetch }
    );
    expect(ip.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('la risalita non esce dalle rotte consentite (l\'URL è normalizzato prima del proxy)', async () => {
    const { fetch, calls } = recordingFetch(() => new Response('x'));
    const escape = await handleNextcloudProxy(
      proxyRequest('GET', '/nc/remote.php/dav/files/joe/../../../../etc/passwd'),
      { fetch }
    );
    expect(escape.status).toBe(403);
    const encoded = await handleNextcloudProxy(
      proxyRequest('GET', '/nc/status.php/%2e%2e/admin/users'),
      { fetch }
    );
    expect(encoded.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('checkProxyPath rifiuta .. e %2e%2e nella forma ancora codificata', () => {
    expect(checkProxyPath('remote.php/dav/files/joe/../x', 'GET')).toMatchObject({ ok: false, status: 403 });
    expect(checkProxyPath('remote.php/dav/files/joe/%2e%2e/x', 'GET')).toMatchObject({ ok: false, status: 403 });
  });

  it('rotta sconosciuta 403, metodo sbagliato 405', async () => {
    const { fetch, calls } = recordingFetch(() => new Response('x'));
    const unknown = await handleNextcloudProxy(proxyRequest('GET', '/nc/admin/users'), { fetch });
    expect(unknown.status).toBe(403);
    const wrongMethod = await handleNextcloudProxy(
      proxyRequest('DELETE', '/nc/remote.php/dav/files/joe/a.xmind'),
      { fetch }
    );
    expect(wrongMethod.status).toBe(405);
    expect(await errorOf(wrongMethod)).toBe('Metodo non consentito per questo percorso.');
    expect(calls).toHaveLength(0);
  });

  it('inoltra solo le intestazioni consentite e imposta lo User-Agent', async () => {
    const { fetch, calls } = recordingFetch(() => new Response('ok', { status: 200 }));
    await handleNextcloudProxy(
      proxyRequest('PROPFIND', '/nc/remote.php/dav/files/joe/', {
        Authorization: 'Basic abc',
        Accept: 'application/xml',
        Depth: '1',
        Cookie: 'session=secret',
        'X-Custom': 'nope',
      }, '<propfind/>'),
      { fetch, userAgent: 'XMap Test' }
    );
    expect(calls).toHaveLength(1);
    const { headers } = calls[0];
    expect(headers.get('authorization')).toBe('Basic abc');
    expect(headers.get('accept')).toBe('application/xml');
    expect(headers.get('depth')).toBe('1');
    expect(headers.get('user-agent')).toBe('XMap Test');
    expect(headers.has('cookie')).toBe(false);
    expect(headers.has('x-custom')).toBe(false);
    expect(calls[0].init.redirect).toBe('manual');
  });

  it('usa come User-Agent il valore di default', async () => {
    const { fetch, calls } = recordingFetch(() => new Response('ok'));
    await handleNextcloudProxy(proxyRequest('GET', '/nc/status.php'), { fetch });
    expect(calls[0].headers.get('user-agent')).toBe('XMap Studio');
  });

  it('preserva la query e la sottocartella del server', async () => {
    const { fetch, calls } = recordingFetch(() => new Response('ok'));
    await handleNextcloudProxy(
      proxyRequest('GET', '/nc/remote.php/dav/files/joe/a%20b.xmind?x=1&y=%20'),
      { fetch }
    );
    expect(calls[0].url).toBe(
      'https://cloud.example.com/nextcloud/remote.php/dav/files/joe/a%20b.xmind?x=1&y=%20'
    );
  });

  it('non inoltra set-cookie e rimette solo le intestazioni di risposta consentite', async () => {
    const { fetch } = recordingFetch(
      () =>
        new Response('{}', {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ETag: '"abc"',
            'Set-Cookie': 'nc_session=1; Path=/',
            'X-Secret': 'x',
          },
        })
    );
    const response = await handleNextcloudProxy(proxyRequest('GET', '/nc/status.php'), { fetch });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('x-secret')).toBeNull();
    expect(response.headers.get('etag')).toBe('"abc"');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('un redirect del server diventa 502 esplicito', async () => {
    const { fetch } = recordingFetch(
      () => new Response(null, { status: 301, headers: { Location: 'https://elsewhere.example.org' } })
    );
    const response = await handleNextcloudProxy(proxyRequest('GET', '/nc/status.php'), { fetch });
    expect(response.status).toBe(502);
    expect(await errorOf(response)).toMatch(/reindirizzamento/);
  });

  it('errore di rete verso il server diventa 502', async () => {
    const fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof globalThis.fetch;
    const response = await handleNextcloudProxy(proxyRequest('GET', '/nc/status.php'), { fetch });
    expect(response.status).toBe(502);
    expect(await errorOf(response)).toBe('Server Nextcloud non raggiungibile.');
  });

  it('204 dal server resta senza corpo', async () => {
    const { fetch } = recordingFetch(() => new Response(null, { status: 204 }));
    const response = await handleNextcloudProxy(proxyRequest('PUT', '/nc/remote.php/dav/files/joe/a.xmind', {}, 'x'), {
      fetch,
    });
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });

  it('rifiuta un corpo oltre il limite', async () => {
    const { fetch, calls } = recordingFetch(() => new Response('ok'));
    const big = new Uint8Array(NEXTCLOUD_PROXY_MAX_BODY + 1);
    const request = new Request(`${BASE}/nc/remote.php/dav/files/joe/big.xmind`, {
      method: 'PUT',
      headers: { 'X-Nextcloud-Server': SERVER },
      body: big,
    });
    const response = await handleNextcloudProxy(request, { fetch });
    expect(response.status).toBe(413);
    expect(calls).toHaveLength(0);
  });
});
