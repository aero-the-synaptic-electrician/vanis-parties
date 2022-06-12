import uWS from 'uWebSockets.js';
import { Reader, Writer } from './util';
const PORT = Number(process.env.PORT) || 6969;
const INTERVAL = Number(process.env.INTERVAL) || 500;

enum SocketState {
  NONE,
  CONFIRMED,
}

export interface SocketData {
  id?: string;
  url?: string;

  pid?: number;
  mass?: number;

  tabPid?: number;
  tabMass?: number;

  tagId?: number;
  lastUpdate: ReturnType<typeof Date.now>;
  currentLobby?: string;
  state: SocketState;

  flags: number;
  tabFlags?: number;

  pinged: boolean;
}

const httpHandler = (res: uWS.HttpResponse) => res.writeStatus('200 OK').writeHeader('Access-Control-Allow-Origin', '*').end('...\nhi\n...\nawkward...');
const headHandler = (res: uWS.HttpResponse) => res.writeStatus('200 OK').writeHeader('Access-Control-Allow-Origin', '*').end();
const listened = (s: any) => s && console.log(`Listening on port ${PORT}`);

const wsCfg = { idleTimeout: 40, maxPayloadLength: 64 } as const;
export class WsAPI {
  app: uWS.TemplatedApp;
  sockets = new Map<uWS.WebSocket, SocketData>();
  lobbies = new Map<string, Lobby>(); // key is url + '-' + tagId
  interval: NodeJS.Timeout;

  constructor() {
    this.app = uWS
      .App()
      .ws('/*', {
        ...wsCfg,
        close: this.close,
        message: this.message,
        open: this.open,
      })
      .head('/*', headHandler)
      // .get('/lobbies', this.getLobbies) // only debug purposes
      // .get('/sockets', this.getSockets) // only debug purposes
      .get('/count', this.getCount) // only debug purposes
      .get('/*', httpHandler)
      .listen(PORT, listened);

    this.interval = setInterval(this.tick, INTERVAL);
  }

  getCount = (res: uWS.HttpResponse) => res.end(JSON.stringify({ lobbies: this.lobbies.size, sockets: this.sockets.size }));

  getLobbies = (res: uWS.HttpResponse) => {
    const response = [...this.lobbies.values()].map(({ url, tagId, members }) => ({
      url,
      tagId,
      members: members.map(member => ({ ...this.sockets.get(member)! })),
    }));
    res.end(JSON.stringify(response));
  };
  getSockets = (res: uWS.HttpResponse) => {
    const response = [...this.sockets.values()];
    res.end(JSON.stringify(response));
  };

  close: uWS.WebSocketBehavior['close'] = (ws, code, message) => {
    this.lobbyLeave(ws);
    this.sockets.delete(ws);
  };
  message: uWS.WebSocketBehavior['message'] = (ws, message, isBinary) => {
    if (!isBinary) return ws.end(1003, 'Unsupported frame');
    const socket = this.sockets.get(ws)!;
    socket.lastUpdate = Date.now();

    const reader = new Reader(message);

    try {
      const opcode = reader.readUint8();
      switch (opcode) {
        // first expected packet, init
        case 1: {
          if (socket.state !== SocketState.NONE) return ws.end(1003, 'Invalid opcode');

          socket.id = reader.readString();
          if (reader.readUint8() < 1) return ws.end(1008, 'Outdated script');
          socket.state = SocketState.CONFIRMED;
          ws.send(new Uint8Array([1]), true);
          break;
        }
        // all player's data: url, tagId, pid and mass + tab data?
        case 2: {
          if (socket.state === SocketState.NONE) return ws.end(1003, 'Invalid opcode');

          const newUrl = reader.readString();
          const newTagId = reader.readUint16();
          socket.pid = reader.readUint16();
          socket.mass = reader.readUint32();
          socket.flags = reader.readUint8();

          // support for scripts with built-in tabbing/minioning
          if (reader.view.byteLength > reader.offset) {
            socket.tabPid = reader.readUint16();
            socket.tabMass = reader.readUint32();
            socket.tabFlags = reader.readUint8();
          } else {
            delete socket.tabPid;
            delete socket.tabMass;
            delete socket.tabFlags;
          }

          if (newUrl !== 'null' && newTagId !== 0 && socket.pid !== 0) {
            if (newUrl !== socket.url || newTagId !== socket.tagId) this.lobbyChange(ws, newUrl, newTagId);
          } else this.lobbyLeave(ws);

          socket.url = newUrl;
          socket.tagId = newTagId;
          break;
        }
        // ping, debug purposes
        // case 3: {
        //   ws.send(new Uint8Array([3]), true);
        // }
        // marker
        case 4: {
          if (socket.state === SocketState.NONE) return ws.end(1003, 'Invalid opcode');

          const [x, y] = [reader.readInt16(), reader.readInt16()];
          const duration = 5 * 1000;
          const validUntil = Date.now() + duration;

          const lobby = socket.currentLobby ? this.lobbies.get(socket.currentLobby) : undefined;
          if (lobby) {
            const marker = new Writer(1 + 2 + 2 + 2 + 8).writeUint8(4).writeUint16(socket.pid!).writeInt16(x).writeInt16(y).writeFloat64(validUntil).raw.buffer;
            lobby.members.forEach(ws => ws.send(marker, true));
          }
          break;
        }
      }
    } catch (e) {
      console.error(e);
      ws.end(1002, 'Malformed frame');
    }
  };
  open: uWS.WebSocketBehavior['open'] = ws => this.sockets.set(ws, { lastUpdate: Date.now(), state: SocketState.NONE, flags: 0, pinged: false });

  lobbyChange = (ws: uWS.WebSocket, url: string, tagId: number) => {
    this.lobbyLeave(ws);
    this.lobbyJoin(ws, url, tagId);
  };
  lobbyLeave = (ws: uWS.WebSocket) => {
    const socket = this.sockets.get(ws)!;
    if (socket.currentLobby) {
      const lobby = this.lobbies.get(socket.currentLobby);
      if (!lobby) return void delete socket.currentLobby;

      lobby.remove(ws);
      if (lobby.members.length === 0) this.lobbies.delete(socket.currentLobby);
      delete socket.currentLobby;
    }
  };
  lobbyJoin = (ws: uWS.WebSocket, url: string, tagId: number) => {
    const socket = this.sockets.get(ws)!;
    const key = `${url}-${tagId}`;

    const lobby = this.lobbies.get(key) || new Lobby(url, tagId);
    this.lobbies.set(key, lobby);

    lobby.add(ws);
    socket.currentLobby = key;
  };

  tick = () => {
    const now = Date.now();

    // check sockets for inactivity
    this.sockets.forEach((socket, ws) => {
      const inactiveTime = now - socket.lastUpdate;
      if (inactiveTime >= 40_000 && socket.pinged === true) ws.end(1000, 'AFK');
      else if (inactiveTime >= 30_000) {
        if (!socket.pinged) ws.send(new Uint8Array([3]), true); // server-side ping in case user is tabbed out
        socket.pinged = true;
      } else socket.pinged = false;
    });

    // send actual data
    this.lobbies.forEach(lobby => {
      const amount = lobby.members.reduce((acc, ws) => (this.sockets.get(ws)!.tabPid ? acc + 2 : acc + 1), 0);
      //    opcode + amount as uint8 + pid,mass pairs
      const packet = new Writer(2 + amount * (2 + 4 + 1));
      packet.writeUint8(2);
      packet.writeUint8(amount);
      lobby.members.forEach(ws => {
        const socket = this.sockets.get(ws)!;
        packet.writeUint16(socket.pid!).writeUint32(socket.mass!).writeUint8(socket.flags);
        if (socket.tabPid) packet.writeUint16(socket.tabPid!).writeUint32(socket.tabMass!).writeUint8(socket.tabFlags!);
      });
      // packet for a lobby prepared, send it to all members

      lobby.members.forEach(ws => ws.send(packet.raw.buffer, true));
    });
  };
}

// I am not proud of this
export class Lobby {
  members: uWS.WebSocket[] = [];
  constructor(public url: string, public tagId: number) {}
  add(ws: uWS.WebSocket) {
    this.members.push(ws);
  }
  remove(ws: uWS.WebSocket) {
    const index = this.members.indexOf(ws);
    if (index !== -1) this.members.splice(index, 1);
  }
}
