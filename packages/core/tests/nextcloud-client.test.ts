import { describe, expect, it } from 'vitest';
import {
  NextcloudClient,
  NextcloudError,
  normalizeServerUrl,
  parseMultistatus,
  pollLoginFlow,
  startLoginFlow,
  type NextcloudAccount,
  type NextcloudEntry,
  type NextcloudTransport,
} from '../src/cloud/nextcloud.js';

interface RecordedCall {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}

type Responder = (call: RecordedCall) => Response | Promise<Response>;

function fakeTransport(respond: Responder): { transport: NextcloudTransport; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const call: RecordedCall = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: init?.body,
    };
    calls.push(call);
    return respond(call);
  };
  return { transport: { fetch: fake as typeof fetch, proxyBase: '/nc/' }, calls };
}

const SERVER = 'https://cloud.example.com/nextcloud';

const ACCOUNT: NextcloudAccount = {
  server: SERVER,
  loginName: 'joe',
  appPassword: 'app-pw',
  userId: 'joe',
};

function xml(body: string, status = 207): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
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

const MULTISTATUS = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
 <d:response>
  <d:href>/nextcloud/remote.php/dav/files/joe/Mappe%20%C3%A8/</d:href>
  <d:propstat>
   <d:prop>
    <d:getlastmodified>Wed, 21 Oct 2026 07:28:00 GMT</d:getlastmodified>
    <d:getetag>&quot;folder1&quot;</d:getetag>
    <d:resourcetype><d:collection/></d:resourcetype>
    <d:displayname>Mappe è</d:displayname>
   </d:prop>
   <d:status>HTTP/1.1 200 OK</d:status>
  </d:propstat>
 </d:response>
 <d:response>
  <d:href>/nextcloud/remote.php/dav/files/joe/Mappe%20%C3%A8/progetto%20%26%20idee.xmind</d:href>
  <d:propstat>
   <d:prop>
    <d:getlastmodified>Tue, 20 Oct 2026 10:00:00 GMT</d:getlastmodified>
    <d:getetag>&quot;abc&quot;</d:getetag>
    <d:getcontentlength>2048</d:getcontentlength>
    <d:resourcetype/>
    <d:displayname>progetto &amp; idee.xmind</d:displayname>
   </d:prop>
   <d:status>HTTP/1.1 200 OK</d:status>
  </d:propstat>
  <d:propstat>
   <d:prop>
    <oc:fileid/>
    <d:getetag>&quot;WRONG&quot;</d:getetag>
   </d:prop>
   <d:status>HTTP/1.1 404 Not Found</d:status>
  </d:propstat>
 </d:response>
</d:multistatus>`;

describe('normalizeServerUrl', () => {
  it('aggiunge https e toglie il percorso copiato dalla barra degli indirizzi', () => {
    expect(normalizeServerUrl('cloud.example.com/nextcloud/index.php/apps/files')).toBe(
      'https://cloud.example.com/nextcloud'
    );
  });

  it('toglie spazi, barra finale, query e frammento', () => {
    expect(normalizeServerUrl('  https://cloud.example.com/  ')).toBe('https://cloud.example.com');
    expect(normalizeServerUrl('https://cloud.example.com:8443/?x=1#f')).toBe('https://cloud.example.com:8443');
    expect(normalizeServerUrl('https://cloud.example.com/nc/remote.php/dav')).toBe('https://cloud.example.com/nc');
  });

  it('rifiuta http, credenziali e indirizzo vuoto', async () => {
    const http = await rejectionOf(Promise.resolve().then(() => normalizeServerUrl('http://cloud.example.com')));
    expect(http.code).toBe('invalid');
    expect(http.message).toBe("L'indirizzo deve usare https://.");

    const empty = await rejectionOf(Promise.resolve().then(() => normalizeServerUrl('   ')));
    expect(empty.code).toBe('invalid');
    expect(empty.message).toBe("Inserisci l'indirizzo del server Nextcloud.");

    const withCredentials = await rejectionOf(
      Promise.resolve().then(() => normalizeServerUrl('https://joe:pw@cloud.example.com'))
    );
    expect(withCredentials.code).toBe('invalid');
  });
});

describe('parseMultistatus', () => {
  it('legge cartelle e file con href codificati, ETag con virgolette e propstat 200 soltanto', () => {
    const entries = parseMultistatus(MULTISTATUS, '/nextcloud/remote.php/dav/files/joe');
    expect(entries).toEqual<NextcloudEntry[]>([
      {
        path: '/Mappe è',
        name: 'Mappe è',
        isDirectory: true,
        lastModified: '2026-10-21T07:28:00.000Z',
        etag: '"folder1"',
      },
      {
        path: '/Mappe è/progetto & idee.xmind',
        name: 'progetto & idee.xmind',
        isDirectory: false,
        size: 2048,
        lastModified: '2026-10-20T10:00:00.000Z',
        etag: '"abc"',
      },
    ]);
  });

  it('accetta prefissi di namespace diversi e href come URL completi', () => {
    const plain = `<?xml version="1.0"?>
<D:multistatus xmlns:D="DAV:">
 <D:response>
  <D:href>https://cloud.example.com/remote.php/dav/files/joe/notes.xmind</D:href>
  <D:propstat><D:prop><D:getcontentlength>7</D:getcontentlength><D:resourcetype/></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
 </D:response>
 <response xmlns="DAV:">
  <href>/remote.php/dav/files/joe/Archivio/</href>
  <propstat><prop><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat>
 </response>
</D:multistatus>`;
    const entries = parseMultistatus(plain, '/remote.php/dav/files/joe');
    expect(entries.map((entry) => [entry.path, entry.isDirectory, entry.size])).toEqual([
      ['/notes.xmind', false, 7],
      ['/Archivio', true, undefined],
    ]);
  });
});

describe('NextcloudClient.list', () => {
  it('fa PROPFIND Depth 1, toglie la cartella stessa e ordina cartelle prima dei file', async () => {
    const base = '/nextcloud/remote.php/dav/files/joe/Mappe%20%C3%A8';
    const listing = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
 <d:response><d:href>${base}/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
 <d:response><d:href>${base}/c.xmind</d:href><d:propstat><d:prop><d:getcontentlength>1</d:getcontentlength><d:resourcetype/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
 <d:response><d:href>${base}/Zeta/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
 <d:response><d:href>${base}/a.xmind</d:href><d:propstat><d:prop><d:getcontentlength>1</d:getcontentlength><d:resourcetype/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
 <d:response><d:href>${base}/alfa/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
</d:multistatus>`;
    const { transport, calls } = fakeTransport(() => xml(listing));
    const client = new NextcloudClient(ACCOUNT, transport);

    const entries = await client.list('/Mappe è');

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('PROPFIND');
    expect(calls[0].url).toBe('/nc/remote.php/dav/files/joe/Mappe%20%C3%A8/');
    expect(calls[0].headers.get('Depth')).toBe('1');
    expect(calls[0].headers.get('Content-Type')).toBe('application/xml; charset=utf-8');
    expect(calls[0].headers.get('X-Nextcloud-Server')).toBe(SERVER);
    expect(calls[0].headers.get('OCS-APIRequest')).toBe('true');
    expect(entries.map((entry) => entry.name)).toEqual(['alfa', 'Zeta', 'a.xmind', 'c.xmind']);
    expect(entries.map((entry) => entry.isDirectory)).toEqual([true, true, false, false]);
  });

  it('rispetta il sottopercorso del server nella radice WebDAV', async () => {
    const { transport } = fakeTransport(() => xml(MULTISTATUS));
    const client = new NextcloudClient(ACCOUNT, transport);
    const entries = await client.list('/Mappe è');
    expect(entries.map((entry) => entry.path)).toEqual(['/Mappe è/progetto & idee.xmind']);
  });
});

describe('login flow', () => {
  const POLL_ENDPOINT = `${SERVER}/index.php/login/v2/poll`;

  it('avvia il flow e ricava il percorso di poll relativo al server', async () => {
    const { transport, calls } = fakeTransport(() =>
      json({
        poll: { token: 'tok', endpoint: POLL_ENDPOINT },
        login: `${SERVER}/index.php/login/v2/flow/tok`,
      })
    );

    const flow = await startLoginFlow(`${SERVER}/`, transport);

    expect(flow).toEqual({
      loginUrl: `${SERVER}/index.php/login/v2/flow/tok`,
      pollToken: 'tok',
      pollPath: 'index.php/login/v2/poll',
    });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('/nc/index.php/login/v2');
    expect(calls[0].headers.has('Authorization')).toBe(false);
  });

  it('rifiuta un endpoint fuori dal server', async () => {
    const { transport } = fakeTransport(() =>
      json({
        poll: { token: 'tok', endpoint: 'https://evil.example.org/index.php/login/v2/poll' },
        login: 'https://evil.example.org/flow',
      })
    );
    const err = await rejectionOf(startLoginFlow(SERVER, transport));
    expect(err.code).toBe('server');
  });

  it('poll: 404 significa ancora in attesa, 200 restituisce l\'account con userId dall\'OCS', async () => {
    let polls = 0;
    const { transport, calls } = fakeTransport((call) => {
      if (call.url.endsWith('/index.php/login/v2/poll')) {
        polls += 1;
        if (polls === 1) return new Response(null, { status: 404 });
        return json({ server: 'https://other.example.org', loginName: 'joe@example.com', appPassword: 'pw-ü' });
      }
      return json({ ocs: { data: { id: 'joe', 'display-name': 'Joe Shepard' } } });
    });
    const flow = { loginUrl: 'x', pollToken: 'tok', pollPath: 'index.php/login/v2/poll' };

    expect(await pollLoginFlow(SERVER, flow, transport)).toBeNull();
    const account = await pollLoginFlow(SERVER, flow, transport);

    expect(account).toEqual({
      server: SERVER,
      loginName: 'joe@example.com',
      appPassword: 'pw-ü',
      userId: 'joe',
      displayName: 'Joe Shepard',
    });
    expect(calls[0].body).toBe('token=tok');
    expect(calls[0].headers.get('Content-Type')).toBe('application/x-www-form-urlencoded');
    const userCall = calls[calls.length - 1];
    expect(userCall.url).toBe('/nc/ocs/v2.php/cloud/user?format=json');
    expect(userCall.headers.get('Accept')).toBe('application/json');
    expect(userCall.headers.get('Authorization')).toBe(
      `Basic ${Buffer.from('joe@example.com:pw-ü', 'utf8').toString('base64')}`
    );
  });
});

describe('transfer', () => {
  it('download: preferisce OC-ETag e manda Basic auth su UTF-8', async () => {
    const { transport, calls } = fakeTransport(
      () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'OC-ETag': '"oc"', ETag: '"plain"' },
        })
    );
    const client = new NextcloudClient({ ...ACCOUNT, loginName: 'josé', appPassword: 'pw' }, transport);

    const result = await client.download('/Mappe/a.xmind');

    expect(Array.from(result.bytes)).toEqual([1, 2, 3]);
    expect(result.etag).toBe('"oc"');
    expect(calls[0].url).toBe('/nc/remote.php/dav/files/joe/Mappe/a.xmind');
    expect(calls[0].headers.get('Authorization')).toBe(`Basic ${Buffer.from('josé:pw', 'utf8').toString('base64')}`);
  });

  it('upload con ifMatch manda If-Match e restituisce il nuovo ETag', async () => {
    const { transport, calls } = fakeTransport(() => new Response(null, { status: 204, headers: { ETag: '"new"' } }));
    const client = new NextcloudClient(ACCOUNT, transport);
    const bytes = new Uint8Array([9, 8]);

    const result = await client.upload('/a.xmind', bytes, { ifMatch: '"old"' });

    expect(result).toEqual({ etag: '"new"' });
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].headers.get('If-Match')).toBe('"old"');
    expect(calls[0].headers.get('Content-Type')).toBe('application/octet-stream');
    expect(Array.from(calls[0].body as Uint8Array)).toEqual([9, 8]);
  });

  it('upload con ifMatch: 412 diventa conflict con il messaggio di modifica', async () => {
    const { transport } = fakeTransport(() => new Response(null, { status: 412 }));
    const client = new NextcloudClient(ACCOUNT, transport);
    const err = await rejectionOf(client.upload('/a.xmind', new Uint8Array(), { ifMatch: '"old"' }));
    expect(err.code).toBe('conflict');
    expect(err.status).toBe(412);
    expect(err.message).toContain('modificato da quando');
  });

  it('upload createOnly: If-None-Match e 412 con messaggio di nome già usato', async () => {
    const { transport, calls } = fakeTransport(() => new Response(null, { status: 412 }));
    const client = new NextcloudClient(ACCOUNT, transport);
    const err = await rejectionOf(client.upload('/a.xmind', new Uint8Array(), { createOnly: true }));
    expect(calls[0].headers.get('If-None-Match')).toBe('*');
    expect(err.code).toBe('conflict');
    expect(err.message).toBe('Esiste già un file con questo nome.');
  });

  it('errori: 401 è auth, 404 è not_found, errore del proxy porta il suo messaggio', async () => {
    const auth = await rejectionOf(
      new NextcloudClient(ACCOUNT, fakeTransport(() => new Response(null, { status: 401 })).transport).download('/a')
    );
    expect(auth.code).toBe('auth');
    expect(auth.message).toBe("Accesso a Nextcloud negato: ricollega l'account dalle impostazioni.");

    const missing = await rejectionOf(
      new NextcloudClient(ACCOUNT, fakeTransport(() => new Response(null, { status: 404 })).transport).download('/a')
    );
    expect(missing.code).toBe('not_found');

    const proxy = await rejectionOf(
      new NextcloudClient(
        ACCOUNT,
        fakeTransport(() => json({ error: 'Percorso non consentito dal proxy Nextcloud.' }, 403)).transport
      ).download('/a')
    );
    expect(proxy.code).toBe('proxy');
    expect(proxy.message).toBe('Percorso non consentito dal proxy Nextcloud.');
  });

  it('fetch che fallisce diventa network', async () => {
    const transport: NextcloudTransport = {
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
      proxyBase: '/nc/',
    };
    const err = await rejectionOf(new NextcloudClient(ACCOUNT, transport).download('/a'));
    expect(err.code).toBe('network');
    expect(err.message).toBe('Nextcloud non raggiungibile: controlla la connessione.');
  });

  it('revoca: 200 e 401 sono entrambi ok', async () => {
    const { transport, calls } = fakeTransport(() => new Response(null, { status: 401 }));
    await new NextcloudClient(ACCOUNT, transport).revokeAppPassword();
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toBe('/nc/ocs/v2.php/core/apppassword');
    expect(calls[0].headers.get('Authorization')).toMatch(/^Basic /);
  });
});
