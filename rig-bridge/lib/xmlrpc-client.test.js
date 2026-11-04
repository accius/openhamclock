/**
 * xmlrpc-client — encode/decode round-trips and the injectable transport.
 */
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import http from 'http';
import { encodeCall, encodeValue, decodeResponse, createXmlRpcClient } from './xmlrpc-client.js';

const response = (inner) =>
  `<?xml version="1.0"?><methodResponse><params><param>${inner}</param></params></methodResponse>`;

describe('xmlrpc encode', () => {
  it('encodes scalars with the right XML-RPC types', () => {
    expect(encodeValue(42)).toBe('<value><int>42</int></value>');
    expect(encodeValue(14.074)).toBe('<value><double>14.074</double></value>');
    expect(encodeValue(true)).toBe('<value><boolean>1</boolean></value>');
    expect(encodeValue(null)).toBe('<value><nil/></value>');
    expect(encodeValue('a<b&c')).toBe('<value><string>a&lt;b&amp;c</string></value>');
    expect(encodeValue(Buffer.from('hi'))).toBe('<value><base64>aGk=</base64></value>');
  });

  it('encodes arrays and structs', () => {
    expect(encodeValue(['x', 1])).toBe(
      '<value><array><data><value><string>x</string></value><value><int>1</int></value></data></array></value>',
    );
    expect(encodeValue({ k: 'v' })).toBe(
      '<value><struct><member><name>k</name><value><string>v</string></value></member></struct></value>',
    );
  });

  it('builds a methodCall document', () => {
    expect(encodeCall('modem.set_by_name', ['BPSK31'])).toBe(
      '<?xml version="1.0"?><methodCall><methodName>modem.set_by_name</methodName><params><param><value><string>BPSK31</string></value></param></params></methodCall>',
    );
    expect(encodeCall('main.rx')).toContain('<params></params>');
  });
});

describe('xmlrpc decode', () => {
  it('decodes scalar responses', () => {
    expect(decodeResponse(response('<value><double>14070000</double></value>'))).toBe(14070000);
    expect(decodeResponse(response('<value><int>12</int></value>'))).toBe(12);
    expect(decodeResponse(response('<value><i4>-3</i4></value>'))).toBe(-3);
    expect(decodeResponse(response('<value><string>BPSK31</string></value>'))).toBe('BPSK31');
    expect(decodeResponse(response('<value>untyped &amp; text</value>'))).toBe('untyped & text');
    expect(decodeResponse(response('<value><boolean>1</boolean></value>'))).toBe(true);
    expect(decodeResponse(response('<value><nil/></value>'))).toBeNull();
  });

  it('decodes base64 into a Buffer (fldigi text getters return bytes)', () => {
    const v = decodeResponse(response('<value><base64>Q1EgQ1EgZGUgS0U4UExN\n</base64></value>'));
    expect(Buffer.isBuffer(v)).toBe(true);
    expect(v.toString('utf8')).toBe('CQ CQ de KE8PLM');
  });

  it('decodes nested arrays and structs', () => {
    const xml = response(
      '<value><array><data><value><string>BPSK31</string></value><value><struct><member><name>n</name><value><int>1</int></value></member><member><name>list</name><value><array><data><value><string>a</string></value></data></array></value></member></struct></value></data></array></value>',
    );
    expect(decodeResponse(xml)).toEqual(['BPSK31', { n: 1, list: ['a'] }]);
  });

  it('returns null for an empty params response', () => {
    expect(decodeResponse('<?xml version="1.0"?><methodResponse><params></params></methodResponse>')).toBeNull();
  });

  it('throws on a fault with code and string attached', () => {
    const xml =
      '<methodResponse><fault><value><struct><member><name>faultCode</name><value><int>1</int></value></member><member><name>faultString</name><value><string>no such method</string></value></member></struct></value></fault></methodResponse>';
    expect(() => decodeResponse(xml)).toThrow(/no such method/);
    try {
      decodeResponse(xml);
    } catch (e) {
      expect(e.faultCode).toBe(1);
      expect(e.faultString).toBe('no such method');
    }
  });

  it('rejects non-XML-RPC bodies', () => {
    expect(() => decodeResponse('<html>nope</html>')).toThrow(/Not an XML-RPC/);
  });
});

// A fake http.request that records the call and replies with a canned body.
function fakeRequest(reply, { status = 200, fail = null } = {}) {
  const seen = [];
  const request = (options, onResponse) => {
    const req = new EventEmitter();
    let body = '';
    req.setTimeout = () => {};
    req.write = (chunk) => {
      body += chunk;
    };
    req.destroy = (err) => req.emit('error', err);
    req.end = () => {
      seen.push({ options, body });
      if (fail) return setImmediate(() => req.emit('error', fail));
      const res = new EventEmitter();
      res.statusCode = status;
      setImmediate(() => {
        onResponse(res);
        res.emit('data', Buffer.from(typeof reply === 'function' ? reply(body) : reply));
        res.emit('end');
      });
    };
    return req;
  };
  return { request, seen };
}

describe('createXmlRpcClient transport', () => {
  it('POSTs a methodCall to /RPC2 and resolves the decoded value', async () => {
    const { request, seen } = fakeRequest(response('<value><string>CW</string></value>'));
    const client = createXmlRpcClient('http://127.0.0.1:7362', { request });
    await expect(client.call('modem.get_name')).resolves.toBe('CW');
    expect(seen).toHaveLength(1);
    expect(seen[0].options).toMatchObject({ hostname: '127.0.0.1', port: '7362', path: '/RPC2', method: 'POST' });
    expect(seen[0].body).toContain('<methodName>modem.get_name</methodName>');
  });

  it('rejects on HTTP errors, faults and socket errors', async () => {
    const bad = fakeRequest('oops', { status: 500 });
    await expect(createXmlRpcClient('http://h:1', { request: bad.request }).call('x')).rejects.toThrow(/HTTP 500/);

    const fault = fakeRequest(
      '<methodResponse><fault><value><struct><member><name>faultString</name><value><string>bad</string></value></member></struct></value></fault></methodResponse>',
    );
    await expect(createXmlRpcClient('http://h:1', { request: fault.request }).call('x')).rejects.toThrow(/bad/);

    const dead = fakeRequest('', { fail: new Error('ECONNREFUSED') });
    await expect(createXmlRpcClient('http://h:1', { request: dead.request }).call('x')).rejects.toThrow(/ECONNREFUSED/);
  });

  it('does not pool sockets (agent: false) — #1250', async () => {
    const { request, seen } = fakeRequest(response('<value><int>1</int></value>'));
    await createXmlRpcClient('http://127.0.0.1:7362', { request }).call('main.get_frequency');
    expect(seen[0].options.agent).toBe(false);
    expect(seen[0].options.headers.Connection).toBe('close');
  });

  it('names the method in transport errors and keeps the error code', async () => {
    const reset = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    const dead = fakeRequest('', { fail: reset });
    const client = createXmlRpcClient('http://h:1', { request: dead.request, label: 'fldigi XML-RPC' });
    const err = await client.call('main.get_frequency').catch((e) => e);
    expect(err.message).toBe('fldigi XML-RPC main.get_frequency: read ECONNRESET');
    expect(err.code).toBe('ECONNRESET');

    const bad = fakeRequest('oops', { status: 500 });
    await expect(createXmlRpcClient('http://h:1', { request: bad.request }).call('text.get_rx')).rejects.toThrow(
      'XML-RPC text.get_rx: HTTP 500',
    );
  });
});

// A server that answers one request per connection and then closes it, like
// fldigi's XML-RPC server. Pooled sockets fail against this (#1250).
describe('createXmlRpcClient over a real socket', () => {
  async function closingServer(handler) {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => handler(req, res, body));
    });
    server.keepAliveTimeout = 1;
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    return server;
  }

  it('makes eight sequential calls without a connection reset', async () => {
    let sockets = 0;
    const server = await closingServer((req, res, body) => {
      const method = body.match(/<methodName>([^<]+)<\/methodName>/)[1];
      res.writeHead(200, { 'Content-Type': 'text/xml', Connection: 'close' });
      res.end(response(encodeValue(method)));
      req.socket.destroy();
    });
    server.on('connection', () => sockets++);
    const { port } = server.address();
    try {
      const client = createXmlRpcClient(`http://127.0.0.1:${port}`, { timeout: 2000 });
      const methods = [
        'main.get_frequency',
        'fldigi.version',
        'modem.get_names',
        'modem.get_name',
        'modem.get_carrier',
        'main.get_trx_status',
        'text.get_rx_length',
        'text.get_rx',
      ];
      for (const m of methods) await expect(client.call(m)).resolves.toBe(m);
      expect(sockets).toBe(methods.length); // a fresh connection per call
    } finally {
      server.close();
    }
  });

  it('names the method when the server drops the connection or does not answer', async () => {
    const server = await closingServer((req, res, body) => {
      if (body.includes('main.get_frequency')) return req.socket.destroy();
      // modem.get_name: never answer
    });
    const { port } = server.address();
    try {
      const client = createXmlRpcClient(`http://127.0.0.1:${port}`, { timeout: 200, label: 'fldigi XML-RPC' });
      await expect(client.call('main.get_frequency')).rejects.toThrow(/^fldigi XML-RPC main\.get_frequency: /);
      await expect(client.call('modem.get_name')).rejects.toThrow('fldigi XML-RPC modem.get_name: timeout after 200ms');
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
