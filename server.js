import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());

const rooms = new Map();

wss.on('connection', (ws) => {
    let clientId = null;
    let roomId = null;

    ws.on('message', (message) => {
        const data = JSON.parse(message);

        if (data.type === 'create' || data.type === 'join') {
            roomId = data.roomId;
            clientId = data.clientId || uuidv4();

            if (!rooms.has(roomId)) {
                if (data.type === 'join') {
                    ws.send(JSON.stringify({
                        type: 'room-nonexistent',
                        roomId,
                    }));
                    return;
                }
                rooms.set(roomId, new Map());
            }

            const room = rooms.get(roomId);
            room.set(clientId, ws);

            ws.send(JSON.stringify({
                type: 'joined',
                roomId,
                clientId,
                peers: Array.from(room.keys()).filter(id => id !== clientId)
            }));

            room.forEach((peer, peerId) => {
                if (peer !== null && peerId !== clientId) {
                    peer.send(JSON.stringify({
                        type: 'peer-joined',
                        peerId: clientId
                    }));
                }
            });
        }
        else if (data.type === 'signal') {
            const room = rooms.get(roomId);
            if (room && room.has(data.peerId)) {
                const peer = room.get(data.peerId);
                peer.send(JSON.stringify({
                    type: 'signal',
                    signal: data.signal,
                    peerId: clientId
                }));
            }
        }
    });

    ws.on('close', () => {
        if (roomId && clientId) {
            const room = rooms.get(roomId);
            if (room) {
                room.set(clientId, null)

                room.forEach((peer) => {
                    if (peer !== null) {
                        peer.send(JSON.stringify({
                            type: 'peer-left',
                            peerId: clientId
                        }));
                    }
                });

                if ([...room.entries()][0][1] === null) {
                    rooms.delete(roomId)
                }
            }
        }
    });
});

app.get('/rooms', (req, res) => {
    const roomInfo = {};
    rooms.forEach((room, roomId) => {
        roomInfo[roomId] = Array.from(room.keys());
    });
    res.json(roomInfo);
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Signaling server running on port ${PORT}`);
});