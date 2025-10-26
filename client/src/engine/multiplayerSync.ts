// import { doc, onSnapshot, updateDoc, getDoc } from "firebase/firestore";
// import { db } from "./config.js";
import { GameManager } from './game';
import { units, spawnUnitFromCard, resetUnits } from './unit';

export class MultiplayerSync {
  roomCode: string;
  localPlayerRole: 'P1' | 'P2';
  game: GameManager;
  unsubscribe?: () => void;
  isProcessingUpdate: boolean = false;
  
  // Callbacks for UI updates
  onStateChange: (data: any) => void;
  
  constructor(
    roomCode: string, 
    localPlayerRole: 'P1' | 'P2',
    game: GameManager,
    onStateChange: (data: any) => void
  ) {
    this.roomCode = roomCode;
    this.localPlayerRole = localPlayerRole;
    this.game = game;
    this.onStateChange = onStateChange;
  }

  // Start listening to Firestore changes
  startListening() {
    const roomRef = doc(db, "rooms", this.roomCode);
    
    this.unsubscribe = onSnapshot(roomRef, (snap) => {
      if (!snap.exists()) {
        console.error("Room disappeared!");
        return;
      }

      const data = snap.data();
      
      // Check for disconnections
      if (!data.players.P1 || !data.players.P2) {
        alert("Opponent disconnected! Game ended.");
        window.location.reload();
        return;
      }

      // Sync game state from Firestore
      this.syncFromFirestore(data);
    });
  }

  stopListening() {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  }

  // Sync local game state FROM Firestore
  syncFromFirestore(data: any) {
    if (this.isProcessingUpdate) return; // Prevent loops

    // Update scores
    this.game.score.P1 = data.score.P1;
    this.game.score.P2 = data.score.P2;

    // Update turn
    this.game.turnManager.currentPlayer = data.turn;
    this.game.turnManager.turnNumber = data.turnNumber || 1;

    // Update game state
    this.game.state = data.state;

    // Sync units from Firestore
    if (data.gameState && data.gameState.units) {
      this.syncUnits(data.gameState.units);
    }

    // Sync pending battle
    if (data.gameState && data.gameState.pendingBattle) {
      this.game.pendingBattle = data.gameState.pendingBattle;
    } else {
      this.game.pendingBattle = undefined;
    }

    // Trigger UI update
    this.onStateChange(data);
  }

  // Sync units from Firestore representation
  syncUnits(firestoreUnits: any[]) {
    // Clear current units
    units.clear();

    // Rebuild units map from Firestore
    firestoreUnits.forEach((u: any) => {
      const unit = {
        id: u.id,
        cardId: u.cardId,
        name: u.name,
        ownerId: u.ownerId,
        position: u.position,
        hasBall: u.hasBall,
        stamina: u.stamina,
        lockTurns: u.lockTurns,
        stats: u.stats,
        rarity: u.rarity
      };
      units.set(u.id, unit as any);
    });
  }

  // Push local game state TO Firestore
  async pushToFirestore() {
    if (this.isProcessingUpdate) return;
    this.isProcessingUpdate = true;

    try {
      const roomRef = doc(db, "rooms", this.roomCode);
      
      // Serialize units
      const unitsArray = Array.from(units.values()).map(u => ({
        id: u.id,
        cardId: u.cardId,
        name: u.name,
        ownerId: u.ownerId,
        position: u.position,
        hasBall: u.hasBall,
        stamina: u.stamina,
        lockTurns: u.lockTurns,
        stats: u.stats,
        rarity: u.rarity
      }));

      await updateDoc(roomRef, {
        turn: this.game.turnManager.currentPlayer,
        turnNumber: this.game.turnManager.turnNumber,
        score: this.game.score,
        state: this.game.state,
        'gameState.units': unitsArray,
        'gameState.pendingBattle': this.game.pendingBattle || null
      });
    } catch (err) {
      console.error("Failed to push to Firestore:", err);
    } finally {
      setTimeout(() => {
        this.isProcessingUpdate = false;
      }, 100);
    }
  }

  // Check if it's this player's turn
  isMyTurn(): boolean {
    return this.game.turnManager.currentPlayer === this.localPlayerRole;
  }

  // Check if a unit belongs to this player
  isMyUnit(unitId: string): boolean {
    const unit = units.get(unitId);
    return unit?.ownerId === this.localPlayerRole;
  }
}