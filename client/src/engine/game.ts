import { TurnManager, moveIfAllowed } from "./turnManager";
import { units, resetUnits } from "./unit";
import { performAction } from "./performAction";
import { getNode, Node, nodes } from "./board";
import { resolve1v1 } from "./battleResolver";

class GameManager {
  turnManager: TurnManager;
  board: { getNode: (id: number) => Node | undefined };
  score: { P1: number; P2: number };
  maxGoals: number;
  state: "inProgress" | "finished" | "coinToss" | "postBattleMove";
  pendingBattle?: {
    attackerId: string;
    defenderId: string;
    nodeId: number;

  };
  static pendingBattle?: { attackerId: string; defenderId: string; nodeId: number; };
  coinTossWinner?: 'P1' | 'P2';
  postBattleWinnerId?: string;

  constructor(maxGoals: number = 3) {
    this.turnManager = new TurnManager();
    this.board = { getNode };
    this.score = { P1: 0, P2: 0 };
    this.maxGoals = maxGoals;
    this.state = "coinToss";
    this.performCoinToss();
  }

  performCoinToss() {
    this.coinTossWinner = Math.random() < 0.5 ? 'P1' : 'P2';
    console.log(`Coin toss winner: ${this.coinTossWinner}`);
  }

  setKickoffUnit(unitId: string) {
    if (this.state !== 'coinToss' || !this.coinTossWinner) return false;

    const unit = units.get(unitId);
    if (!unit || unit.ownerId !== this.coinTossWinner) {
      return false;
    }

    // Assign ball and set the turn
    unit.hasBall = true;
    this.turnManager.currentPlayer = unit.ownerId;
    this.state = 'inProgress';
    return true; // Success
  }

  moveMyUnit(unitId: string, fromId: number, toId: number, action: 'dribble' | 'pass' = 'dribble') {
    if (this.state === "postBattleMove") {
      // This is a special move for the winner
      return this.executePostBattleMove(unitId, toId);
    }

    if (this.state !== "inProgress") return { result: "game over" };

    const moved = moveIfAllowed(unitId, fromId, toId, this.turnManager, action);

    if (!moved) return { result: "illegal", reason: "cannot move" };

    // Pending battle handling
    if ((moved as any).result === 'battle pending') {
      const m: any = moved;
      this.pendingBattle = {
        attackerId: m.attacker,
        defenderId: m.defender,
        nodeId: m.nodeId, // now defined correctly
      };
      console.log(`⚔️ Battle pending (${m.type}) between ${m.attacker} and ${m.defender} at node ${m.nodeId}`);
      // DO NOT advance the turn yet
      return { result: 'battle pending', attacker: m.attacker, defender: m.defender, nodeId: m.nodeId, type: m.type };
    }

    // Normal move finished → advance turn
    this.turnManager.nextTurn();
    return { result: "moved", unit: unitId, to: toId };
  }

  executePostBattleMove(unitId: string, toId: number) {
    if (this.state !== "postBattleMove" || unitId !== this.postBattleWinnerId) {
      return { result: "illegal", reason: "not in post-battle move state" };
    }
    const unit = units.get(unitId)!;
    const fromNode = getNode(unit.position)!;
    const toNode = getNode(toId)!;

    if (!fromNode.neighbors.includes(toId) || !toNode.isEmpty()) {
      return { result: "illegal", reason: "invalid post-battle move target" };
    }

    fromNode.removeOccupant(unitId);
    toNode.addOccupant(unitId);
    unit.position = toId;
    this.state = "inProgress";
    return { result: "moved", unit: unitId, to: toId };
  }

  handleAction(unitId: string, action: "dribble" | "pass" | "shoot", target: number | string) {
    if (this.state !== "inProgress") return { result: "game over" };

    // If there's a pending battle, only the attacker can act to resolve it
    if (this.pendingBattle) {
      if (unitId !== this.pendingBattle.attackerId) {
        return { result: "illegal", reason: "not attacker in pending battle" };
      }
      // Resolve it here using resolvePendingBattle
      const outcome = this.resolvePendingBattle(action);

      // If the attacker won a dribble, don't advance the turn yet.
      if (outcome && 'winner' in outcome && outcome.action === 'dribble' && outcome.winner === this.pendingBattle.attackerId) {
        this.state = "postBattleMove";
        this.postBattleWinnerId = outcome.winner;
      } else {
        this.turnManager.nextTurn();
      }
      return { result: "battle_resolved", outcome };
    }

    // No pending battle: perform a regular action
    const result = performAction(unitId, action, target, this.turnManager);

    // If performAction returned a battle pending object (e.g. pass into node with defenders),
    // copy it into GameManager.pendingBattle and DO NOT advance the turn.
    if (result && (result as any).result === 'battle pending') {
      const r: any = result;
      this.pendingBattle = {
        attackerId: r.attacker,
        defenderId: r.defender,
        nodeId: r.nodeId,
      };
      console.log(`⚔️ Battle pending between ${r.attacker} and ${r.defender} at node ${r.nodeId}`);
      // Waiting for player input — do NOT nextTurn()
      return { result: 'battle pending', attacker: r.attacker, defender: r.defender, nodeId: r.nodeId };
    }

    // check if a goal was scored
    if (result && result?.result === "goal") {
      this.goalScored(this.turnManager.currentPlayer as "P1" | "P2");
      if (this.checkWinCondition()) {
        return { result: "game over", winner: this.turnManager.currentPlayer };
      }
    }

    // Normal non-battle action → advance turn
    this.turnManager.nextTurn();
    return result;
  }



  goalScored(playerId: "P1" | "P2") {
    this.score[playerId]++;
    console.log(`⚽ Goal! ${playerId} scores. Current score:`, this.score);

    // reset ball to that player’s GK (node 1 for P1, node 12 for P2)
    const goalNode = playerId === "P1" ? 1 : 12;
    for (const u of units.values()) {
      u.hasBall = false;
    }
    for (const u of units.values()) {
      if (u.ownerId === playerId && u.position === goalNode) {
        u.hasBall = true;
        break;
      }
    }

    // clear all locks
    for (const u of units.values()) {
      u.lockTurns = 0;
    }
  }

  checkWinCondition() {
    if (this.score.P1 >= this.maxGoals || this.score.P2 >= this.maxGoals) {
      this.state = "finished";
      console.log("🏆 Game over! Winner:", this.score.P1 > this.score.P2 ? "P1" : "P2");
      return true;
    }
    return false;
  }

  dumpGameState() {
    console.log("Turn:", this.turnManager.turnNumber, "Current player:", this.turnManager.currentPlayer);
    console.log("Score:", this.score);
    console.log("Units:", Array.from(units.values()));
  }

  resolvePendingBattle(action: 'dribble' | 'pass' | 'shoot', targetTeammateId?: string) {
    if (!this.pendingBattle) return { result: 'illegal', reason: 'no pending battle' };

    const { attackerId, defenderId } = this.pendingBattle;

    // Only allow the attacker to do the action they selected in handleAction
    // (action is already the parameter)

    const result = resolve1v1(attackerId, defenderId, action, this.turnManager, targetTeammateId);
    if (!result) return false;

    const attacker = units.get(attackerId)!;
    const defender = units.get(defenderId)!;
    const winnerUnit = units.get(result.winner)!;
    const loserUnit = units.get(result.loser)!;
    const effects = result.postEffects || {};

    // --- Ball possession ---
    winnerUnit.hasBall = true;
    loserUnit.hasBall = false;

    // --- Lock loser ---
    if (effects.lockTurns) {
      loserUnit.lockTurns = effects.lockTurns;
    }

    // --- Action-specific effects ---
    if (result.action === 'dribble' && result.winner === attackerId) {
      const fromNode = getNode(attacker.position);
      const toNode = getNode(defender.position);
      fromNode?.removeOccupant(attackerId);
      toNode?.addOccupant(attackerId);
      attacker.position = defender.position;
    }

    if (result.action === 'pass' && result.winner === attackerId && targetTeammateId) {
      const teammate = units.get(targetTeammateId);
      if (teammate) teammate.hasBall = true;
    }

    if (result.action === 'shoot') {
      if (result.winner === attackerId) {
        this.goalScored(attacker.ownerId as 'P1' | 'P2');
      } else if (effects.moveForwardNode) {
        const fromNode = getNode(attacker.position);
        const toNode = getNode(effects.moveForwardNode);
        fromNode?.removeOccupant(attackerId);
        toNode?.addOccupant(attackerId);
        attacker.position = effects.moveForwardNode;
      }
    }

    // --- Winner keeps turn ---
    this.turnManager.currentPlayer = winnerUnit.ownerId;

    this.pendingBattle = undefined;
    return result;
  }







  resetGame() {

  }


}

export { GameManager };
