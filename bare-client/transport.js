import BareClient from "./bare-client.js";

const resolveServerUrl = (server) => {
  try {
    return new URL(server, self.location.origin).toString();
  } catch {
    return server;
  }
};

export default class BareTransport {
  ready = false;
  client = null;
  server;

  constructor(opts = {}) {
    this.server = opts.server || "/bare/";
  }

  async init() {
    if (this.ready) return;
    const serverUrl = resolveServerUrl(this.server);
    this.client = new BareClient(serverUrl);
    this.ready = true;
  }

  async request(remote, method, body, headers, signal) {
    if (!this.ready) {
      await this.init();
    }
    const response = await this.client.fetch(remote.toString(), {
      method,
      body: body ?? undefined,
      headers: headers ?? {},
      signal,
      redirect: "manual",
    });
    return {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers),
      body: response.body,
    };
  }

  connect(url, protocols, requestHeaders, onOpen, onMessage, onClose, onError) {
    const ws = this.client.createWebSocket(
      url.toString(),
      requestHeaders ?? {},
      protocols ?? [],
    );
    ws.addEventListener("open", () => {
      if (onOpen) onOpen(ws.protocol || "");
    });
    ws.addEventListener("message", (event) => {
      if (onMessage) onMessage(event.data);
    });
    ws.addEventListener("close", (event) => {
      if (onClose) onClose(event.code, event.reason);
    });
    ws.addEventListener("error", (event) => {
      if (onError) onError(event);
    });
    const send = (data) => ws.send(data);
    const close = (code, reason) => ws.close(code, reason);
    return [send, close];
  }
}
