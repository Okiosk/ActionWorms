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
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      { urls: 'stun:stun.services.mozilla.com' },
      { urls: 'stun:global.stun.twilio.com:3478' }
    ],
    iceCandidatePoolSize: 10
  }
};

export class NetworkManager {
  private peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();
  private hostConnection: DataConnection | null = null;

  public role: NetRole = 'offline';
  public myPeerId: string = '';
  public isConnected: boolean = false;
  public pingMs: number = 0;
  public packetsReceivedPerSec: number = 0;
  public lastPacketTime: number = 0;

  private packetCountWindow: number = 0;
  private statInterval: number | null = null;
  private pingInterval: number | null = null;

  // Callbacks
  public onMessageReceived: ((msg: NetMessage, fromId: string) => void) | null = null;
  public onPeerJoined: ((peerId: string) => void) | null = null;
  public onPeerLeft: ((peerId: string) => void) | null = null;
  public onConnected: ((peerId: string) => void) | null = null;
  public onError: ((err: string) => void) | null = null;

  // Host: Create a Room
  public async hostRoom(roomId?: string): Promise<string> {
    this.close();
    this.role = 'host';

    return new Promise((resolve, reject) => {
      // Auto-generate clean 6-character room id in lowercase
      const id = (roomId || 'liero-' + Math.random().toString(36).substring(2, 8)).toLowerCase();

      try {
        this.peer = new Peer(id, PEER_CONFIG);

        this.peer.on('open', (assignedId) => {
          this.myPeerId = assignedId;
          this.isConnected = true;
          this.onConnected?.(assignedId);
          resolve(assignedId);
        });

        this.peer.on('connection', (conn) => {
          this.setupHostConnection(conn);
        });

        this.peer.on('error', (err) => {
          console.error('PeerJS error:', err);
          let errText = err.message || 'Erreur réseau';
          if (err.type === 'unavailable-id') {
            errText = 'Identifiant de salon déjà utilisé, réessayez.';
          }
          this.onError?.(errText);
          reject(new Error(errText));
        });
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.onError?.(errorMsg);
        reject(err);
      }
    });
  }

  // Client: Join a Room
  public async joinRoom(targetRoomId: string): Promise<void> {
    this.close();
    this.role = 'client';

    const cleanTarget = targetRoomId.toLowerCase().trim();

    return new Promise((resolve, reject) => {
      let timeoutId: number | null = null;
      let isSettled = false;

      // 12-second timeout to prevent infinite spinner
      timeoutId = window.setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          this.close();
          const err = new Error('Délai dépassé (12s) : Impossible de joindre l\'hôte. Vérifiez le code.');
          this.onError?.(err.message);
          reject(err);
        }
      }, 12000);

      try {
        this.peer = new Peer(PEER_CONFIG);

        this.peer.on('open', (id) => {
          this.myPeerId = id;
          // Connect using native standard WebRTC DataChannel (reliable & ordered SCTP by default)
          const conn = this.peer!.connect(cleanTarget);
          this.hostConnection = conn;

          conn.on('open', () => {
            if (!isSettled) {
              isSettled = true;
              if (timeoutId) clearTimeout(timeoutId);
              this.isConnected = true;
              this.startMonitoring();
              this.onConnected?.(cleanTarget);
              resolve();
            }
          });

          conn.on('data', (data) => {
            this.handleIncomingMessage(data, cleanTarget);
          });

          conn.on('close', () => {
            this.isConnected = false;
            this.stopMonitoring();
            this.onPeerLeft?.(cleanTarget);
          });

          conn.on('error', (err) => {
            console.error('Connection error:', err);
            if (!isSettled) {
              isSettled = true;
              if (timeoutId) clearTimeout(timeoutId);
              this.onError?.('Impossible de rejoindre la partie.');
              reject(err);
            }
          });
        });

        this.peer.on('error', (err) => {
          console.error('Peer error on client:', err);
          if (!isSettled) {
            isSettled = true;
            if (timeoutId) clearTimeout(timeoutId);
            let msg = 'Erreur de connexion : ' + err.type;
            if (err.type === 'peer-unavailable') {
              msg = `Le salon "${cleanTarget}" est introuvable. Assurez-vous que l'hôte a bien créé la partie.`;
            }
            this.onError?.(msg);
            reject(new Error(msg));
          }
        });
      } catch (err: unknown) {
        if (timeoutId) clearTimeout(timeoutId);
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.onError?.(errorMsg);
        reject(err);
      }
    });
  }

  private setupHostConnection(conn: DataConnection) {
    console.log('[NET HOST] Incoming connection from:', conn.peer, 'conn.open:', conn.open);
    if (this.connections.size >= 7 && !this.connections.has(conn.peer)) {
      console.warn('[NET HOST] Room is full (max 8 players), rejecting connection:', conn.peer);
      conn.close();
      return;
    }
    this.connections.set(conn.peer, conn);

    const onOpen = () => {
      console.log('[NET HOST] Connection OPEN with:', conn.peer);
      this.connections.set(conn.peer, conn);
      this.startMonitoring();
      this.onPeerJoined?.(conn.peer);
    };

    if (conn.open) {
      onOpen();
    } else {
      conn.on('open', onOpen);
    }

    conn.on('data', (data) => {
      if (!this.connections.has(conn.peer)) {
        this.connections.set(conn.peer, conn);
      }
      this.handleIncomingMessage(data, conn.peer);
    });

    conn.on('close', () => {
      console.log('[NET HOST] Connection CLOSED with:', conn.peer);
      this.connections.delete(conn.peer);
      if (this.connections.size === 0) {
        this.stopMonitoring();
      }
      this.onPeerLeft?.(conn.peer);
    });

    conn.on('error', (err) => {
      console.error('[NET HOST] Connection ERROR with:', conn.peer, err);
      this.connections.delete(conn.peer);
      if (this.connections.size === 0) {
        this.stopMonitoring();
      }
      this.onPeerLeft?.(conn.peer);
    });
  }

  private handleIncomingMessage(rawMsg: unknown, fromId: string) {
    const msg = rawMsg as NetMessage;
    if (msg.type === 'JOIN' || msg.type === 'WELCOME' || msg.type === 'MATCH_OVER') {
      console.log(`[NET RECV ${this.role}] type:`, msg.type, 'from:', fromId);
    }
    this.lastPacketTime = performance.now();
    this.packetCountWindow++;

    if (msg.type === 'PING') {
      if (this.role === 'host') {
        this.sendTo(fromId, { type: 'PONG', time: msg.time });
      } else {
        this.broadcast({ type: 'PONG', time: msg.time });
      }
      return;
    }

    if (msg.type === 'PONG') {
      this.pingMs = Math.max(1, Math.round(performance.now() - msg.time));
      return;
    }

    this.onMessageReceived?.(msg, fromId);
  }

  private startMonitoring() {
    this.stopMonitoring();

    this.packetCountWindow = 0;
    this.packetsReceivedPerSec = 0;
    this.lastPacketTime = performance.now();

    this.statInterval = window.setInterval(() => {
      this.packetsReceivedPerSec = this.packetCountWindow;
      this.packetCountWindow = 0;
    }, 1000);

    this.pingInterval = window.setInterval(() => {
      if (this.isConnected) {
        this.broadcast({ type: 'PING', time: performance.now() });
      }
    }, 1200);
  }

  private stopMonitoring() {
    if (this.statInterval !== null) {
      clearInterval(this.statInterval);
      this.statInterval = null;
    }
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  // Broadcast message from host to all clients or send to host
  public broadcast(msg: NetMessage) {
    if (this.role === 'host') {
      for (const conn of this.connections.values()) {
        if (conn && conn.open) {
          conn.send(msg);
        }
      }
    } else if (this.role === 'client') {
      if (this.hostConnection && this.hostConnection.open) {
        this.hostConnection.send(msg);
      }
    }
  }

  public sendTo(peerId: string, msg: NetMessage) {
    const conn = this.connections.get(peerId);
    if (!conn) {
      console.warn(`[NET sendTo]: No connection found for peer ${peerId}`);
      return;
    }
    if (conn.open) {
      conn.send(msg);
    } else {
      conn.on('open', () => {
        conn.send(msg);
      });
    }
  }

  public close() {
    for (const conn of this.connections.values()) {
      conn.close();
    }
    this.connections.clear();

    if (this.hostConnection) {
      this.hostConnection.close();
      this.hostConnection = null;
    }

    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }

    this.role = 'offline';
    this.isConnected = false;
    this.stopMonitoring();
  }
}
