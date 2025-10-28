import { TurnManager, moveIfAllowed } from "./turnManager";
import { resolve2v1 } from "./battleResolver";
import { units, resetUnits, spawnUnitFromCard, Unit, cardMap } from "./unit";
import { performAction } from "./performAction";
import { getNode } from "./board";
import { resolve1v1 } from "./battleResolver";


function getUnitInstance(unitId) {
    const unitData = units.get(unitId);
    if (!unitData) return null;

    // If it's already a proper instance, just return it.
    if (unitData instanceof Unit) {
        return unitData;
    }

    // It's a plain object; re-hydrate it into a new Unit instance.
    const unitInstance = new Unit(
        unitData.id,
        unitData.ownerId,
        unitData.cardId,
        unitData.position,
        unitData.stamina
    );
    // Manually copy over other dynamic properties that might have been synced
    unitInstance.lockTurns = unitData.lockTurns || 0;
    unitInstance.hasBall = unitData.hasBall || false;

    // IMPORTANT: Update the map with the proper instance for future use
    units.set(unitId, unitInstance);

    return unitInstance;
}


class GameManager {
    constructor(maxGoals = 3) {
        this.turnManager = new TurnManager();
        this.board = { getNode };
        this.score = { P1: 0, P2: 0 };
        this.maxGoals = maxGoals;
        this.state = "coinToss";
    }
    setKickoffUnit(unitId) {
        if (this.state !== 'coinToss' || !this.coinTossWinner)
            return false;
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
    moveMyUnit(unitId, fromId, toId, action = 'dribble') {
        // if (this.state === "postBattleMove") {
        //     // This is a special move for the winner
        //     return this.executePostBattleMove(unitId, toId);
        // }
        if (this.state !== "inProgress" && this.state !== "postBattleMove")
            return { result: "game over" };

        const moved = moveIfAllowed(unitId, fromId, toId, this.turnManager, action);
        if (!moved)
            return { result: "illegal", reason: "cannot move" };

        // Pending battle handling
        if (moved.result === 'battle pending') {
            const m = moved;

            // âœ… Handle both 1v1 and 2v1
            if (m.is2v1) {
                // 2v1 Battle
                this.pendingBattle = {
                    attackerId: m.attacker,
                    defenderIds: m.defenders,  // âœ… Array of defenders
                    nodeId: m.nodeId,
                    is2v1: true
                };
                console.log(`âš”ï¸âš”ï¸ 2v1 Battle pending (${m.type}) between ${m.attacker} and [${m.defenders.join(', ')}] at node ${m.nodeId}`);

                // DO NOT advance the turn yet
                return {
                    result: 'battle pending',
                    attacker: m.attacker,
                    defenders: m.defenders,  // âœ… Return array
                    nodeId: m.nodeId,
                    type: m.type,
                    is2v1: true
                };
            } else {
                // 1v1 Battle
                this.pendingBattle = {
                    attackerId: m.attacker,
                    defenderId: m.defender,  // âœ… Single defender
                    nodeId: m.nodeId,
                    is2v1: false
                };
                console.log(`âš”ï¸ 1v1 Battle pending (${m.type}) between ${m.attacker} and ${m.defender} at node ${m.nodeId}`);

                // DO NOT advance the turn yet
                return {
                    result: 'battle pending',
                    attacker: m.attacker,
                    defender: m.defender,  // âœ… Return single
                    nodeId: m.nodeId,
                    type: m.type,
                    is2v1: false
                };
            }
        }

        // Normal move finished â†’ advance turn
        this.turnManager.nextTurn();
        return { result: "moved", unit: unitId, to: toId };
    }
    executePostBattleMove(unitId, toId) {
        if (this.state !== "postBattleMove" || unitId !== this.postBattleWinnerId) {
            return { result: "illegal", reason: "not in post-battle move state" };
        }
        const unit = units.get(unitId);
        const fromNode = getNode(unit.position);
        const toNode = getNode(toId);
        if (!fromNode.neighbors.includes(toId) || !toNode.isEmpty()) {
            return { result: "illegal", reason: "invalid post-battle move target" };
        }
        fromNode.removeOccupant(unitId);
        toNode.addOccupant(unitId);
        unit.position = toId;
        this.state = "inProgress";
        return { result: "moved", unit: unitId, to: toId };
    }
    handleAction(unitId, action, target) {
        if (this.state !== "inProgress")
            return { result: "game over" };
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
            }
            else {
                // this.turnManager.nextTurn();
            }
            return { result: "battle_resolved", outcome };
        }
        // No pending battle: perform a regular action
        const result = performAction(unitId, action, target, this.turnManager);
        // If performAction returned a battle pending object (e.g. pass into node with defenders),
        // copy it into GameManager.pendingBattle and DO NOT advance the turn.
        if (result && result.result === 'battle pending') {
            const r = result;
            this.pendingBattle = {
                attackerId: r.attacker,
                defenderId: r.defender,
                nodeId: r.nodeId,
            };
            console.log(`âš”ï¸ Battle pending between ${r.attacker} and ${r.defender} at node ${r.nodeId}`);
            // Waiting for player input â€” do NOT nextTurn()
            return { result: 'battle pending', attacker: r.attacker, defender: r.defender, nodeId: r.nodeId };
        }
        // check if a goal was scored
        if (result && (result === null || result === void 0 ? void 0 : result.result) === "goal") {
            this.goalScored(this.turnManager.currentPlayer);
            if (this.checkWinCondition()) {
                return { result: "game over", winner: this.turnManager.currentPlayer };
            }
        }
        // Normal non-battle action â†’ advance turn
        // this.turnMa nager.nextTurn();
        return result;
    }

    determineBattleType(action, attackerId, defenderIdOrIds) {
        const attacker = getUnitInstance(attackerId);
        if (!attacker) return null;

        const attackerCard = cardMap.get(attacker.cardId);
        if (!attackerCard) return null;

        // ✅ Check if it's 2v1 (defenderIdOrIds is an array)
        if (Array.isArray(defenderIdOrIds)) {
            // 2v1 Battle
            const defender1 = getUnitInstance(defenderIdOrIds[0]);
            const defender2 = getUnitInstance(defenderIdOrIds[1]);

            if (!defender1 || !defender2) return null;

            const def1Card = cardMap.get(defender1.cardId);
            const def2Card = cardMap.get(defender2.cardId);

            if (!def1Card || !def2Card) return null;

            let attackValue = 0;
            let defenseValue = 0;
            let atkSpeedPenalty = 0;
            let def1SpeedPenalty = 0;
            let def2SpeedPenalty = 0;

            // Solo attacker gets 1.95x multiplier
            switch (action) {
                case "dribble": {
                    const atkCost = Math.max(attackerCard.stats.dribbling?.cost || 0, attackerCard.stats.speed?.cost || 0);
                    const def1Cost = Math.max(def1Card.stats.defending?.cost || 0, def1Card.stats.speed?.cost || 0);
                    const def2Cost = Math.max(def2Card.stats.defending?.cost || 0, def2Card.stats.speed?.cost || 0);

                    // Check stamina and apply penalties
                    if (attacker.stamina < atkCost) atkSpeedPenalty = 3;
                    if (defender1.stamina < def1Cost) def1SpeedPenalty = 3;
                    if (defender2.stamina < def2Cost) def2SpeedPenalty = 3;

                    attackValue = ((attackerCard.stats.dribbling?.value || 0) + (attackerCard.stats.speed?.value || 0) - atkSpeedPenalty) * 1.95;
                    defenseValue = (def1Card.stats.defending?.value || 0) + (def1Card.stats.speed?.value || 0) - def1SpeedPenalty +
                        (def2Card.stats.defending?.value || 0) + (def2Card.stats.speed?.value || 0) - def2SpeedPenalty;
                    break;
                }
                case "pass": {
                    const atkCost = Math.max(attackerCard.stats.passing?.cost || 0, attackerCard.stats.speed?.cost || 0);
                    const def1Cost = def1Card.stats.speed?.cost || 0;
                    const def2Cost = def2Card.stats.speed?.cost || 0;

                    // Check stamina and apply penalties
                    if (attacker.stamina < atkCost) atkSpeedPenalty = 3;
                    if (defender1.stamina < def1Cost) def1SpeedPenalty = 3;
                    if (defender2.stamina < def2Cost) def2SpeedPenalty = 3;

                    attackValue = ((attackerCard.stats.passing?.value || 0) + (attackerCard.stats.speed?.value || 0) - atkSpeedPenalty) * 1.95;
                    defenseValue = (def1Card.stats.speed?.value || 0) - def1SpeedPenalty +
                        (def2Card.stats.speed?.value || 0) - def2SpeedPenalty;
                    break;
                }
                case "shoot": {
                    const atkCost = Math.max(attackerCard.stats.shooting?.cost || 0, attackerCard.stats.speed?.cost || 0);
                    const def1Cost = Math.max(def1Card.stats.defending?.cost || 0, def1Card.stats.speed?.cost || 0);
                    const def2Cost = Math.max(def2Card.stats.defending?.cost || 0, def2Card.stats.speed?.cost || 0);

                    // Check stamina and apply penalties
                    if (attacker.stamina < atkCost) atkSpeedPenalty = 3;
                    if (defender1.stamina < def1Cost) def1SpeedPenalty = 3;
                    if (defender2.stamina < def2Cost) def2SpeedPenalty = 3;

                    attackValue = ((attackerCard.stats.shooting?.value || 0) + (attackerCard.stats.speed?.value || 0) - atkSpeedPenalty) * 1.95;
                    defenseValue = (def1Card.stats.defending?.value || 0) + (def1Card.stats.speed?.value || 0) - def1SpeedPenalty +
                        (def2Card.stats.defending?.value || 0) + (def2Card.stats.speed?.value || 0) - def2SpeedPenalty;
                    break;
                }
            }

            const diff = attackValue - defenseValue;

            // Threshold is 10 for 2v1 battles
            if (Math.abs(diff) > 10) {
                const winner = diff > 0 ? attackerId : 'defenders';
                return { type: 'clear', winner: winner, is2v1: true };
            } else {
                return { type: 'die_roll', is2v1: true };
            }
        }

        // ✅ 1v1 Battle
        const defenderId = defenderIdOrIds;
        const defender = getUnitInstance(defenderId);

        if (!defender) return null;

        const defenderCard = cardMap.get(defender.cardId);
        if (!defenderCard) return null;

        let attackValue = 0;
        let defenseValue = 0;
        let atkSpeedPenalty = 0;
        let defSpeedPenalty = 0;

        switch (action) {
            case "dribble": {
                const atkCost = Math.max(attackerCard.stats.dribbling?.cost || 0, attackerCard.stats.speed?.cost || 0);
                const defCost = Math.max(defenderCard.stats.defending?.cost || 0, defenderCard.stats.speed?.cost || 0);

                // Check stamina and apply penalties
                if (attacker.stamina < atkCost) atkSpeedPenalty = 3;
                if (defender.stamina < defCost) defSpeedPenalty = 3;

                attackValue = (attackerCard.stats.dribbling?.value || 0) + (attackerCard.stats.speed?.value || 0) - atkSpeedPenalty;
                defenseValue = (defenderCard.stats.defending?.value || 0) + (defenderCard.stats.speed?.value || 0) - defSpeedPenalty;
                break;
            }
            case "pass": {
                const atkCost = Math.max(attackerCard.stats.passing?.cost || 0, attackerCard.stats.speed?.cost || 0);
                const defCost = defenderCard.stats.speed?.cost || 0;

                // Check stamina and apply penalties
                if (attacker.stamina < atkCost) atkSpeedPenalty = 3;
                if (defender.stamina < defCost) defSpeedPenalty = 3;

                attackValue = (attackerCard.stats.passing?.value || 0) + (attackerCard.stats.speed?.value || 0) - atkSpeedPenalty;
                defenseValue = ((defenderCard.stats.speed?.value || 0) - defSpeedPenalty) * 2;
                break;
            }
            case "shoot": {
                const atkCost = Math.max(attackerCard.stats.shooting?.cost || 0, attackerCard.stats.speed?.cost || 0);
                const defCost = Math.max(defenderCard.stats.defending?.cost || 0, defenderCard.stats.speed?.cost || 0);

                // Check stamina and apply penalties
                if (attacker.stamina < atkCost) atkSpeedPenalty = 3;
                if (defender.stamina < defCost) defSpeedPenalty = 3;

                attackValue = (attackerCard.stats.shooting?.value || 0) + (attackerCard.stats.speed?.value || 0) - atkSpeedPenalty;
                defenseValue = (defenderCard.stats.defending?.value || 0) + (defenderCard.stats.speed?.value || 0) - defSpeedPenalty;
                break;
            }
        }

        const diff = attackValue - defenseValue;

        if (Math.abs(diff) > 5) {
            // It's a clear victory, no die roll needed
            const winner = diff > 0 ? attackerId : defenderId;
            return { type: 'clear', winner: winner, is2v1: false };
        } else {
            // The stat difference is small, a die roll is required
            return { type: 'die_roll', is2v1: false };
        }
    }

    getSerializableState() {
        const serializableUnits = Array.from(units.values()).map(u => ({
            id: u.id,
            ownerId: u.ownerId,
            cardId: u.cardId,
            position: u.position,
            hasBall: u.hasBall,
            stamina: u.stamina,
            lockTurns: u.lockTurns,
            // Add any other properties that need to be saved
        }));
        return {
            units: serializableUnits,
            // We don't need to serialize the whole turnManager, just the current player
        };
    }
    loadFromState(state) {
        resetUnits(); // Clear existing units
        state.units.forEach(unitData => {
            // This function creates the base unit.
            spawnUnitFromCard(unitData.ownerId, unitData.cardId, unitData.position);
            // Then we get it and apply the saved state (like hasBall, stamina, etc.)
            const newUnit = units.get(unitData.id);
            if (newUnit) {
                Object.assign(newUnit, unitData);
            }
        });
    }
    goalScored(playerId) {
        this.score[playerId]++;
        console.log(`âš½ Goal! ${playerId} scores. Current score:`, this.score);
        // reset ball to that playerâ€™s GK (node 1 for P1, node 12 for P2)
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
            console.log("ðŸ† Game over! Winner:", this.score.P1 > this.score.P2 ? "P1" : "P2");
            return true;
        }
        return false;
    }
    dumpGameState() {
        console.log("Turn:", this.turnManager.turnNumber, "Current player:", this.turnManager.currentPlayer);
        console.log("Score:", this.score);
        console.log("Units:", Array.from(units.values()));
    }


    // This is the fixed resolvePendingBattle method that should replace the existing one in game.js


    resolvePending2v1Battle(action, targetNodeId, manualRolls = null) {
        if (!this.pendingBattle || !this.pendingBattle.is2v1) {
            return { result: 'illegal', reason: 'no pending 2v1 battle' };
        }

        const { attackerId, defenderIds, nodeId } = this.pendingBattle;

        // Resolve the 2v1 battle
        const result = resolve2v1(attackerId, defenderIds, action, this.turnManager, targetNodeId, manualRolls);
        if (!result) return false;

        const attacker = units.get(attackerId);
        const defender1 = units.get(defenderIds[0]);
        const defender2 = units.get(defenderIds[1]);
        const effects = result.postEffects || {};

        // Handle node updates based on action
        if (result.action === 'dribble' && result.winner === attackerId) {
            // Attacker won dribble: move attacker to defenders' node
            const fromNode = getNode(attacker.position);
            const toNode = getNode(nodeId);

            if (fromNode && toNode) {
                fromNode.removeOccupant(attackerId);
                toNode.addOccupant(attackerId);
                attacker.position = nodeId;
            }

            // Set up post-battle move state
            this.state = "postBattleMove";
            this.postBattleWinnerId = result.winner;
        }

        if (result.action === 'pass') {
            // Pass doesn't involve moving the attacker
            if (effects.ballRecipient) {
                // The teammate who received the ball
                const recipient = units.get(effects.ballRecipient);
                if (recipient) {
                    this.turnManager.currentPlayer = recipient.ownerId;
                }
            }

            // If defenders won, they need to choose who gets the ball
            // This is handled by the UI (promptBallRecipientChoice)
        }

        if (result.action === 'shoot') {
            if (result.winner === 'defenders' && effects.moveBackNode) {
                // Failed shoot: move attacker back
                const fromNode = getNode(attacker.position);
                const toNode = getNode(effects.moveBackNode);

                if (fromNode && toNode) {
                    fromNode.removeOccupant(attackerId);
                    toNode.addOccupant(attackerId);
                    attacker.position = effects.moveBackNode;
                }
            }

            if (effects.scoreGoal) {
                // Goal scored!
                this.goalScored(attacker.ownerId);
            }
        }

        // Clear pending battle (will be cleared by caller, but set here for clarity)
        // this.pendingBattle = undefined;

        // Handle turn advancement
        if (this.state !== "postBattleMove" && !effects.chooseBallRecipient) {
            // If attacker won (except dribble which has post-move), they keep turn
            // Otherwise turn switches
            if (result.winner === attackerId && action !== 'dribble') {
                // Winner keeps turn
                this.turnManager.nextTurn();
            } else if (result.winner === 'defenders') {
                // Defenders won - turn goes to defending team
                // (actual ball carrier will be chosen by UI)
                const defenderUnit = units.get(defenderIds[0]);
                this.turnManager.currentPlayer = defenderUnit.ownerId;
            } else {
                // Normal turn advance
                this.turnManager.nextTurn();
            }
        }

        return result;
    }

    // COMPLETE resolvePendingBattle method (replace existing):
    resolvePendingBattle(action, targetNodeId, manualRolls = null) {
        if (!this.pendingBattle) return { result: 'illegal', reason: 'no pending battle' };

        const { attackerId, defenderId, nodeId } = this.pendingBattle;

        const attacker = getUnitInstance(attackerId);
        const defender = getUnitInstance(defenderId);
        if (!attacker || !defender) return false;
        // Resolve the battle
        const result = resolve1v1(attackerId, defenderId, action, this.turnManager, targetNodeId, manualRolls);
        if (!result) return false;


        const winnerUnit = getUnitInstance(result.winner);
        const effects = result.postEffects || {};

        // Handle node updates based on action
        if (result.action === 'dribble' && result.winner === attackerId) {
            // Attacker won dribble: move attacker to defender's node
            const fromNode = getNode(attacker.position);
            const toNode = getNode(defender.position);

            if (fromNode && toNode) {
                fromNode.removeOccupant(attackerId);
                toNode.addOccupant(attackerId);
                attacker.position = defender.position;
                // BUG FIX: DO NOT advance the turn here. The turn only advances AFTER
                // the post-battle move is completed or skipped by the player.
                this.turnManager.nextTurn(); // <--- REMOVED
            }

            // Set up post-battle move state so the UI can prompt the player
            this.state = "postBattleMove";
            this.postBattleWinnerId = result.winner;
        }

        if (result.action === 'pass') {
            if (effects.ballRecipient) {
                this.turnManager.currentPlayer = winnerUnit.ownerId;
            } else if (result.winner === defenderId) {
                this.turnManager.currentPlayer = winnerUnit.ownerId;
            } else {
                this.turnManager.nextTurn();
            }
        }

        if (result.action === 'shoot') {
            if (result.winner === defenderId) {
                if (effects.moveBackNode) {
                    const fromNode = getNode(attacker.position);
                    const toNode = getNode(effects.moveBackNode);
                    if (fromNode && toNode) {
                        fromNode.removeOccupant(attackerId);
                        toNode.addOccupant(attackerId);
                        attacker.position = effects.moveBackNode;
                    }
                }
                this.turnManager.currentPlayer = winnerUnit.ownerId;
            }

            if (effects.scoreGoal) {
                this.goalScored(attacker.ownerId);
            }
        }

        // Clear pending battle
        this.pendingBattle = undefined;

        // General turn advancement for non-dribble, non-pass scenarios
        if (this.state !== "postBattleMove" && result.action !== 'pass' && result.action !== 'shoot') {
            this.turnManager.nextTurn();
        }

        return result;
    }
    resetGame() {
    }
}
export { GameManager };
