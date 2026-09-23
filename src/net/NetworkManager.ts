import Peer, { DataConnection } from 'peerjs';
import { NetMessage } from './Protocol';

export type NetRole = 'offline' | 'host' | 'client';

export class NetworkManager {
  private peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();
  private hostConnection: DataConnection | null = null;

  public role: NetRole = 'offline';
  public myPeerId: string = '';
  public isConnected: boolean = false;
  public pingMs: number = 0;

  // Callbacks
  public onMessageReceived: ((msg: NetMessage, fromId: string) => void) | null = null;
  public onPeerJoined: ((peerId: string) => void) | null = null;
  public onPeerLeft: ((peerId: string) => void) | null = null;
  public onConnected: ((peerId: string) => void) | null = null;
  public onError: ((err: string) => void) | null = null;

  // Host: Create a Room
  public async hostRoom(roomId?: string): Promise<string> {
    this.role = 'host';
    this.close();

    return new Promise((resolve, reject) => {
      // Auto-generate clean 6-character room id if not given
      const id = roomId || 'liero-' + Math.random().toString(36).substring(2, 8);

      try {
        this.peer = new Peer(id, {
          debug: 1
        });

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
          this.onError?.(err.message || 'Erreur réseau');
          reject(err);
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
    this.role = 'client';
    this.close();

    return new Promise((resolve, reject) => {
      try {
        this.peer = new Peer({
          debug: 1
        });

        this.peer.on('open', (id) => {
          this.myPeerId = id;
          const conn = this.peer!.connect(targetRoomId, {
            reliable: true
          });

          this.hostConnection = conn;

          conn.on('open', () => {
            this.isConnected = true;
            this.onConnected?.(targetRoomId);
            resolve();
          });

          conn.on('data', (data) => {
            this.onMessageReceived?.(data as NetMessage, targetRoomId);
          });

          conn.on('close', () => {
            this.isConnected = false;
            this.onPeerLeft?.(targetRoomId);
          });

          conn.on('error', (err) => {
            console.error('Connection error:', err);
            this.onError?.('Impossible de rejoindre la partie.');
            reject(err);
          });
        });

        this.peer.on('error', (err) => {
          console.error('Peer error:', err);
          this.onError?.('Erreur de connexion : ' + err.type);
          reject(err);
        });
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.onError?.(errorMsg);
        reject(err);
      }
    });
  }

  private setupHostConnection(conn: DataConnection) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      this.onPeerJoined?.(conn.peer);
    });

    conn.on('data', (data) => {
      this.onMessageReceived?.(data as NetMessage, conn.peer);
    });

    conn.on('close', () => {
      this.connections.delete(conn.peer);
      this.onPeerLeft?.(conn.peer);
    });

    conn.on('error', (err) => {
      console.error('Host connection error:', err);
      this.connections.delete(conn.peer);
      this.onPeerLeft?.(conn.peer);
    });
  }

  // Broadcast message from host to all clients or send to host
  public broadcast(msg: NetMessage) {
    if (this.role === 'host') {
      for (const conn of this.connections.values()) {
        if (conn.open) {
          conn.send(msg);
        }
      }
    } else if (this.role === 'client' && this.hostConnection && this.hostConnection.open) {
      this.hostConnection.send(msg);
    }
  }

  public sendTo(peerId: string, msg: NetMessage) {
    const conn = this.connections.get(peerId);
    if (conn && conn.open) {
      conn.send(msg);
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
  }
}
