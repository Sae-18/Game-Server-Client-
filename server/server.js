import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

// In-memory room storage
const rooms = new Map();

// Generate room code
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  // CREATE ROOM
  socket.on('createRoom', (callback) => {
    const roomCode = generateRoomCode();
    const room = {
      code: roomCode,
      players: {
        P1: socket.id,
        P2: null
      },
      state: 'waiting',
      turn: 'P1',
      turnNumber: 1,
      score: { P1: 0, P2: 0 },
      coinTossState: 'pending',
      coinTossRolls: { P1: null, P2: null },
      kickoffChosen: false,
      gameState: {
        units: [],
        pendingBattle: null,
        battleRolls: {
          attacker: null,
          defender: null,
          attackerReady: false,
          defenderReady: false
        },
        battleAction: null,
        battleTargetNode: null
      }
    };

    rooms.set(roomCode, room);
    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.playerRole = 'P1';

    console.log(`✅ Room created: ${roomCode} by ${socket.id}`);
    callback({ success: true, roomCode, playerRole: 'P1' });
  });

  // JOIN ROOM
  socket.on('joinRoom', (roomCode, callback) => {
    const room = rooms.get(roomCode);

    if (!room) {
      return callback({ success: false, error: 'Room not found' });
    }

    if (room.players.P2) {
      return callback({ success: false, error: 'Room is full' });
    }

    room.players.P2 = socket.id;
    room.state = 'inProgress';
    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.playerRole = 'P2';

    console.log(`✅ ${socket.id} joined room: ${roomCode} as P2`);

    // Notify both players
    io.to(roomCode).emit('roomUpdate', room);
    callback({ success: true, roomCode, playerRole: 'P2' });
  });

  // GET ROOM STATE
  socket.on('getRoomState', (roomCode, callback) => {
    const room = rooms.get(roomCode);
    if (room) {
      callback({ success: true, room });
    } else {
      callback({ success: false, error: 'Room not found' });
    }
  });

  // UPDATE GAME STATE
  socket.on('updateGameState', (data) => {
    const { roomCode } = data;
    const room = rooms.get(roomCode);

    if (!room) {
      console.error(`❌ Room not found: ${roomCode}`);
      return;
    }

    // Update room with new data
    if (data.turn !== undefined) room.turn = data.turn;
    if (data.turnNumber !== undefined) room.turnNumber = data.turnNumber;
    if (data.score) room.score = data.score;
    if (data.state !== undefined) room.state = data.state;
    if (data.gameState) {
      if (data.gameState.units) room.gameState.units = data.gameState.units;

      // ✅ HANDLE BOTH 1v1 AND 2v1 PENDING BATTLES
      if (data.gameState.pendingBattle !== undefined) {
        const battle = data.gameState.pendingBattle;

        // ❌ Only allow clearing IF explicitly finalized server-side
        if (battle === null && !room.gameState.battleFinalizing) {
          console.log(`⚠️ Ignoring client attempt to clear battle (room: ${roomCode})`);
        }
        else if (battle !== null) {
          // Store new pending battle
          room.gameState.pendingBattle = {
            attackerId: battle.attackerId,
            nodeId: battle.nodeId,
            is2v1: battle.is2v1 || false,
            initiator: battle.initiator || null
          };
          if (battle.is2v1 && battle.defenderIds) {
            room.gameState.pendingBattle.defenderIds = battle.defenderIds;
            console.log(`⚔️⚔️ 2v1 Battle stored: ${battle.attackerId} vs [${battle.defenderIds.join(', ')}]`);
          } else if (battle.defenderId) {
            room.gameState.pendingBattle.defenderId = battle.defenderId;
            console.log(`⚔️ 1v1 Battle stored: ${battle.attackerId} vs ${battle.defenderId}`);
          }
        }
      }


      if (data.gameState.battleRolls) {
        room.gameState.battleRolls = {
          ...room.gameState.battleRolls,
          ...data.gameState.battleRolls
        };
      }
      if (data.gameState.battleAction !== undefined) {
        room.gameState.battleAction = data.gameState.battleAction;
      }
      if (data.gameState.battleTargetNode !== undefined) {
        room.gameState.battleTargetNode = data.gameState.battleTargetNode;
      }
    }
    if (data.kickoffChosen !== undefined) room.kickoffChosen = data.kickoffChosen;
    if (data.coinTossState !== undefined) room.coinTossState = data.coinTossState;
    if (data.coinTossRolls) room.coinTossRolls = data.coinTossRolls;

    console.log(`📤 Broadcasting update for room: ${roomCode}`);

    // Broadcast to all clients in the room
    io.to(roomCode).emit('gameStateUpdate', room);
  });

  // COIN TOSS ROLL
  socket.on('coinTossRoll', (data) => {
    const { roomCode, playerRole, roll } = data;
    const room = rooms.get(roomCode);

    if (!room) return;

    room.coinTossRolls[playerRole] = roll;

    if (playerRole === 'P1') {
      room.coinTossState = 'P2Rolling';
    } else {
      room.coinTossState = 'determineWinner';
    }

    io.to(roomCode).emit('gameStateUpdate', room);
  });

  // RESET COIN TOSS
  socket.on('resetCoinToss', (roomCode) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    room.coinTossRolls = { P1: null, P2: null };
    room.coinTossState = 'pending';

    io.to(roomCode).emit('gameStateUpdate', room);
  });

  // BATTLE ROLL
  socket.on('battleRoll', (data) => {
    const { roomCode, role, roll } = data;
    const room = rooms.get(roomCode);
    if (!room) return;

    const is2v1 = room.gameState.pendingBattle?.is2v1 || false;

    // Update the roll for the attacker or defender
    if (role === 'attacker') {
      room.gameState.battleRolls.attacker = roll;
      room.gameState.battleRolls.attackerReady = true;
      console.log(`🎲 Attacker rolled ${roll} in ${is2v1 ? '2v1' : '1v1'} battle (room: ${roomCode})`);
    } else {
      room.gameState.battleRolls.defender = roll;
      room.gameState.battleRolls.defenderReady = true;
      console.log(`🎲 Defender(s) rolled ${roll} in ${is2v1 ? '2v1' : '1v1'} battle (room: ${roomCode})`);
    }

    // Emit the updated game state to all clients in the room
    io.to(roomCode).emit('gameStateUpdate', room);

    // Prompt defender after attacker rolls
    if (role === 'attacker' && !room.gameState.battleRolls.defenderReady) {
      // Give clients a short delay to re-render before prompting
      setTimeout(() => {
        io.to(roomCode).emit('promptDefenderRoll');
        console.log(`🛡️ Prompting defender(s) to roll in ${is2v1 ? '2v1' : '1v1'} battle (room: ${roomCode})`);
      }, 500);
    }
  });

  // 🔥 FINALIZE BATTLE (triggered once both rolls are ready)
  socket.on('finalizeBattle', (data) => {
    const { roomCode, result } = data;
    const room = rooms.get(roomCode);
    if (!room) return;

    room.gameState.battleFinalizing = true;

    const is2v1 = result.is2v1 || false;

    // Reset battle state on server
    room.gameState.pendingBattle = null;
    room.gameState.battleAction = null;
    room.gameState.battleTargetNode = null;
    room.gameState.battleRolls = {
      attacker: null,
      defender: null,
      attackerReady: false,
      defenderReady: false
    };

    console.log(`🏁 ${is2v1 ? '2v1' : '1v1'} Battle finalized in room ${roomCode}. Winner: ${result.winner}`);

    // Broadcast battle resolution to everyone in the room
    io.to(roomCode).emit('battleResolved', {
      winner: result.winner,
      loser: result.loser,
      rolls: result.rolls,
      action: result.action,
      is2v1: is2v1  // ✅ Include battle type
    });

    // Also push updated game state
    io.to(roomCode).emit('gameStateUpdate', room);

      room.gameState.battleFinalizing = false; 
  });

  // CLEAR BATTLE
  socket.on('clearBattle', (roomCode) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    room.gameState.pendingBattle = null;
    room.gameState.battleAction = null;
    room.gameState.battleTargetNode = null;
    room.gameState.battleRolls = {
      attacker: null,
      defender: null,
      attackerReady: false,
      defenderReady: false
    };

    io.to(roomCode).emit('gameStateUpdate', room);
    console.log(`🧹 Battle cleared in room ${roomCode}`);
  });

  // DISCONNECT
  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);

    // Find and clean up room
    const roomCode = socket.roomCode;
    if (roomCode) {
      const room = rooms.get(roomCode);
      if (room) {
        // Notify other player
        io.to(roomCode).emit('playerDisconnected', {
          disconnectedPlayer: socket.playerRole
        });

        // Delete room after a delay
        setTimeout(() => {
          rooms.delete(roomCode);
          console.log(`🗑️ Room deleted: ${roomCode}`);
        }, 5000);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});