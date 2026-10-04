import Peer, { DataConnection } from 'peerjs';
import { NetMessage } from './Protocol';

export type NetRole = 'offline' | 'host' | 'client';

const PEER_CONFIG = {
  debug: 1,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' }
    ]
  }
};

const MAX_GUESTS = 7;
const JOIN_TIMEOUT_MS = 12000;

/** WebRTC star topology through PeerJS: the host relays nothing, it is the authority. */
export class NetworkManager {
  private peer: Peer | null = null;
  private connections = new Map<string, DataConnection>();
  private hostConnection: DataConnection | null = null;

  public role: NetRole = 'offline';
  public myPeerId: string = '';
  public isConnected: boolean = false;
  public pingMs: number = 0;
  public lastPacketTime: number = 0;
  private pingInterval: number | null = null;

  public onMessageReceived: ((msg: NetMessage, fromId: string) => void) | null = null;
  public onPeerLeft: ((peerId: string) => void) | null = null;

  /** Host: create a room. Resolves with the room code. */
  public hostRoom(): Promise<string> {
    this.close();
    this.role = 'host';
    const id = 'liero-' + Math.random().toString(36).substring(2, 8);

    return new Promise((resolve, reject) => {
      const peer = new Peer(id, PEER_CONFIG);
      this.peer = peer;
      let opened = false;

      peer.on('open', (assignedId) => {
        opened = true;
        this.myPeerId = assignedId;
        this.isConnected = true;
        this.startPing();
        resolve(assignedId);
      });

      peer.on('connection', (conn) => this.setupHostConnection(conn));

      // Lost the signalling server (idle tab, network blip): reconnect so new players can still join
      peer.on('disconnected', () => {
        if (this.peer === peer && !peer.destroyed) peer.reconnect();
      });

      peer.on('error', (err) => {
        console.error('PeerJS error:', err);
        if (!opened) {
          reject(new Error(err.type === 'unavailable-id'
            ? 'Code de salon déjà utilisé, réessayez.'
            : 'Impossible de contacter le serveur de connexion (' + err.type + ').'));
        }
      });
    });
  }

  /** Client: connect to a room. */
  public joinRoom(roomId: string): Promise<void> {
    this.close();
    this.role = 'client';
    const target = roomId.toLowerCase().trim();

    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        this.close();
        reject(new Error(message));
      };
      const timeoutId = window.setTimeout(
        () => fail("Délai dépassé : impossible de joindre l'hôte. Vérifiez le code."),
        JOIN_TIMEOUT_MS
      );

      const peer = new Peer(PEER_CONFIG);
      this.peer = peer;

      peer.on('open', (id) => {
        this.myPeerId = id;
        const conn = peer.connect(target, { reliable: true });
        this.hostConnection = conn;

        conn.on('open', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          this.isConnected = true;
          this.startPing();
          resolve();
        });
        conn.on('data', (data) => this.handleIncomingMessage(data as NetMessage, target));
        conn.on('close', () => this.handleDisconnect(target));
        conn.on('error', (err) => {
          console.error('Connection error:', err);
          fail('Impossible de rejoindre la partie.');
        });
      });

      peer.on('error', (err) => {
        console.error('Peer error on client:', err);
        if (settled) return;
        fail(err.type === 'peer-unavailable'
          ? `Le salon « ${target} » est introuvable. Vérifiez le code.`
          : 'Erreur de connexion (' + err.type + ').');
      });
    });
  }

  private setupHostConnection(conn: DataConnection) {
    if (this.connections.size >= MAX_GUESTS && !this.connections.has(conn.peer)) {
      conn.close();
      return;
    }
    this.connections.set(conn.peer, conn);
    conn.on('data', (data) => this.handleIncomingMessage(data as NetMessage, conn.peer));
    conn.on('close', () => this.handleDisconnect(conn.peer));
    conn.on('error', (err) => {
      console.error('Connection error with', conn.peer, err);
      this.handleDisconnect(conn.peer);
    });
  }

  private handleDisconnect(peerId: string) {
    if (this.role === 'offline') return; // we closed it ourselves
    if (this.role === 'host') {
      if (!this.connections.delete(peerId)) return;
    } else {
      this.isConnected = false;
    }
    this.onPeerLeft?.(peerId);
  }

  private handleIncomingMessage(msg: NetMessage, fromId: string) {
    this.lastPacketTime = performance.now();

    if (msg.type === 'PING') {
      this.sendTo(fromId, { type: 'PONG', time: msg.time });
      return;
    }
    if (msg.type === 'PONG') {
      this.pingMs = Math.max(1, Math.round(performance.now() - msg.time));
      return;
    }
    this.onMessageReceived?.(msg, fromId);
  }

  private startPing() {
    this.stopPing();
    this.lastPacketTime = performance.now();
    this.pingInterval = window.setInterval(() => {
      if (this.isConnected) this.broadcast({ type: 'PING', time: performance.now() });
    }, 1500);
  }

  private stopPing() {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  public get guestCount(): number {
    return this.connections.size;
  }

  /** Host → all guests, or client → host */
  public broadcast(msg: NetMessage) {
    if (this.role === 'host') {
      for (const conn of this.connections.values()) {
        if (conn.open) conn.send(msg);
      }
    } else if (this.role === 'client' && this.hostConnection?.open) {
      this.hostConnection.send(msg);
    }
  }

  public sendTo(peerId: string, msg: NetMessage) {
    if (this.role === 'client') {
      this.broadcast(msg);
      return;
    }
    const conn = this.connections.get(peerId);
    if (!conn) return;
    if (conn.open) conn.send(msg);
    else conn.on('open', () => conn.send(msg));
  }

  public close() {
    this.role = 'offline';
    this.isConnected = false;
    this.stopPing();
    for (const conn of this.connections.values()) conn.close();
    this.connections.clear();
    this.hostConnection?.close();
    this.hostConnection = null;
    this.peer?.destroy();
    this.peer = null;
  }
}
