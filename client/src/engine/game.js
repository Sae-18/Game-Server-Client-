import { TurnManager, moveIfAllowed } from "./turnManager";
import { resolve2v1, resolve2v1Attackers } from "./battleResolver";
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
    // ✅ UPDATED moveMyUnit function
    moveMyUnit(unitId, fromId, toId, action = 'dribble') {
        if (this.state !== "inProgress" && this.state !== "postBattleMove")
            return { result: "game over" };

        const moved = moveIfAllowed(unitId, fromId, toId, this.turnManager, action);
        if (!moved)
            return { result: "illegal", reason: "cannot move" };

        // Pending battle handling
        if (moved.result === 'battle pending') {
            const m = moved;

            // ✅ Handle 2 attackers vs 1 defender
            if (m.is2v1Attackers) {
                this.pendingBattle = {
                    attackerIds: m.attackerIds,  // ✅ Array of 2 attackers
                    defenderId: m.defenderId,
                    nodeId: m.nodeId,
                    is2v1: true,
                    is2v1Attackers: true,
                    is2v1Defenders: false
                };
                console.log(`⚔️⚔️ 2v1 Attackers Battle pending between [${m.attackerIds.join(', ')}] and ${m.defenderId} at node ${m.nodeId}`);

                return {
                    result: 'battle pending',
                    attackerIds: m.attackerIds,
                    defenderId: m.defenderId,
                    nodeId: m.nodeId,
                    type: m.type,
                    is2v1: true,
                    is2v1Attackers: true,
                    is2v1Defenders: false
                };
            }

            // ✅ Handle 1 attacker vs 2 defenders
            if (m.is2v1Defenders) {
                this.pendingBattle = {
                    attackerIds: m.attackerIds,  // ✅ Array with single attacker
                    defenderIds: m.defenderIds,
                    nodeId: m.nodeId,
                    is2v1: true,
                    is2v1Attackers: false,
                    is2v1Defenders: true
                };
                console.log(`⚔️⚔️ 2v1 Defenders Battle pending between ${m.attackerIds[0]} and [${m.defenderIds.join(', ')}] at node ${m.nodeId}`);

                return {
                    result: 'battle pending',
                    attackerIds: m.attackerIds,
                    defenderIds: m.defenderIds,
                    nodeId: m.nodeId,
                    type: m.type,
                    is2v1: true,
                    is2v1Attackers: false,
                    is2v1Defenders: true
                };
            }

            // ✅ Handle 1v1
            this.pendingBattle = {
                attackerIds: m.attackerIds,  // ✅ Array with single attacker
                defenderId: m.defenderId,
                nodeId: m.nodeId,
                is2v1: false,
                is2v1Attackers: false,
                is2v1Defenders: false
            };
            console.log(`⚔️ 1v1 Battle pending between ${m.attackerIds[0]} and ${m.defenderId} at node ${m.nodeId}`);

            return {
                result: 'battle pending',
                attackerIds: m.attackerIds,
                defenderId: m.defenderId,
                nodeId: m.nodeId,
                type: m.type,
                is2v1: false,
                is2v1Attackers: false,
                is2v1Defenders: false
            };
        }

        // Normal move finished → advance turn
        this.turnManager.nextTurn();
        return { result: "moved", unit: unitId, to: toId };
    }

    // ✅ UPDATED determineBattleType function
    determineBattleType(action, attackerIdOrIds, defenderIdOrIds) {
        // ✅ Handle attacker array
        const attackerIds = Array.isArray(attackerIdOrIds) ? attackerIdOrIds : [attackerIdOrIds];
        const attackers = attackerIds.map(id => getUnitInstance(id)).filter(Boolean);

        if (attackers.length === 0) return null;

        const attackerCards = attackers.map(a => cardMap.get(a.cardId)).filter(Boolean);
        if (attackerCards.length !== attackers.length) return null;

        // ✅ Check if it's 2 attackers vs 1 defender
        if (Array.isArray(defenderIdOrIds) === false && attackers.length === 2) {
            // 2 attackers vs 1 defender
            const defender = getUnitInstance(defenderIdOrIds);
            if (!defender) return null;

            const defCard = cardMap.get(defender.cardId);
            if (!defCard) return null;

            let attackValue = 0;
            let defenseValue = 0;
            let atk1SpeedPenalty = 0, atk2SpeedPenalty = 0, defSpeedPenalty = 0;

            const attacker1 = attackers[0];
            const attacker2 = attackers[1];
            const atk1Card = attackerCards[0];
            const atk2Card = attackerCards[1];

            // Defender gets 1.95x multiplier (outnumbered)
            switch (action) {
                case "dribble": {
                    const atk1Cost = Math.max(atk1Card.stats.dribbling?.cost || 0, atk1Card.stats.speed?.cost || 0);
                    const atk2Cost = Math.max(atk2Card.stats.dribbling?.cost || 0, atk2Card.stats.speed?.cost || 0);
                    const defCost = Math.max(defCard.stats.defending?.cost || 0, defCard.stats.speed?.cost || 0);

                    if (attacker1.stamina < atk1Cost) atk1SpeedPenalty = 3;
                    if (attacker2.stamina < atk2Cost) atk2SpeedPenalty = 3;
                    if (defender.stamina < defCost) defSpeedPenalty = 3;

                    attackValue = (atk1Card.stats.dribbling?.value || 0) + (atk1Card.stats.speed?.value || 0) - atk1SpeedPenalty +
                        (atk2Card.stats.dribbling?.value || 0) + (atk2Card.stats.speed?.value || 0) - atk2SpeedPenalty;
                    defenseValue = ((defCard.stats.defending?.value || 0) + (defCard.stats.speed?.value || 0) - defSpeedPenalty) * 1.95;
                    break;
                }
                case "pass": {
                    const atk1Cost = Math.max(atk1Card.stats.passing?.cost || 0, atk1Card.stats.speed?.cost || 0);
                    const atk2Cost = Math.max(atk2Card.stats.passing?.cost || 0, atk2Card.stats.speed?.cost || 0);
                    const defCost = defCard.stats.speed?.cost || 0;

                    if (attacker1.stamina < atk1Cost) atk1SpeedPenalty = 3;
                    if (attacker2.stamina < atk2Cost) atk2SpeedPenalty = 3;
                    if (defender.stamina < defCost) defSpeedPenalty = 3;

                    attackValue = (atk1Card.stats.passing?.value || 0) + (atk1Card.stats.speed?.value || 0) - atk1SpeedPenalty +
                        (atk2Card.stats.passing?.value || 0) + (atk2Card.stats.speed?.value || 0) - atk2SpeedPenalty;
                    defenseValue = ((defCard.stats.speed?.value || 0) - defSpeedPenalty) * 1.95;
                    break;
                }
                case "shoot": {
                    const atk1Cost = Math.max(atk1Card.stats.shooting?.cost || 0, atk1Card.stats.speed?.cost || 0);
                    const atk2Cost = Math.max(atk2Card.stats.shooting?.cost || 0, atk2Card.stats.speed?.cost || 0);
                    const defCost = Math.max(defCard.stats.defending?.cost || 0, defCard.stats.speed?.cost || 0);

                    if (attacker1.stamina < atk1Cost) atk1SpeedPenalty = 3;
                    if (attacker2.stamina < atk2Cost) atk2SpeedPenalty = 3;
                    if (defender.stamina < defCost) defSpeedPenalty = 3;

                    attackValue = (atk1Card.stats.shooting?.value || 0) + (atk1Card.stats.speed?.value || 0) - atk1SpeedPenalty +
                        (atk2Card.stats.shooting?.value || 0) + (atk2Card.stats.speed?.value || 0) - atk2SpeedPenalty;
                    defenseValue = ((defCard.stats.defending?.value || 0) + (defCard.stats.speed?.value || 0) - defSpeedPenalty) * 1.95;
                    break;
                }
            }

            const diff = attackValue - defenseValue;

            if (Math.abs(diff) > 10) {
                const winner = diff > 0 ? 'attackers' : defenderIdOrIds;
                return { type: 'clear', winner: winner, is2v1Attackers: true };
            } else {
                return { type: 'die_roll', is2v1Attackers: true };
            }
        }

        // ✅ Check if it's 1 attacker vs 2 defenders (existing logic)
        if (Array.isArray(defenderIdOrIds) && attackers.length === 1) {
            const attacker = attackers[0];
            const atkCard = attackerCards[0];

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
                    const atkCost = Math.max(atkCard.stats.dribbling?.cost || 0, atkCard.stats.speed?.cost || 0);
                    const def1Cost = Math.max(def1Card.stats.defending?.cost || 0, def1Card.stats.speed?.cost || 0);
                    const def2Cost = Math.max(def2Card.stats.defending?.cost || 0, def2Card.stats.speed?.cost || 0);

                    if (attacker.stamina < atkCost) atkSpeedPenalty = 3;
                    if (defender1.stamina < def1Cost) def1SpeedPenalty = 3;
                    if (defender2.stamina < def2Cost) def2SpeedPenalty = 3;

                    attackValue = ((atkCard.stats.dribbling?.value || 0) + (atkCard.stats.speed?.value || 0) - atkSpeedPenalty) * 1.95;
                    defenseValue = (def1Card.stats.defending?.value || 0) + (def1Card.stats.speed?.value || 0) - def1SpeedPenalty +
                        (def2Card.stats.defending?.value || 0) + (def2Card.stats.speed?.value || 0) - def2SpeedPenalty;
                    break;
                }
                case "pass": {
                    const atkCost = Math.max(atkCard.stats.passing?.cost || 0, atkCard.stats.speed?.cost || 0);
                    const def1Cost = def1Card.stats.speed?.cost || 0;
                    const def2Cost = def2Card.stats.speed?.cost || 0;

                    if (attacker.stamina < atkCost) atkSpeedPenalty = 3;
                    if (defender1.stamina < def1Cost) def1SpeedPenalty = 3;
                    if (defender2.stamina < def2Cost) def2SpeedPenalty = 3;

                    attackValue = ((atkCard.stats.passing?.value || 0) + (atkCard.stats.speed?.value || 0) - atkSpeedPenalty) * 1.95;
                    defenseValue = (def1Card.stats.speed?.value || 0) - def1SpeedPenalty +
                        (def2Card.stats.speed?.value || 0) - def2SpeedPenalty;
                    break;
                }
                case "shoot": {
                    const atkCost = Math.max(atkCard.stats.shooting?.cost || 0, atkCard.stats.speed?.cost || 0);
                    const def1Cost = Math.max(def1Card.stats.defending?.cost || 0, def1Card.stats.speed?.cost || 0);
                    const def2Cost = Math.max(def2Card.stats.defending?.cost || 0, def2Card.stats.speed?.cost || 0);

                    if (attacker.stamina < atkCost) atkSpeedPenalty = 3;
                    if (defender1.stamina < def1Cost) def1SpeedPenalty = 3;
                    if (defender2.stamina < def2Cost) def2SpeedPenalty = 3;

                    attackValue = ((atkCard.stats.shooting?.value || 0) + (atkCard.stats.speed?.value || 0) - atkSpeedPenalty) * 1.95;
                    defenseValue = (def1Card.stats.defending?.value || 0) + (def1Card.stats.speed?.value || 0) - def1SpeedPenalty +
                        (def2Card.stats.defending?.value || 0) + (def2Card.stats.speed?.value || 0) - def2SpeedPenalty;
                    break;
                }
            }

            const diff = attackValue - defenseValue;

            if (Math.abs(diff) > 10) {
                const winner = diff > 0 ? attackerIdOrIds[0] : 'defenders';
                return { type: 'clear', winner: winner, is2v1Defenders: true };
            } else {
                return { type: 'die_roll', is2v1Defenders: true };
            }
        }

        // ✅ 1v1 Battle (existing logic)
        const attacker = attackers[0];
        const atkCard = attackerCards[0];
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
                const atkCost = Math.max(atkCard.stats.dribbling?.cost || 0, atkCard.stats.speed?.cost || 0);
                const defCost = Math.max(defenderCard.stats.defending?.cost || 0, defenderCard.stats.speed?.cost || 0);

                if (attacker.stamina < atkCost) atkSpeedPenalty = 3;
                if (defender.stamina < defCost) defSpeedPenalty = 3;

                attackValue = (atkCard.stats.dribbling?.value || 0) + (atkCard.stats.speed?.value || 0) - atkSpeedPenalty;
                defenseValue = (defenderCard.stats.defending?.value || 0) + (defenderCard.stats.speed?.value || 0) - defSpeedPenalty;
                break;
            }
            case "pass": {
                const atkCost = Math.max(atkCard.stats.passing?.cost || 0, atkCard.stats.speed?.cost || 0);
                const defCost = defenderCard.stats.speed?.cost || 0;

                if (attacker.stamina < atkCost) atkSpeedPenalty = 3;
                if (defender.stamina < defCost) defSpeedPenalty = 3;

                attackValue = (atkCard.stats.passing?.value || 0) + (atkCard.stats.speed?.value || 0) - atkSpeedPenalty;
                defenseValue = ((defenderCard.stats.speed?.value || 0) - defSpeedPenalty) * 2;
                break;
            }
            case "shoot": {
                const atkCost = Math.max(atkCard.stats.shooting?.cost || 0, atkCard.stats.speed?.cost || 0);
                const defCost = Math.max(defenderCard.stats.defending?.cost || 0, defenderCard.stats.speed?.cost || 0);

                if (attacker.stamina < atkCost) atkSpeedPenalty = 3;
                if (defender.stamina < defCost) defSpeedPenalty = 3;

                attackValue = (atkCard.stats.shooting?.value || 0) + (atkCard.stats.speed?.value || 0) - atkSpeedPenalty;
                defenseValue = (defenderCard.stats.defending?.value || 0) + (defenderCard.stats.speed?.value || 0) - defSpeedPenalty;
                break;
            }
        }

        const diff = attackValue - defenseValue;

        if (Math.abs(diff) > 5) {
            const winner = diff > 0 ? attackerIdOrIds[0] : defenderId;
            return { type: 'clear', winner: winner, is2v1: false };
        } else {
            return { type: 'die_roll', is2v1: false };
        }
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


    // ✅ UPDATED resolvePending2v1Battle to route correctly
    resolvePending2v1Battle(action, targetNodeId, manualRolls = null) {
        if (!this.pendingBattle || !this.pendingBattle.is2v1) {
            return { result: 'illegal', reason: 'no pending 2v1 battle' };
        }

        const { attackerIds, is2v1Attackers, is2v1Defenders } = this.pendingBattle;

        let result;

        // ✅ Route to correct resolver based on battle type
        if (is2v1Attackers) {
            // 2 attackers vs 1 defender
            const { defenderId } = this.pendingBattle;
            result = resolve2v1Attackers(attackerIds, defenderId, action, this.turnManager, targetNodeId, manualRolls);
        } else if (is2v1Defenders) {
            // 1 attacker vs 2 defenders
            const { defenderIds } = this.pendingBattle;
            result = resolve2v1(attackerIds[0], defenderIds, action, this.turnManager, targetNodeId, manualRolls);
        } else {
            console.error('❌ Unknown 2v1 battle type');
            return { result: 'illegal', reason: 'unknown 2v1 type' };
        }

        if (!result) return false;

        const effects = result.postEffects || {};

        // ✅ Handle post-battle effects for 2v1 Attackers
        if (is2v1Attackers) {
            const attacker1 = units.get(attackerIds[0]);
            const attacker2 = units.get(attackerIds[1]);
            const defender = units.get(this.pendingBattle.defenderId);

            if (result.action === 'dribble' && result.winner === 'attackers') {
                // Attackers won dribble: just advance turn (no post-battle move)
                this.turnManager.nextTurn();
            }

            if (result.action === 'pass') {
                if (effects.ballRecipient) {
                    const recipient = units.get(effects.ballRecipient);
                    if (recipient) {
                        this.turnManager.currentPlayer = recipient.ownerId;
                    }
                }
            }

            if (result.action === 'shoot') {
                if (result.winner === this.pendingBattle.defenderId && effects.moveBackNode) {
                    // Failed shoot: move ball carrier back
                    const ballCarrier = attacker1.hasBall ? attacker1 : attacker2;
                    const fromNode = getNode(ballCarrier.position);
                    const toNode = getNode(effects.moveBackNode);

                    if (fromNode && toNode) {
                        fromNode.removeOccupant(ballCarrier.id);
                        toNode.addOccupant(ballCarrier.id);
                        ballCarrier.position = effects.moveBackNode;
                    }
                }

                if (effects.scoreGoal) {
                    const ballCarrier = attacker1.hasBall ? attacker1 : attacker2;
                    this.goalScored(ballCarrier.ownerId);
                }
            }

            return result;
        }

        // ✅ Handle post-battle effects for 2v1 Defenders (existing logic)
        if (is2v1Defenders) {
            const attacker = units.get(attackerIds[0]);
            const defender1 = units.get(this.pendingBattle.defenderIds[0]);
            const defender2 = units.get(this.pendingBattle.defenderIds[1]);

            if (result.action === 'dribble' && result.winner === attackerIds[0]) {
                const fromNode = getNode(attacker.position);
                const toNode = getNode(this.pendingBattle.nodeId);

                if (fromNode && toNode) {
                    fromNode.removeOccupant(attackerIds[0]);
                    toNode.addOccupant(attackerIds[0]);
                    attacker.position = this.pendingBattle.nodeId;
                }

                this.state = "postBattleMove";
                this.postBattleWinnerId = result.winner;
            }

            if (result.action === 'pass') {
                if (effects.ballRecipient) {
                    const recipient = units.get(effects.ballRecipient);
                    if (recipient) {
                        this.turnManager.currentPlayer = recipient.ownerId;
                    }
                }
            }

            if (result.action === 'shoot') {
                if (result.winner === 'defenders' && effects.moveBackNode) {
                    const fromNode = getNode(attacker.position);
                    const toNode = getNode(effects.moveBackNode);

                    if (fromNode && toNode) {
                        fromNode.removeOccupant(attackerIds[0]);
                        toNode.addOccupant(attackerIds[0]);
                        attacker.position = effects.moveBackNode;
                    }
                }

                if (effects.scoreGoal) {
                    this.goalScored(attacker.ownerId);
                }
            }

            return result;
        }
    }

    // COMPLETE resolvePendingBattle method (replace existing):
    // ✅ COMPLETE FIXED resolvePendingBattle method (replace existing in game.js)
    resolvePendingBattle(action, targetNodeId, manualRolls = null) {
        if (!this.pendingBattle) return { result: 'illegal', reason: 'no pending battle' };

        const { attackerIds, defenderId, nodeId } = this.pendingBattle;

        // ✅ Handle attackerIds as array
        const attackerId = Array.isArray(attackerIds) ? attackerIds[0] : attackerIds;

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
