export class NetworkManager {
    private socket: WebSocket | null = null;
    private playerId: string = '';
    private onMessageCallbacks: Map<string, (data: any) => void> = new Map();
    private reconnectTimer: number | null = null;
    private serverUrl: string;
    private otherPlayers: Map<string, any> = new Map();

    constructor(serverUrl: string = 'ws://localhost:3000') {
        this.serverUrl = serverUrl;
    }

    connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
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
        
        // Вызываем зарегистрированные обработчики
        const callback = this.onMessageCallbacks.get(type);
        if (callback) {
            callback(data);
        }

        switch (type) {
            case 'welcome':
                this.playerId = data.playerId;
                console.log(`👤 Мой ID: ${this.playerId}`);
                // Сохраняем всех существующих игроков
                if (data.players) {
                    data.players.forEach((p: any) => {
                        if (p.id !== this.playerId) {
                            this.otherPlayers.set(p.id, p);
                        }
                    });
                }
                break;
                
            case 'playerJoined':
                this.otherPlayers.set(data.id, data);
                break;
                
            case 'playerMoved':
                if (this.otherPlayers.has(data.id)) {
                    const player = this.otherPlayers.get(data.id);
                    player.position = data.position;
                    player.rotation = data.rotation;
                }
                break;
                
            case 'playerLeft':
                this.otherPlayers.delete(data.id);
                break;
        }
    }

    // Отправка позиции на сервер
    sendPosition(position: { x: number; y: number; z: number }, rotation: { yaw: number; pitch: number }) {
        this.send('playerPosition', { position, rotation });
    }

    send(type: string, data: any = {}) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            const message = { type, data };
            this.socket.send(JSON.stringify(message));
        }
    }

    on(type: string, callback: (data: any) => void) {
        this.onMessageCallbacks.set(type, callback);
    }

    getOtherPlayers(): Map<string, any> {
        return this.otherPlayers;
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

    isConnected(): boolean {
        return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
    }
}