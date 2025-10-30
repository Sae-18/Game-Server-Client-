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
      bStam: u.stamina,
      lock: u.lockTurns
    })));
  }

  syncFromServer(data) {
    if (this.isProcessingUpdate) {
      console.log("⏸️ Skipping sync - update in progress");
      return;
    }

    if (!this.game) {
      console.log("⏸️ Skipping sync - game not initialized yet");
      return;
    }

    const isResetting = data.state === 'resetting';

    const skipUnitSync = (data.gameState?.battleRolls?.attackerReady &&
      !data.gameState?.battleRolls?.defenderReady) ||
      isResetting;

    if (skipUnitSync) {
      console.log(`⚠️ ${isResetting ? 'Game resetting' : 'Battle in progress'} - skipping unit sync only`);
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

    if (data.gameState && data.gameState.units && data.gameState.units.length > 0 && !skipUnitSync) {
      if (data.kickoffChosen || data.state === 'inProgress') {
        const newHash = this.createUnitsHash(data.gameState.units);
        if (newHash !== this.lastSyncedUnitsHash) {
          console.log("📦 Units state changed, syncing...");
          this.syncUnits(data.gameState.units);
          this.lastSyncedUnitsHash = newHash;
        }
      }
    }

    // ✅ UPDATED BATTLE STATE SYNC
    const incomingBattle = data.gameState?.pendingBattle;
    const battleStateChanged = JSON.stringify(incomingBattle) !== JSON.stringify(this.lastPendingBattleState);

    if (battleStateChanged) {
      console.log("⚔️ Battle state changed:", incomingBattle);
      this.lastPendingBattleState = incomingBattle ? { ...incomingBattle } : null;

      if (incomingBattle && incomingBattle.attackerIds) {
        // ✅ Handle 2v1 Attackers
        if (incomingBattle.is2v1Attackers && incomingBattle.defenderId) {
          this.game.pendingBattle = {
            attackerIds: incomingBattle.attackerIds,
            defenderId: incomingBattle.defenderId,
            nodeId: incomingBattle.nodeId,
            is2v1: true,
            is2v1Attackers: true,
            is2v1Defenders: false
          };
          console.log(`⚔️⚔️ Synced 2v1 attackers battle: [${incomingBattle.attackerIds.join(', ')}] vs ${incomingBattle.defenderId}`);
        }
        // ✅ Handle 2v1 Defenders
        else if (incomingBattle.is2v1Defenders && incomingBattle.defenderIds) {
          this.game.pendingBattle = {
            attackerIds: incomingBattle.attackerIds,
            defenderIds: incomingBattle.defenderIds,
            nodeId: incomingBattle.nodeId,
            is2v1: true,
            is2v1Attackers: false,
            is2v1Defenders: true
          };
          console.log(`⚔️⚔️ Synced 2v1 defenders battle: ${incomingBattle.attackerIds[0]} vs [${incomingBattle.defenderIds.join(', ')}]`);
        }
        // ✅ Handle 1v1
        else if (incomingBattle.defenderId) {
          this.game.pendingBattle = {
            attackerIds: incomingBattle.attackerIds,
            defenderId: incomingBattle.defenderId,
            nodeId: incomingBattle.nodeId,
            is2v1: false,
            is2v1Attackers: false,
            is2v1Defenders: false
          };
          console.log(`⚔️ Synced 1v1 battle: ${incomingBattle.attackerIds[0]} vs ${incomingBattle.defenderId}`);
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
        baseStamina: u.baseStamina ?? u.stamina ?? 100,
        permanentlyLocked: u.permanentlyLocked || false,
        lockTurns: u.lockTurns ?? 0,
        stats: u.stats,
        rarity: u.rarity,
        isGK: u.isGK || false // ✅ Sync isGK property
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


  // ✅ UPDATED pushToServer function (inside MultiplayerSync class)
  async pushToServer() {
    if (this.isProcessingUpdate) {
      console.log("⏸ Skipping push - update in progress");
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
          baseStamina: u.baseStamina ?? u.stamina ?? 100,
          lockTurns: u.lockTurns ?? 0,
          permanentlyLocked: u.permanentlyLocked || false,
          stats: u.stats ?? null,
          rarity: u.rarity ?? null,
          isGK: u.isGK || false // ✅ Push isGK property
        };
      });

      let pendingBattleData = null;

      // ✅ UPDATED PENDING BATTLE SERIALIZATION
      if (this.game.pendingBattle) {
        const pb = this.game.pendingBattle;

        // ✅ Handle 2v1 Attackers
        if (pb.is2v1Attackers) {
          pendingBattleData = {
            attackerIds: pb.attackerIds ?? [],
            defenderId: pb.defenderId ?? null,
            nodeId: pb.nodeId ?? null,
            is2v1: true,
            is2v1Attackers: true,
            is2v1Defenders: false,
            initiator: pb.initiator ?? this.game.turnManager.currentPlayer
          };
        }
        // ✅ Handle 2v1 Defenders
        else if (pb.is2v1Defenders) {
          pendingBattleData = {
            attackerIds: pb.attackerIds ?? [],
            defenderIds: pb.defenderIds ?? [],
            nodeId: pb.nodeId ?? null,
            is2v1: true,
            is2v1Attackers: false,
            is2v1Defenders: true,
            initiator: pb.initiator ?? this.game.turnManager.currentPlayer
          };
        }
        // ✅ Handle 1v1
        else {
          pendingBattleData = {
            attackerIds: pb.attackerIds ?? [],
            defenderId: pb.defenderId ?? null,
            nodeId: pb.nodeId ?? null,
            is2v1: false,
            is2v1Attackers: false,
            is2v1Defenders: false,
            initiator: pb.initiator ?? this.game.turnManager.currentPlayer
          };
        }
      } else {
        if (this.game.state === 'battle') {
          console.log('⚠️ Skipping pendingBattle reset - battle in progress');
          pendingBattleData = undefined;
        }
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