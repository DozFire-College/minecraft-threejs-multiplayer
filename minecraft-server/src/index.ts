// minecraft-server/src/index.ts
import { WebSocketServer, WebSocket } from 'ws';
import { ServerNoise } from './noise';

const PORT = 3000;
const CHUNK_SIZE = 24;
const VIEW_DISTANCE = 1;
const CHUNK_PART_SIZE = 5000;
const wss = new WebSocketServer({ port: PORT });


const worldGenerator = new ServerNoise();
const WORLD_SEED = ServerNoise.getWorldSeed();


const chunkCache = new Map<string, { blocks: Map<string, number>; hash: string }>();

interface PlayerData {
    id: string;
    nickname: string;
    position: { x: number; y: number; z: number };
    rotation: { yaw: number; pitch: number };
    isMoving: boolean;
    avatarYaw: number;
}

const clients = new Map<string, WebSocket>();
const players = new Map<string, PlayerData>();
let nextPlayerId = 1;


function computeChunkHash(blocks: Map<string, number>): string {
    let hash = 0;
    for (const [key, value] of blocks) {
        hash = ((hash << 5) - hash) + (key.length + value);
        hash = hash & hash;
    }
    return hash.toString(16);
}


function generateTree(blocks: Map<string, number>, x: number, z: number, groundHeight: number) {
    for (let i = 1; i <= 10; i++) {
        const key = `${x}_${groundHeight + i}_${z}`;
        if (!blocks.has(key)) {
            blocks.set(key, 2); // tree
        }
    }
    
  
    const leafStartY = groundHeight + 10;
    
    blocks.set(`${x}_${leafStartY + 2}_${z}`, 3);
    
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dz === 0) continue;
            blocks.set(`${x + dx}_${leafStartY + 1}_${z + dz}`, 3);
        }
    }
    
   
    for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
            if (Math.abs(dx) + Math.abs(dz) <= 3) {
                blocks.set(`${x + dx}_${leafStartY}_${z + dz}`, 3);
            }
        }
    }
    
  
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            blocks.set(`${x + dx}_${leafStartY - 1}_${z + dz}`, 3);
        }
    }
}


function generateChunk(chunkX: number, chunkZ: number, chunkSize: number = CHUNK_SIZE): Map<string, number> {
    const chunkKey = `${chunkX}_${chunkZ}`;
    
    if (chunkCache.has(chunkKey)) {
        console.log(`📦 Чанк ${chunkKey} взят из кэша, хеш: ${chunkCache.get(chunkKey)!.hash}`);
        return new Map(chunkCache.get(chunkKey)!.blocks);
    }
    
    console.log(`🆕 Генерация нового чанка ${chunkKey}`);
    const blocks = new Map<string, number>();
    
  
    for (let x = chunkX * chunkSize; x < (chunkX + 1) * chunkSize; x++) {
        for (let z = chunkZ * chunkSize; z < (chunkZ + 1) * chunkSize; z++) {
            const groundHeight = worldGenerator.getGroundHeight(x, z);
   
            for (let y = 0; y <= groundHeight; y++) {
                const blockType = worldGenerator.getBlockType(x, y, z);
                if (blockType !== null) {
                    blocks.set(`${x}_${y}_${z}`, blockType);
                }
            }
            
  
            if (worldGenerator.shouldGenerateTree(x, z, groundHeight)) {
                generateTree(blocks, x, z, groundHeight);
            }
        }
    }
    
    const hash = computeChunkHash(blocks);
    chunkCache.set(chunkKey, { blocks, hash });
    console.log(`🌲 Чанк ${chunkKey} сгенерирован, блоков: ${blocks.size}, хеш: ${hash}`);
    
  
    return new Map(blocks);
}

function ensureChunkCached(chunkX: number, chunkZ: number) {
    const chunkKey = `${chunkX}_${chunkZ}`;
    if (!chunkCache.has(chunkKey)) {
        generateChunk(chunkX, chunkZ);
    }

    return chunkCache.get(chunkKey)!;
}

function applyBlockUpdate(x: number, y: number, z: number, type: number | null) {
    const chunkX = Math.floor(x / CHUNK_SIZE);
    const chunkZ = Math.floor(z / CHUNK_SIZE);
    const chunkEntry = ensureChunkCached(chunkX, chunkZ);
    const blockKey = `${x}_${y}_${z}`;

    if (type === null) {
        chunkEntry.blocks.delete(blockKey);
    } else {
        chunkEntry.blocks.set(blockKey, type);
    }

    chunkEntry.hash = computeChunkHash(chunkEntry.blocks);
}

function sendChunkToPlayer(ws: WebSocket, chunkX: number, chunkZ: number) {
    const chunk = ensureChunkCached(chunkX, chunkZ);
    const blocksArray = Array.from(chunk.blocks.entries());
    
    console.log(`📤 Отправка чанка ${chunkX}_${chunkZ} игроку, блоков: ${blocksArray.length}`);
    
    const totalParts = Math.ceil(blocksArray.length / CHUNK_PART_SIZE);
    
    for (let part = 0; part < totalParts; part++) {
        const start = part * CHUNK_PART_SIZE;
        const end = Math.min(start + CHUNK_PART_SIZE, blocksArray.length);
        const partBlocks = blocksArray.slice(start, end);
        
        ws.send(JSON.stringify({
            type: 'chunkData',
            data: {
                chunkX,
                chunkZ,
                blocks: partBlocks,
                isLastPart: part === totalParts - 1,
                part: part,
                totalParts: totalParts,
                chunkHash: chunk.hash
            }
        }));
    }
}

console.log(`✅ WebSocket-сервер запущен на порту ${PORT}`);
console.log(`🌍 Seed мира: ${WORLD_SEED}`);
console.log(`📐 Размер чанка: ${CHUNK_SIZE} блока`);
console.log(`👁️ Базовая дистанция отрисовки: ${VIEW_DISTANCE} чанк(а)`);

wss.on('connection', (ws: WebSocket) => {
    const playerId = `player_${nextPlayerId++}`;
    
    const playerData: PlayerData = {
        id: playerId,
        nickname: playerId,
        position: { x: 0, y: 30, z: 0 },
        rotation: { yaw: 0, pitch: 0 },
        isMoving: false,
        avatarYaw: Math.PI
    };
    
    clients.set(playerId, ws);
    players.set(playerId, playerData);
    
    console.log(`➕ Игрок ${playerId} подключился. Всего игроков: ${clients.size}`);

    const existingPlayers = Array.from(players.values())
        .filter(player => player.id !== playerId)
        .map(player => ({
            id: player.id,
            nickname: player.nickname,
            position: player.position,
            rotation: player.rotation,
            isMoving: player.isMoving,
            avatarYaw: player.avatarYaw
        }));

    ws.send(JSON.stringify({
        type: 'welcome',
        data: {
            playerId: playerId,
            nickname: playerData.nickname,
            worldSeed: WORLD_SEED,
            spawnPosition: { x: 0, y: 32, z: 0 },
            players: existingPlayers
        }
    }));

    console.log(`📦 Игрок ${playerId} подключён. Чанки будут загружаться по запросу клиента.`);

    broadcast({
        type: 'playerJoined',
        data: {
            id: playerId,
            nickname: playerData.nickname,
            position: playerData.position,
            rotation: playerData.rotation,
            isMoving: playerData.isMoving,
            avatarYaw: playerData.avatarYaw
        }
    }, playerId);


    ws.on('message', (rawMessage: Buffer) => {
        try {
            const message = JSON.parse(rawMessage.toString());
            
            switch (message.type) {
                case 'playerPosition':
                    if (players.has(playerId)) {
                        const player = players.get(playerId)!;
                        player.position = message.data.position;
                        player.rotation = message.data.rotation;
                        player.isMoving = Boolean(message.data.isMoving);
                        player.avatarYaw = typeof message.data.avatarYaw === 'number'
                            ? message.data.avatarYaw
                            : player.avatarYaw;
                        
                        broadcast({
                            type: 'playerMoved',
                            data: {
                                id: playerId,
                                position: message.data.position,
                                rotation: message.data.rotation,
                                isMoving: player.isMoving,
                                avatarYaw: player.avatarYaw
                            }
                        }, playerId);
                    }
                    break;

                case 'setNickname':
                    if (players.has(playerId)) {
                        const player = players.get(playerId)!;
                        const rawNickname =
                            typeof message.data?.nickname === 'string' ? message.data.nickname : '';
                        const nickname = rawNickname.trim().slice(0, 16) || player.id;
                        player.nickname = nickname;

                        broadcast({
                            type: 'playerNickname',
                            data: { id: playerId, nickname }
                        });
                    }
                    break;
                    
                case 'requestChunk':
                    const { chunkX, chunkZ } = message.data;
                    const chunkKey = `${chunkX}_${chunkZ}`;
                    console.log(`📨 Запрос чанка ${chunkKey} от игрока ${playerId}`);
                    sendChunkToPlayer(ws, chunkX, chunkZ);
                    break;
                    
                case 'blockBreak':
                    const { x, y, z } = message.data;
                    console.log(`💥 Игрок ${playerId} разрушил блок ${x},${y},${z}`);
                    applyBlockUpdate(x, y, z, null);
                    broadcast({
                        type: 'blockUpdate',
                        data: {
                            position: { x, y, z },
                            type: null
                        }
                    });
                    break;
                    
                case 'blockPlace':
                    console.log(`🧱 Игрок ${playerId} установил блок ${message.data.position.x},${message.data.position.y},${message.data.position.z} типа ${message.data.type}`);
                    applyBlockUpdate(
                        message.data.position.x,
                        message.data.position.y,
                        message.data.position.z,
                        message.data.type
                    );
                    broadcast({
                        type: 'blockUpdate',
                        data: {
                            position: message.data.position,
                            type: message.data.type
                        }
                    });
                    break;
                    
                case 'generateAdjacent':
   
                    break;
            }
        } catch (error) {
            console.error('Ошибка обработки сообщения:', error);
        }
    });

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
    console.log(`📊 Статистика: игроков=${clients.size}, чанков в кэше=${chunkCache.size}`);
    if (chunkCache.size > 0 && chunkCache.size <= 10) {
        console.log(`📦 Чанки в кэше: ${Array.from(chunkCache.keys()).join(', ')}`);
    }
}, 30000);


process.on('SIGUSR2', () => {
    console.log('🗑️ Очистка кэша чанков...');
    chunkCache.clear();
    console.log(`✅ Кэш очищен, сейчас ${chunkCache.size} чанков`);
});
