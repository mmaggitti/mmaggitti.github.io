// A stand-in for the public relay, so CI never touches it. It plays the server's side of the
// automerge-repo protocol "1" the way sync.automerge.org does: answer `join` with `peer`, keep one
// Automerge document per documentId, run the sync protocol with every connection that has synced
// that document, and forward new changes to all of them. It is wired in with Playwright's
// routeWebSocket, so the page's own WebSocket to wss://sync.automerge.org lands here.
//
// It also records every frame both ways, so a test can prove nothing readable crossed the wire.
import * as A from '@automerge/automerge';
import { decode, encode } from '../web/ports/cbor.ts';

const SELF = 'stand-in-relay';
export const RELAY_HOST = 'sync.automerge.org';

export function createRelay() {
  const docs = new Map();
  const conns = new Set();
  const blocked = new Set();
  const frames = [];

  const send = (conn, m) => {
    const b = encode(m);
    frames.push(b);
    conn.ws.send(Buffer.from(b));
  };
  const flush = (conn, id) => {
    const [state, msg] = A.generateSyncMessage(docs.get(id), conn.states.get(id) ?? A.initSyncState());
    conn.states.set(id, state);
    if (msg) send(conn, { type: 'sync', senderId: SELF, targetId: conn.peer, documentId: id, data: msg });
  };
  const handle = (conn, m) => {
    if (m.type === 'join') {
      conn.peer = m.senderId;
      send(conn, { type: 'peer', senderId: SELF, peerMetadata: { storageId: 'stand-in', isEphemeral: false }, selectedProtocolVersion: '1', targetId: m.senderId });
    } else if ((m.type === 'sync' || m.type === 'request') && typeof m.documentId === 'string') {
      const id = m.documentId;
      const [doc, state] = A.receiveSyncMessage(docs.get(id) ?? A.init(), conn.states.get(id) ?? A.initSyncState(), m.data);
      docs.set(id, doc);
      conn.states.set(id, state);
      for (const c of conns) if (c === conn || c.states.has(id)) flush(c, id);
    }
  };

  return {
    frames,
    docs,
    /** Route every page of `context` that opens the relay to this stand-in, as device `name`. */
    async route(context, name) {
      await context.routeWebSocket((url) => url.hostname === RELAY_HOST, (ws) => {
        if (blocked.has(name)) {
          ws.close();
          return;
        }
        const conn = { ws, name, peer: null, states: new Map() };
        conns.add(conn);
        ws.onMessage((msg) => {
          if (typeof msg === 'string') return;
          const bytes = new Uint8Array(msg);
          frames.push(bytes);
          handle(conn, decode(bytes));
        });
        ws.onClose(() => conns.delete(conn));
      });
    },
    /** Cut device `name` off (its sockets close, new ones are refused) or let it back. */
    block(name, on) {
      if (on) {
        blocked.add(name);
        for (const c of [...conns]) if (c.name === name) {
          conns.delete(c);
          c.ws.close();
        }
      } else blocked.delete(name);
    },
    /** The relay loses everything it stored, and every connection drops. */
    wipe() {
      docs.clear();
      for (const c of [...conns]) {
        conns.delete(c);
        c.ws.close();
      }
    },
  };
}
