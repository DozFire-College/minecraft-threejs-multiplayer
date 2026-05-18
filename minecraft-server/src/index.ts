import { WebSocketServer, WebSocket } from 'ws';

const PORT = 3000;
const wss = new WebSocketServer({ port: PORT });

interface PlayerData {
    id: string;
    position: { x: number; y: number; z: number };
    rotation: { yaw: number; pitch: number };
}

const clients = new Map<string, WebSocket>();
const players = new Map<string, PlayerData>();
let nextPlayerId = 1;

console.log(`✅ WebSocket-сервер запущен на порту ${PORT}`);

wss.on('connection', (ws: WebSocket) => {
    const playerId = `player_${nextPlayerId++}`;
    
    // Создаём данные игрока
    const playerData: PlayerData = {
        id: playerId,
        position: { x: 0, y: 30, z: 0 },
        rotation: { yaw: 0, pitch: 0 }
    };
    
    clients.set(playerId, ws);
    players.set(playerId, playerData);
    
    console.log(`➕ Игрок ${playerId} подключился. Всего игроков: ${clients.size}`);

    // Отправляем новому игроку приветствие и список всех игроков
    const allPlayers: any[] = [];
    players.forEach((p, id) => {
        allPlayers.push({ id: p.id, position: p.position, rotation: p.rotation });
    });

    ws.send(JSON.stringify({
        type: 'welcome',
        data: {
            playerId: playerId,
            players: allPlayers
        }
    }));

    // Сообщаем всем остальным о новом игроке
    broadcast({
        type: 'playerJoined',
        data: { id: playerId, position: playerData.position, rotation: playerData.rotation }
    }, playerId);

    // Обработка сообщений от клиента
    ws.on('message', (rawMessage: Buffer) => {
        try {
            const message = JSON.parse(rawMessage.toString());
            
            switch (message.type) {
                case 'playerPosition':
                    // Обновляем позицию игрока
                    if (players.has(playerId)) {
                        const player = players.get(playerId)!;
                        player.position = message.data.position;
                        player.rotation = message.data.rotation;
                        
                        // Рассылаем новую позицию всем остальным
                        broadcast({
                            type: 'playerMoved',
                            data: {
                                id: playerId,
                                position: message.data.position,
                                rotation: message.data.rotation
                            }
                        }, playerId);
                    }
                    break;
                    
                case 'chatMessage':
                    broadcast({
                        type: 'chatMessage',
                        data: {
                            playerId: playerId,
                            message: message.data.message
                        }
                    });
                    break;
            }
        } catch (error) {
            console.error('Ошибка обработки сообщения:', error);
        }
    });

    // Отключение игрока
    ws.on('close', () => {
        clients.delete(playerId);
        players.delete(playerId);
        console.log(`➖ Игрок ${playerId} отключился. Всего игроков: ${clients.size}`);
        
        broadcast({
            type: 'playerLeft',
            data: { id: playerId }
        });
    });

    ws.on('error', (error) => {
        console.error(`Ошибка соединения с ${playerId}:`, error);
    });
});

function broadcast(message: object, excludePlayerId?: string) {
    const messageString = JSON.stringify(message);
    clients.forEach((client, id) => {
        if (client.readyState === WebSocket.OPEN && id !== excludePlayerId) {
            client.send(messageString);
        }
    });
}

setInterval(() => {
    console.log(`👥 Игроков онлайн: ${clients.size}`);
}, 5000);