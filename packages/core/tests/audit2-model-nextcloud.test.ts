import { describe, expect, it } from 'vitest';
import { NextcloudClient, NextcloudError, type NextcloudAccount, type NextcloudTransport } from '../src/cloud/nextcloud.js';

interface RecordedCall {
  url: string;
  method: string;
  headers: Headers;
}

function fakeTransport(respond: (call: RecordedCall) => Response): { transport: NextcloudTransport; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const call: RecordedCall = { url: String(input), method: init?.method ?? 'GET', headers: new Headers(init?.headers) };
    calls.push(call);
    return respond(call);
  };
  return { transport: { fetch: fake as typeof fetch, proxyBase: '/nc/' }, calls };
}

const ACCOUNT: NextcloudAccount = {
  server: 'https://cloud.example.com/nextcloud',
  loginName: 'joe',
  appPassword: 'app-pw',
  userId: 'joe',
};

function fileStatus(etag: string): Response {
  const body = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
 <d:response>
  <d:href>/nextcloud/remote.php/dav/files/joe/a.xmind</d:href>
  <d:propstat>
   <d:prop><d:getetag>${etag}</d:getetag><d:resourcetype/></d:prop>
   <d:status>HTTP/1.1 200 OK</d:status>
  </d:propstat>
 </d:response>
</d:multistatus>`;
  return new Response(body, { status: 207, headers: { 'Content-Type': 'application/xml' } });
}

async function rejectionOf(promise: Promise<unknown>): Promise<NextcloudError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof NextcloudError) return err;
    throw err;
  }
  throw new Error('la promessa avrebbe dovuto fallire');
}

describe('Nextcloud: ETag debole in upload', () => {
  it('con ETag debole che coincide: PROPFIND Depth 0, poi PUT senza If-Match', async () => {
    const { transport, calls } = fakeTransport((call) =>
      call.method === 'PROPFIND'
        ? fileStatus('W/&quot;abc&quot;')
        : new Response(null, { status: 204, headers: { ETag: '"new"' } })
    );
    const result = await new NextcloudClient(ACCOUNT, transport).upload('/a.xmind', new Uint8Array([1]), {
      ifMatch: 'W/"abc"',
    });
    expect(result).toEqual({ etag: '"new"' });
    expect(calls.map((c) => c.method)).toEqual(['PROPFIND', 'PUT']);
    expect(calls[0].headers.get('Depth')).toBe('0');
    expect(calls[0].url).toBe('/nc/remote.php/dav/files/joe/a.xmind');
    expect(calls[1].headers.get('If-Match')).toBeNull();
  });

  it('il confronto è debole: ETag attuale forte con la stessa parte opaca va bene', async () => {
    const { transport, calls } = fakeTransport((call) =>
      call.method === 'PROPFIND' ? fileStatus('&quot;abc&quot;') : new Response(null, { status: 201 })
    );
    await new NextcloudClient(ACCOUNT, transport).upload('/a.xmind', new Uint8Array(), { ifMatch: 'W/"abc"' });
    expect(calls.map((c) => c.method)).toEqual(['PROPFIND', 'PUT']);
  });

  it('con ETag debole diverso: conflict e nessun PUT', async () => {
    const { transport, calls } = fakeTransport((call) =>
      call.method === 'PROPFIND' ? fileStatus('W/&quot;changed&quot;') : new Response(null, { status: 204 })
    );
    const err = await rejectionOf(
      new NextcloudClient(ACCOUNT, transport).upload('/a.xmind', new Uint8Array(), { ifMatch: 'W/"abc"' })
    );
    expect(err.code).toBe('conflict');
    expect(err.message).toContain('modificato da quando');
    expect(calls.map((c) => c.method)).toEqual(['PROPFIND']);
  });

  it('con ETag debole e file sparito (404): conflict e nessun PUT', async () => {
    const { transport, calls } = fakeTransport(() => new Response(null, { status: 404 }));
    const err = await rejectionOf(
      new NextcloudClient(ACCOUNT, transport).upload('/a.xmind', new Uint8Array(), { ifMatch: 'W/"abc"' })
    );
    expect(err.code).toBe('conflict');
    expect(calls.map((c) => c.method)).toEqual(['PROPFIND']);
  });

  it('con ETag forte resta il solo PUT con If-Match', async () => {
    const { transport, calls } = fakeTransport(() => new Response(null, { status: 204 }));
    await new NextcloudClient(ACCOUNT, transport).upload('/a.xmind', new Uint8Array(), { ifMatch: '"abc"' });
    expect(calls.map((c) => c.method)).toEqual(['PUT']);
    expect(calls[0].headers.get('If-Match')).toBe('"abc"');
  });
});

describe('Nextcloud: 403 distinto da 401', () => {
  it('403 è forbidden con messaggio sui permessi, 401 resta auth', async () => {
    const forbidden = await rejectionOf(
      new NextcloudClient(ACCOUNT, fakeTransport(() => new Response(null, { status: 403 })).transport).upload(
        '/a.xmind',
        new Uint8Array()
      )
    );
    expect(forbidden.code).toBe('forbidden');
    expect(forbidden.status).toBe(403);
    expect(forbidden.message).toBe(
      'Permessi insufficienti su Nextcloud per questa operazione (cartella o file in sola lettura).'
    );

    const auth = await rejectionOf(
      new NextcloudClient(ACCOUNT, fakeTransport(() => new Response(null, { status: 401 })).transport).download('/a')
    );
    expect(auth.code).toBe('auth');
    expect(auth.message).toBe("Accesso a Nextcloud negato: ricollega l'account dalle impostazioni.");
  });
});
