import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const noOp: NonNullable<Transport["onclose"]> = () => {};
const noOpError: NonNullable<Transport["onerror"]> = () => {};
const noOpMessage: NonNullable<Transport["onmessage"]> = () => {};

export function asMcpTransport(transport: StreamableHTTPServerTransport): Transport {
  return {
    close: () => transport.close(),
    get onclose() {
      return transport.onclose ?? noOp;
    },
    set onclose(handler) {
      transport.onclose = handler;
    },
    get onerror() {
      return transport.onerror ?? noOpError;
    },
    set onerror(handler) {
      transport.onerror = handler;
    },
    get onmessage() {
      return transport.onmessage ?? noOpMessage;
    },
    set onmessage(handler) {
      transport.onmessage = handler;
    },
    send: (message, options) => transport.send(message, options),
    start: () => transport.start(),
  };
}
