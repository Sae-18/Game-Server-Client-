import { io } from 'socket.io-client';
import { units } from './engine/unit.js';
import { getNode } from './engine/board.js';

export class MultiplayerSync {
  constructor(roomCode, localPlayerRole, game, onStateChange) {
    this.roomCode = roomCode;
    this.localPlayerRole = localPlayerRole;
    this.game = game;
    this.onStateChange = onStateChange;
    this.socket = null;
    this.isProcessingUpdate = false;
    this.lastPendingBattleState = null;
    this.lastSyncedUnitsHash = null;
  }

  connect(serverUrl) {
    return new Promise((resolve, reject) => {
      console.log('🔌 Attempting to connect to:', serverUrl);
      
      this.socket = io(serverUrl, {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5,
        transports: ['polling', 'websocket'],
        timeout: 10000,
        forceNew: true
      });

      this.socket.on('connect', () => {
        console.log('✅ Connected to server:', this.socket.id);
        resolve();
      });

      this.socket.on('connect_error', (error) => {
        console.error('❌ Connection error:', error.message);
        console.error('Server URL:', serverUrl);
        console.error('Transport:', this.socket.io.engine.transport.name);
        reject(error);
      });

      this.socket.on('disconnect', (reason) => {
        console.log('❌ Disconnected:', reason);
        if (reason === 'io server disconnect') {
          this.socket.connect();
        }
      });

      this.socket.on('reconnect', (attemptNumber) => {
        console.log('🔄 Reconnected after', attemptNumber, 'attempts');
      });

      this.socket.on('reconnect_error', (error) => {
        console.error('❌ Reconnection error:', error.message);
      });

      this.socket.on('reconnect_failed', () => {
        console.error('❌ Reconnection failed');
        alert('Lost connection to server. Please refresh the page.');
      });

      this.socket.on('gameStateUpdate', (data) => {
        console.log('📥 Received game state update');
        this.syncFromServer(data);
      });

      this.socket.on('playerDisconnected', (data) => {
        alert(`Opponent (${data.disconnectedPlayer}) disconnected! Game ended.`);
        window.location.reload();
      });

      this.socket.on('roomUpdate', (data) => {
        console.log('🔄 Room updated');
        this.syncFromServer(data);
      });
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  createUnitsHash(unitsArray) {
    if (!unitsArray || unitsArray.length === 0) return null;
    return JSON.stringify(unitsArray.map(u => ({
      id: u.id,
      pos: u.position,
      ball: u.hasBall,
      stam: u.stamina,
      lock: u.lockTurns
    })));
  }

  syncFromServer(data) {
    if (this.isProcessingUpdate) {
      console.log("⸻ Skipping sync - update in progress");
      return;
    }

    if (!this.game) {
      console.log("⸻ Skipping sync - game not initialized yet");
      return;
    }

    if (data.gameState?.battleRolls?.attackerReady && !data.gameState?.battleRolls?.defenderReady) {
      console.log("⸻ Skipping sync - battle in progress");
      return;
    }
    
    console.log("🔄 Syncing from server...", {
      kickoffChosen: data.kickoffChosen,
      hasUnits: data.gameState?.units?.length > 0,
      state: data.state
    });

    this.game.score.P1 = data.score.P1;
    this.game.score.P2 = data.score.P2;

    this.game.turnManager.currentPlayer = data.turn;
    this.game.turnManager.turnNumber = data.turnNumber || 1;

    this.game.state = data.state;

    if (data.gameState && data.gameState.units && data.gameState.units.length > 0) {
      if (data.kickoffChosen || data.state === 'inProgress') {
        const newHash = this.createUnitsHash(data.gameState.units);
        if (newHash !== this.lastSyncedUnitsHash) {
          console.log("📦 Units state changed, syncing...");
          this.syncUnits(data.gameState.units);
          this.lastSyncedUnitsHash = newHash;
        }
      }
    }

    const incomingBattle = data.gameState?.pendingBattle;
    const battleStateChanged = JSON.stringify(incomingBattle) !== JSON.stringify(this.lastPendingBattleState);

    if (battleStateChanged) {
      console.log("⚔️ Battle state changed:", incomingBattle);
      this.lastPendingBattleState = incomingBattle ? { ...incomingBattle } : null;

      if (incomingBattle && incomingBattle.attackerId && incomingBattle.defenderId) {
        const attacker = units.get(incomingBattle.attackerId);
        const defender = units.get(incomingBattle.defenderId);

        if (attacker && defender) {
          this.game.pendingBattle = {
            attackerId: incomingBattle.attackerId,
            defenderId: incomingBattle.defenderId,
            nodeId: incomingBattle.nodeId
          };
          console.log(`⚔️ Synced battle: ${attacker.id} vs ${defender.id} at node ${incomingBattle.nodeId}`);
        } else {
          console.warn("⚠️ Battle units not found, clearing pending battle");
          this.game.pendingBattle = undefined;
        }
      } else {
        this.game.pendingBattle = undefined;
      }
    }

    this.onStateChange(data);
  }

  syncUnits(serverUnits) {
    console.log("🔧 Syncing units from server...");

    for (let i = 1; i <= 12; i++) {
      const node = getNode(i);
      if (node) node.occupants.clear();
    }

    units.clear();

    let ballCarrierCount = 0;
    const validUnits = serverUnits.filter(u => {
      if (u.hasBall) {
        if (ballCarrierCount > 0) {
          console.warn(`⚠️ Multiple ball carriers detected! Skipping unit ${u.id}`);
          return false;
        }
        ballCarrierCount++;
      }
      return true;
    });

    validUnits.forEach((u) => {
      const unit = {
        id: u.id,
        cardId: u.cardId,
        name: u.name,
        ownerId: u.ownerId,
        position: u.position,
        hasBall: u.hasBall || false,
        stamina: u.stamina ?? 100,
        lockTurns: u.lockTurns ?? 0,
        stats: u.stats,
        rarity: u.rarity
      };
      units.set(u.id, unit);

      const node = getNode(u.position);
      if (node) {
        node.addOccupant(u.id);
      } else {
        console.error(`❌ Node ${u.position} not found for unit ${u.id}`);
      }
    });

    console.log(`✅ Synced ${validUnits.length} units, ${ballCarrierCount} ball carrier(s)`);
  }

  async pushToServer() {
    if (this.isProcessingUpdate) {
      console.log("⸻ Skipping push - update in progress");
      return;
    }

    this.isProcessingUpdate = true;
    console.log("⬆️ Pushing to server...");

    try {
      let ballCarrierFound = false;
      const unitsArray = Array.from(units.values()).map(u => {
        let hasBall = u.hasBall || false;

        if (hasBall) {
          if (ballCarrierFound) {
            console.warn(`⚠️ Multiple ball carriers! Removing ball from ${u.id}`);
            hasBall = false;
          } else {
            ballCarrierFound = true;
          }
        }

        return {
          id: u.id ?? null,
          cardId: u.cardId ?? null,
          name: u.name ?? null,
          ownerId: u.ownerId ?? null,
          position: u.position ?? null,
          hasBall: hasBall,
          stamina: u.stamina ?? 100,
          lockTurns: u.lockTurns ?? 0,
          stats: u.stats ?? null,
          rarity: u.rarity ?? null
        };
      });

      let pendingBattleData = null;
      if (this.game.pendingBattle) {
        pendingBattleData = {
          attackerId: this.game.pendingBattle.attackerId,
          defenderId: this.game.pendingBattle.defenderId,
          nodeId: this.game.pendingBattle.nodeId || null
        };
        console.log("⚔️ Pushing battle to server:", pendingBattleData);
      }

      this.socket.emit('updateGameState', {
        roomCode: this.roomCode,
        turn: this.game.turnManager.currentPlayer,
        turnNumber: this.game.turnManager.turnNumber,
        score: this.game.score,
        state: this.game.state,
        gameState: {
          units: unitsArray,
          pendingBattle: pendingBattleData
        }
      });

      this.lastSyncedUnitsHash = this.createUnitsHash(unitsArray);

      console.log("✅ Pushed to server - Turn:", this.game.turnManager.currentPlayer,
        "Battle:", pendingBattleData ? "YES" : "NO",
        "Ball carriers:", ballCarrierFound ? 1 : 0);
    } catch (err) {
      console.error("❌ Failed to push to server:", err);
    } finally {
      setTimeout(() => {
        this.isProcessingUpdate = false;
        console.log("🔓 Update lock released");
      }, 100);
    }
  }

  isMyTurn() {
    return this.game.turnManager.currentPlayer === this.localPlayerRole;
  }

  isMyUnit(unitId) {
    const unit = units.get(unitId);
    return unit && unit.ownerId === this.localPlayerRole;
  }
}