// The user likely has overwritten all networking functions after importing bare-client
// It is our responsibility to make sure components of Bare-Client are using native networking functions
// These exports are provided to plugins by @rollup/plugin-inject
const fetch = globalThis.fetch;
const WebSocket = globalThis.WebSocket;
const Request = globalThis.Request;
const Response = globalThis.Response;

const statusEmpty = [101, 204, 205, 304];
const statusRedirect = [301, 302, 303, 307, 308];
class BareError extends Error {
  status;
  body;
  constructor(status, body) {
    super(body.message || body.code);
    this.status = status;
    this.body = body;
  }
}
class Client {
  base;
  /**
   *
   * @param version Version provided by extension
   * @param server Bare Server URL provided by BareClient
   */
  constructor(version, server) {
    this.base = new URL(`./v${version}/`, server);
  }
}

const validChars = "!#$%&'*+-.0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ^_`abcdefghijklmnopqrstuvwxyz|~";
const reserveChar = "%";
function validProtocol(protocol) {
  for (let i = 0; i < protocol.length; i++) {
    const char = protocol[i];
    if (!validChars.includes(char)) {
      return false;
    }
  }
  return true;
}
function encodeProtocol(protocol) {
  let result = "";
  for (let i = 0; i < protocol.length; i++) {
    const char = protocol[i];
    if (validChars.includes(char) && char !== reserveChar) {
      result += char;
    } else {
      const code = char.charCodeAt(0);
      result += reserveChar + code.toString(16).padStart(2, "0");
    }
  }
  return result;
}

class ClientV1 extends Client {
  ws;
  http;
  newMeta;
  getMeta;
  constructor(server) {
    super(1, server);
    this.ws = new URL(this.base);
    this.http = new URL(this.base);
    this.newMeta = new URL("ws-new-meta", this.base);
    this.getMeta = new URL("ws-meta", this.base);
    if (this.ws.protocol === "https:") {
      this.ws.protocol = "wss:";
    } else {
      this.ws.protocol = "ws:";
    }
  }
  async connect(requestHeaders, protocol, host, port, path) {
    const assignMeta = await fetch(this.newMeta, { method: "GET" });
    if (!assignMeta.ok) {
      throw new BareError(assignMeta.status, await assignMeta.json());
    }
    const id = await assignMeta.text();
    const socket = new WebSocket(this.ws, [
      "bare",
      encodeProtocol(
        JSON.stringify({
          remote: {
            protocol,
            host,
            port,
            path,
          },
          headers: requestHeaders,
          forward_headers: [
            "accept-encoding",
            "accept-language",
            "sec-websocket-extensions",
            "sec-websocket-key",
            "sec-websocket-version",
          ],
          id,
        }),
      ),
    ]);
    socket.meta = new Promise((resolve, reject) => {
      socket.addEventListener("open", async () => {
        const outgoing = await fetch(this.getMeta, {
          headers: {
            "x-bare-id": id,
          },
          method: "GET",
        });
        if (!outgoing.ok) {
          reject(new BareError(outgoing.status, await outgoing.json()));
        }
        resolve(await outgoing.json());
      });
      socket.addEventListener("error", reject);
    });
    return socket;
  }
  async request(method, requestHeaders, body, protocol, host, proxyIp, proxyPort, port, path, cache, signal) {
    if (protocol.startsWith("blob:")) {
      const response = await fetch(`${protocol}${host}${path}`);
      const result = new Response(response.body, response);
      result.rawHeaders = Object.fromEntries(response.headers);
      result.rawResponse = response;
      return result;
    }
    const bareHeaders = {};
    if (requestHeaders instanceof Headers) {
      for (const [header, value] of requestHeaders) {
        bareHeaders[header] = value;
      }
    } else {
      for (const header in requestHeaders) {
        bareHeaders[header] = requestHeaders[header];
      }
    }
    const forwardHeaders = ["accept-encoding", "accept-language"];
    const options = {
      credentials: "omit",
      method: method,
      signal,
    };
    if (body !== undefined) {
      options.body = body;
    }
    // bare can be an absolute path containing no origin, it becomes relative to the script
    const request = new Request(this.http, options);
    this.writeBareRequest(request, protocol, host, proxyIp, proxyPort, path, port, bareHeaders, forwardHeaders);
    const response = await fetch(request);
    const readResponse = await this.readBareResponse(response);
    const result = new Response(statusEmpty.includes(readResponse.status) ? undefined : response.body, {
      status: readResponse.status,
      statusText: readResponse.statusText ?? undefined,
      headers: readResponse.headers,
    });
    result.rawHeaders = readResponse.rawHeaders;
    result.rawResponse = response;
    return result;
  }
  async readBareResponse(response) {
    if (!response.ok) {
      throw new BareError(response.status, await response.json());
    }
    const requiredHeaders = ["x-bare-status", "x-bare-status-text", "x-bare-headers"];
    for (const header of requiredHeaders) {
      if (!response.headers.has(header)) {
        throw new BareError(500, {
          code: "IMPL_MISSING_BARE_HEADER",
          id: `response.headers.${header}`,
        });
      }
    }
    const status = parseInt(response.headers.get("x-bare-status"));
    const statusText = response.headers.get("x-bare-status-text");
    const rawHeaders = JSON.parse(response.headers.get("x-bare-headers"));
    const headers = new Headers(rawHeaders);
    return {
      status,
      statusText,
      rawHeaders,
      headers,
    };
  }
  writeBareRequest(request, protocol, host, proxyIp, proxyPort, path, port, bareHeaders, forwardHeaders) {
    request.headers.set("x-bare-protocol", protocol);
    request.headers.set("x-bare-host", host);
    request.headers.set("x-bare-path", path);
    request.headers.set("x-bare-port", port.toString());
    request.headers.set("x-bare-headers", JSON.stringify(bareHeaders));
    if (proxyIp) {
      request.headers.set("x-bare-proxy-ip", proxyIp);
      proxyPort && request.headers.set("x-bare-proxy-port", proxyPort);
    }
    request.headers.set("x-bare-forward-headers", JSON.stringify(forwardHeaders));
  }
}
class ClientV2 extends Client {
  ws;
  http;
  newMeta;
  getMeta;
  constructor(server) {
    super(2, server);
    this.ws = new URL(this.base);
    this.http = new URL(this.base);
    this.newMeta = new URL("ws-new-meta", this.base);
    this.getMeta = new URL("ws-meta", this.base);
    if (this.ws.protocol === "https:") {
      this.ws.protocol = "wss:";
    } else {
      this.ws.protocol = "ws:";
    }
  }
  async connect(requestHeaders, protocol, host, port, path) {
    const assignMeta = await fetch(this.newMeta, { method: "GET" });
    if (!assignMeta.ok) {
      throw new BareError(assignMeta.status, await assignMeta.json());
    }
    const id = await assignMeta.text();
    const socket = new WebSocket(this.ws, [
      "bare",
      encodeProtocol(
        JSON.stringify({
          remote: {
            protocol,
            host,
            port,
            path,
          },
          headers: requestHeaders,
          forward_headers: [
            "accept-encoding",
            "accept-language",
            "sec-websocket-extensions",
            "sec-websocket-key",
            "sec-websocket-version",
          ],
          id,
        }),
      ),
    ]);
    socket.meta = new Promise((resolve, reject) => {
      socket.addEventListener("open", async () => {
        const outgoing = await fetch(this.getMeta, {
          headers: {
            "x-bare-id": id,
          },
          method: "GET",
        });
        if (!outgoing.ok) {
          reject(new BareError(outgoing.status, await outgoing.json()));
        }
        resolve(await outgoing.json());
      });
      socket.addEventListener("error", reject);
    });
    return socket;
  }
  async request(method, requestHeaders, body, protocol, host, proxyIp, proxyPort, port, path, cache, signal) {
    if (protocol.startsWith("blob:")) {
      const response = await fetch(`${protocol}${host}${path}`);
      const result = new Response(response.body, response);
      result.rawHeaders = Object.fromEntries(response.headers);
      result.rawResponse = response;
      return result;
    }
    const bareHeaders = {};
    if (requestHeaders instanceof Headers) {
      for (const [header, value] of requestHeaders) {
        bareHeaders[header] = value;
      }
    } else {
      for (const header in requestHeaders) {
        bareHeaders[header] = requestHeaders[header];
      }
    }
    const forwardHeaders = ["accept-encoding", "accept-language"];
    const options = {
      credentials: "omit",
      method: method,
      signal,
    };
    if (body !== undefined) {
      options.body = body;
    }
    // bare can be an absolute path containing no origin, it becomes relative to the script
    const request = new Request(this.http, options);
    this.writeBareRequest(request, protocol, host, proxyIp, proxyPort, path, port, bareHeaders, forwardHeaders);
    const response = await fetch(request);
    const readResponse = await this.readBareResponse(response);
    const result = new Response(statusEmpty.includes(readResponse.status) ? undefined : response.body, {
      status: readResponse.status,
      statusText: readResponse.statusText ?? undefined,
      headers: readResponse.headers,
    });
    result.rawHeaders = readResponse.rawHeaders;
    result.rawResponse = response;
    return result;
  }
  async readBareResponse(response) {
    if (!response.ok) {
      throw new BareError(response.status, await response.json());
    }
    const requiredHeaders = ["x-bare-status", "x-bare-status-text", "x-bare-headers"];
    for (const header of requiredHeaders) {
      if (!response.headers.has(header)) {
        throw new BareError(500, {
          code: "IMPL_MISSING_BARE_HEADER",
          id: `response.headers.${header}`,
        });
      }
    }
    const status = parseInt(response.headers.get("x-bare-status"));
    const statusText = response.headers.get("x-bare-status-text");
    const rawHeaders = JSON.parse(response.headers.get("x-bare-headers"));
    const headers = new Headers(rawHeaders);
    return {
      status,
      statusText,
      rawHeaders,
      headers,
    };
  }
  writeBareRequest(request, protocol, host, proxyIp, proxyPort, path, port, bareHeaders, forwardHeaders) {
    request.headers.set("x-bare-protocol", protocol);
    request.headers.set("x-bare-host", host);
    request.headers.set("x-bare-path", path);
    request.headers.set("x-bare-port", port.toString());
    request.headers.set("x-bare-headers", JSON.stringify(bareHeaders));
    if (proxyIp) {
      request.headers.set("x-bare-proxy-ip", proxyIp);
      proxyPort && request.headers.set("x-bare-proxy-port", proxyPort);
    }
    request.headers.set("x-bare-forward-headers", JSON.stringify(forwardHeaders));
  }
}

const clientCtors = [
  ["v2", ClientV2],
  ["v1", ClientV1],
];
const maxRedirects = 20;
async function fetchManifest(server, signal) {
  const outgoing = await fetch(server, { signal });
  if (!outgoing.ok) {
    throw new Error(`Unable to fetch Bare meta: ${outgoing.status} ${await outgoing.text()}`);
  }
  return await outgoing.json();
}
function resolvePort(url) {
  if (url.port) return Number(url.port);
  switch (url.protocol) {
    case "ws:":
    case "http:":
      return 80;
    case "wss:":
    case "https:":
      return 443;
    default:
      // maybe blob
      return 0;
  }
}
class BareClient {
  /**
   * @depricated Use .manifest instead.
   */
  get data() {
    return this.manfiest;
  }
  manfiest;
  client;
  server;
  working;
  onDemand;
  onDemandSignal;
  constructor(server, _) {
    this.server = new URL(server);
    if (!_ || _ instanceof AbortSignal) {
      this.onDemand = true;
      this.onDemandSignal = _;
    } else {
      this.onDemand = false;
      this.manfiest = _;
      this.getClient();
    }
  }
  demand() {
    if (!this.onDemand) return;
    if (!this.working)
      this.working = fetchManifest(this.server, this.onDemandSignal)
        .then((manfiest) => {
          this.manfiest = manfiest;
          this.getClient();
        })
        .catch((err) => {
          // allow the next request to re-fetch the manifest
          // this is to prevent BareClient from permanently failing when used on demand
          delete this.working;
          throw err;
        });
    return this.working;
  }
  getClient() {
    // newest-oldest
    for (const [version, ctor] of clientCtors) {
      if (this.data.versions.includes(version)) {
        this.client = new ctor(this.server);
        return;
      }
    }
    throw new Error(`Unable to find compatible client version.`);
  }
  async request(method, requestHeaders, body, protocol, host, proxyIp, proxyPort, port, path, cache, signal) {
    await this.demand();
    return await this.client.request(
      method,
      requestHeaders,
      body,
      protocol,
      host,
      proxyIp,
      proxyPort,
      port,
      path,
      cache,
      signal,
    );
  }
  async connect(requestHeaders, protocol, host, port, path) {
    await this.demand();
    return this.client.connect(requestHeaders, protocol, host, port, path);
  }
  /**
   *
   * @param url
   * @param headers
   * @param protocols
   * @returns
   */
  createWebSocket(url, headers = {}, protocols = [], proxyIp, proxyPort) {
    const requestHeaders = headers instanceof Headers ? Object.fromEntries(headers) : headers;
    url = new URL(url);
    // user is expected to specify user-agent and origin
    // both are in spec
    requestHeaders["Host"] = url.host;
    // requestHeaders['Origin'] = origin;
    requestHeaders["Pragma"] = "no-cache";
    requestHeaders["Cache-Control"] = "no-cache";
    requestHeaders["Upgrade"] = "websocket";
    // requestHeaders['User-Agent'] = navigator.userAgent;
    requestHeaders["Connection"] = "Upgrade";
    if (proxyIp) {
      requestHeaders["X-Bare-Proxy-IP"] = proxyIp;
      proxyPort && (requestHeaders["X-Bare-Proxy-Port"] = proxyPort);
    }
    if (typeof protocols === "string") {
      protocols = [protocols];
    }
    for (const proto of protocols) {
      if (!validProtocol(proto)) {
        throw new DOMException(
          `Failed to construct 'WebSocket': The subprotocol '${proto}' is invalid.`,
        );
      }
    }
    if (protocols.length) requestHeaders["Sec-Websocket-Protocol"] = protocols.join(", ");
    return this.connect(requestHeaders, url.protocol, url.hostname, resolvePort(url), url.pathname + url.search);
  }
  async fetch(url, init = {}) {
    if (url instanceof Request) {
      // behave similar to the browser when fetch is called with (Request, Init)
      if (init) {
        url = new URL(url.url);
      } else {
        init = url;
        url = new URL(url.url);
      }
    } else {
      url = new URL(url);
    }
    let method;
    if (typeof init.method === "string") {
      method = init.method;
    } else {
      method = "GET";
    }
    let body;
    if (init.body !== undefined && init.body !== null) {
      body = init.body;
    }
    let headers;
    if (typeof init.headers === "object" && init.headers !== null) {
      if (init.headers instanceof Headers) {
        headers = Object.fromEntries(init.headers);
      } else {
        headers = init.headers;
      }
    } else {
      headers = {};
    }
    let cache;
    if (typeof init.cache === "string") {
      cache = init.cache;
    } else {
      cache = "default";
    }
    let signal;
    if (init.signal instanceof AbortSignal) {
      signal = init.signal;
    }
    for (let i = 0; ; i++) {
      if ("host" in headers) headers.host = url.host;
      else headers.Host = url.host;
      const response = await this.request(
        method,
        headers,
        body,
        url.protocol,
        url.hostname,
        init.proxyIp,
        init.proxyPort,
        resolvePort(url),
        url.pathname + url.search,
        cache,
        signal,
      );
      response.finalURL = url.toString();
      if (statusRedirect.includes(response.status)) {
        switch (init.redirect) {
          default:
          case "follow":
            if (maxRedirects > i && response.headers.has("location")) {
              url = new URL(response.headers.get("location"), url);
              continue;
            }
            throw new TypeError("Failed to fetch");
          case "error":
            throw new TypeError("Failed to fetch");
          case "manual":
            return response;
        }
      }
      return response;
    }
  }
}
function createBareClient(server, manifest) {
  return new BareClient(server, manifest);
}

export { BareError, BareClient as default, createBareClient, maxRedirects, statusEmpty, statusRedirect };
