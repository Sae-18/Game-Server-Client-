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
  console.log(`ðŸ”Œ Client connected: ${socket.id}`);

  // CREATE ROOM
  // âœ… ADD to room structure in createRoom
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
      // âœ… NEW: Substitution state
      substitutionState: {
        active: false,
        P1: null,
        P2: null,
        P1Ready: false,
        P2Ready: false
      },
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

    console.log(`âœ… Room created: ${roomCode} by ${socket.id}`);
    callback({ success: true, roomCode, playerRole: 'P1' });
  });

  // âœ… NEW: Handle substitution submission
  socket.on('submitSubstitution', (data) => {
    const { roomCode, playerRole, substitutions } = data;
    const room = rooms.get(roomCode);

    if (!room) {
      console.error(`âŒ Room not found: ${roomCode}`);
      return;
    }

    console.log(`ðŸ“ ${playerRole} submitted substitution:`, substitutions);

    // Store player's substitution choice
    room.substitutionState[playerRole] = substitutions;
    room.substitutionState[`${playerRole}Ready`] = true;

    // Check if both players are ready
    if (room.substitutionState.P1Ready && room.substitutionState.P2Ready) {
      console.log('âœ… Both players submitted substitutions, broadcasting results');

      // Broadcast to both players
      io.to(roomCode).emit('substitutionComplete', {
        substitutionsComplete: true,
        p1Substitution: room.substitutionState.P1,
        p2Substitution: room.substitutionState.P2
      });

      // Reset substitution state
      room.substitutionState = {
        active: false,
        P1: null,
        P2: null,
        P1Ready: false,
        P2Ready: false
      };
    } else {
      console.log(`â³ Waiting for ${room.substitutionState.P1Ready ? 'P2' : 'P1'} to submit`);
    }
  });

  // âœ… NEW: Start substitution phase (called by client after goal)
  // âœ… FIX server.js - Make startSubstitution broadcast immediately
  socket.on('startSubstitution', (roomCode) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    console.log(`ðŸ”„ Starting substitution phase for room ${roomCode}`);

    room.substitutionState = {
      active: true,
      P1: null,
      P2: null,
      P1Ready: false,
      P2Ready: false
    };

    // âœ… IMMEDIATELY broadcast to both clients
    io.to(roomCode).emit('substitutionPhaseStarted');
    console.log(`ðŸ“¢ Broadcasted substitutionPhaseStarted to room ${roomCode}`);
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

    console.log(`âœ… ${socket.id} joined room: ${roomCode} as P2`);

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
  // âœ… UPDATED 'updateGameState' socket handler (inside io.on('connection'))
  socket.on('updateGameState', (data) => {
    const { roomCode } = data;
    const room = rooms.get(roomCode);

    if (!room) {
      console.error(`âŒ Room not found: ${roomCode}`);
      return;
    }

    // Update room with new data
    if (data.turn !== undefined) room.turn = data.turn;
    if (data.turnNumber !== undefined) room.turnNumber = data.turnNumber;
    if (data.score) room.score = data.score;
    if (data.state !== undefined) room.state = data.state;
    if (data.gameState) {
      if (data.gameState.units) room.gameState.units = data.gameState.units;

      // âœ… UPDATED PENDING BATTLE HANDLING
      if (data.gameState.pendingBattle !== undefined) {
        const battle = data.gameState.pendingBattle;

        // Only allow clearing IF explicitly finalized server-side
        if (battle === null && !room.gameState.battleFinalizing) {
          console.log(`âš ï¸ Ignoring client attempt to clear battle (room: ${roomCode})`);
        }
        else if (battle !== null) {
          // âœ… Store new pending battle with all flags
          room.gameState.pendingBattle = {
            attackerIds: battle.attackerIds ?? [],
            nodeId: battle.nodeId,
            is2v1: battle.is2v1 || false,
            is2v1Attackers: battle.is2v1Attackers || false,
            is2v1Defenders: battle.is2v1Defenders || false,
            initiator: battle.initiator || null
          };

          // âœ… Handle 2v1 Attackers
          if (battle.is2v1Attackers && battle.defenderId) {
            room.gameState.pendingBattle.defenderId = battle.defenderId;
            console.log(`âš”ï¸âš”ï¸ 2v1 Attackers Battle stored: [${battle.attackerIds.join(', ')}] vs ${battle.defenderId}`);
          }
          // âœ… Handle 2v1 Defenders
          else if (battle.is2v1Defenders && battle.defenderIds) {
            room.gameState.pendingBattle.defenderIds = battle.defenderIds;
            console.log(`âš”ï¸âš”ï¸ 2v1 Defenders Battle stored: ${battle.attackerIds[0]} vs [${battle.defenderIds.join(', ')}]`);
          }
          // âœ… Handle 1v1
          else if (battle.defenderId) {
            room.gameState.pendingBattle.defenderId = battle.defenderId;
            console.log(`âš”ï¸ 1v1 Battle stored: ${battle.attackerIds[0]} vs ${battle.defenderId}`);
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

    console.log(`ðŸ“¤ Broadcasting update for room: ${roomCode}`);

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
      console.log(`ðŸŽ² Attacker rolled ${roll} in ${is2v1 ? '2v1' : '1v1'} battle (room: ${roomCode})`);
    } else {
      room.gameState.battleRolls.defender = roll;
      room.gameState.battleRolls.defenderReady = true;
      console.log(`ðŸŽ² Defender(s) rolled ${roll} in ${is2v1 ? '2v1' : '1v1'} battle (room: ${roomCode})`);
    }

    // Emit the updated game state to all clients in the room
    io.to(roomCode).emit('gameStateUpdate', room);

    // Prompt defender after attacker rolls
    if (role === 'attacker' && !room.gameState.battleRolls.defenderReady) {
      // Give clients a short delay to re-render before prompting
      setTimeout(() => {
        io.to(roomCode).emit('promptDefenderRoll');
        console.log(`ðŸ›¡ï¸ Prompting defender(s) to roll in ${is2v1 ? '2v1' : '1v1'} battle (room: ${roomCode})`);
      }, 500);
    }
  });

  // ðŸ”¥ FINALIZE BATTLE (triggered once both rolls are ready)
  socket.on('finalizeBattle', (data) => {
    const { roomCode, result } = data;
    const room = rooms.get(roomCode);
    if (!room) return;

    room.gameState.battleFinalizing = true;

    const is2v1Attackers = result.is2v1Attackers || false;
    const is2v1Defenders = result.is2v1Defenders || false;
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

    let battleTypeStr = is2v1Attackers ? '2v1 Attackers' :
      is2v1Defenders ? '2v1 Defenders' :
        is2v1 ? '2v1' : '1v1';

    console.log(`ðŸ† ${battleTypeStr} Battle finalized in room ${roomCode}. Winner: ${result.winner}`);

    // Broadcast battle resolution to everyone in the room
    io.to(roomCode).emit('battleResolved', {
      winner: result.winner,
      loser: result.loser,
      rolls: result.rolls,
      action: result.action,
      is2v1: is2v1,
      is2v1Attackers: is2v1Attackers,
      is2v1Defenders: is2v1Defenders
    });

    // âœ… NEW: If goal was scored, update score and trigger substitution
    if (result.goalScored && result.scorer) {
      console.log(`âš½ Goal scored by ${result.scorer} in room ${roomCode}`);

      // Update server-side score
      room.score[result.scorer] = (room.score[result.scorer] || 0) + 1;

      // Broadcast goal event to both clients
      io.to(roomCode).emit('goalScored', {
        scorer: result.scorer,
        score: room.score
      });

      // After a short delay, trigger substitution phase
      setTimeout(() => {
        console.log(`ðŸ”„ Starting substitution phase for room ${roomCode}`);
        room.substitutionState = {
          active: true,
          P1: null,
          P2: null,
          P1Ready: false,
          P2Ready: false
        };
        io.to(roomCode).emit('substitutionPhaseStarted');
      }, 2000); // 2 second delay for goal celebration
    }

    // Push updated game state
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
    console.log(`ðŸ§¹ Battle cleared in room ${roomCode}`);
  });

  // DISCONNECT
  socket.on('disconnect', () => {
    console.log(`âŒ Client disconnected: ${socket.id}`);

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
          console.log(`ðŸ—‘ï¸ Room deleted: ${roomCode}`);
        }, 5000);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`ðŸš€ Server running on port ${PORT}`);
});