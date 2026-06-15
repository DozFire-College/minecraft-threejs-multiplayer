export type NetworkPlayerState = {
    id: string;
    nickname?: string;
    position: { x: number; y: number; z: number };
    rotation: { yaw: number; pitch: number };
    isMoving: boolean;
    avatarYaw: number;
}

export class NetworkManager {
    private socket: WebSocket | null = null;
    private playerId: string = '';
    private onMessageCallbacks: Map<string, (data: any) => void> = new Map();
    private reconnectTimer: number | null = null;
    private serverUrl: string;
    private otherPlayers: Map<string, NetworkPlayerState> = new Map();
    private chunkRequestDelay = 40
    private lastChunkRequestTime = 0

    constructor(serverUrl: string = 'ws://localhost:3000') {
        this.serverUrl = serverUrl;
    }

    connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
                    resolve();
                    return;
                }

                console.log('🔌 Пытаюсь подключиться к:', this.serverUrl);
                this.socket = new WebSocket(this.serverUrl);
                
                const timeout = setTimeout(() => {
                    if (this.socket && this.socket.readyState !== WebSocket.OPEN) {
                        this.socket.close();
                        reject(new Error('Таймаут подключения к серверу'));
                    }
                }, 5000);

                this.socket.onopen = () => {
                    clearTimeout(timeout);
                    console.log('🟢 Подключены к серверу!');
                    if (this.reconnectTimer) {
                        clearTimeout(this.reconnectTimer);
                        this.reconnectTimer = null;
                    }
                    resolve();
                };

                this.socket.onmessage = (event) => {
                    try {
                        const message = JSON.parse(event.data);
                        this.handleMessage(message);
                    } catch (error) {
                        console.error('Ошибка парсинга сообщения:', error);
                    }
                };

                this.socket.onclose = (event) => {
                    clearTimeout(timeout);
                    console.log('🔴 Соединение с сервером потеряно');
                    this.socket = null;
                    if (!event.wasClean) {
                        this.scheduleReconnect();
                    }
                };

                this.socket.onerror = (error) => {
                    clearTimeout(timeout);
                    console.error('❌ Ошибка WebSocket:', error);
                };

            } catch (error) {
                console.error('❌ Не удалось создать WebSocket:', error);
                reject(error);
            }
        });
    }

    
    private scheduleReconnect() {
        if (!this.reconnectTimer) {
            console.log('🔄 Попытка переподключения через 3 секунды...');
            this.reconnectTimer = window.setTimeout(() => {
                this.connect().catch(() => {
                    console.log('⏳ Сервер всё ещё недоступен');
                });
            }, 3000);
        }
    }

    private handleMessage(message: any) {
        const { type, data } = message;
        
       
        const callback = this.onMessageCallbacks.get(type);
        if (callback) {
            callback(data);
        }

        switch (type) {
            case 'welcome':
                this.playerId = data.playerId;
                console.log(`👤 Мой ID: ${this.playerId}`);
             
                if (data.players) {
                    data.players.forEach((p: NetworkPlayerState) => {
                        if (p.id !== this.playerId) {
                            this.otherPlayers.set(p.id, {
                                ...p,
                                nickname: p.nickname ?? p.id,
                                isMoving: p.isMoving ?? false,
                                avatarYaw: p.avatarYaw ?? Math.PI
                            });
                        }
                    });
                }
                break;
                
            case 'playerJoined':
                this.otherPlayers.set(data.id, {
                    ...data,
                    nickname: data.nickname ?? data.id,
                    isMoving: data.isMoving ?? false,
                    avatarYaw: data.avatarYaw ?? Math.PI
                });
                break;
                
            case 'playerMoved':
                if (this.otherPlayers.has(data.id)) {
                    const player = this.otherPlayers.get(data.id);
                    if (!player) {
                        break;
                    }

                    player.position = data.position;
                    player.rotation = data.rotation;
                    player.isMoving = data.isMoving ?? false;
                    player.avatarYaw = data.avatarYaw ?? player.avatarYaw;
                }
                break;
                
            case 'playerLeft':
                this.otherPlayers.delete(data.id);
                break;

            case 'playerNickname':
                if (this.otherPlayers.has(data.id)) {
                    const player = this.otherPlayers.get(data.id);
                    if (!player) {
                        break;
                    }
                    player.nickname = typeof data.nickname === 'string' ? data.nickname : player.nickname;
                }
                break;
        }
    }

  
    sendPosition(
        position: { x: number; y: number; z: number },
        rotation: { yaw: number; pitch: number },
        state: { isMoving: boolean; avatarYaw: number }
    ) {
        this.send('playerPosition', { position, rotation, ...state });
    }

    setNickname(nickname: string) {
        this.send('setNickname', { nickname })
    }

   send(type: string, data: any = {}): boolean {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        const message = { type, data };
        this.socket.send(JSON.stringify(message));
        return true
    }

    return false
  }

  requestChunk(chunkX: number, chunkZ: number): boolean {
    if (!this.isConnected()) {
      return false
    }

    const now = Date.now()
    if (now - this.lastChunkRequestTime < this.chunkRequestDelay) {
      setTimeout(() => this.requestChunk(chunkX, chunkZ), this.chunkRequestDelay)
      return true
    }
    this.lastChunkRequestTime = now
    return this.send('requestChunk', { chunkX, chunkZ })
  }
  breakBlock(x: number, y: number, z: number) {
    this.send('blockBreak', { x, y, z });
  }
  
  placeBlock(x: number, y: number, z: number, type: number) {
    this.send('blockPlace', { position: { x, y, z }, type });
  }
  
  requestChunks(centerX: number, centerZ: number, radius: number = 3) {
    this.send('requestChunks', { centerX, centerZ, radius });
  }

    on(type: string, callback: (data: any) => void) {
        this.onMessageCallbacks.set(type, callback);
    }

    getOtherPlayers(): Map<string, NetworkPlayerState> {
        return this.otherPlayers;
    }
    getWorldSeed(): number {
        return 12345 
    }
    syncWorldSeed() {
        this.send('worldSeed', { seed: this.getWorldSeed() })
    }

    disconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
    }

    getPlayerId(): string {
        return this.playerId;
    }

    public isConnected = (): boolean => {
  return this.socket !== null && this.socket.readyState === WebSocket.OPEN
}
}
