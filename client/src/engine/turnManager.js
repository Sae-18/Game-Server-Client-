import { units } from "./unit";
import { moveUnit } from "./board";
import { getNode } from "./board";

class TurnManager {
    constructor() {
        this.currentPlayer = "P1";
        this.turnNumber = 1;
    }
    nextTurn() {
        // 🔹 Unlock units before switching
        for (const unit of units.values()) {
            if (unit.lockTurns > 0)
                unit.lockTurns--;
        }
        // 🔹 Switch players
        this.currentPlayer = this.currentPlayer === "P1" ? "P2" : "P1";
        this.turnNumber++;
        console.log(`Turn ${this.turnNumber}: ${this.currentPlayer}'s move`);
    }
}

function moveIfAllowed(unitId, fromId, toId, turnManager, action = 'dribble') {
    const unit = units.get(unitId);
    if (!unit)
        return false;
    if (unit.ownerId !== turnManager.currentPlayer)
        return false; // not your turn
    if (unit.lockTurns > 0)
        return false; // locked

    // Try to move
    const moved = moveUnit(unitId, fromId, toId);
    console.log(moved);
    if (!moved)
        return false;

    // After moving, check for battle at destination node
    const destNode = getNode(toId);
    if (!destNode)
        return false;

    // Check if there are opponents at the destination
    const opponentsAtDest = [];
    for (const occ of destNode.occupants) {
        if (occ !== unitId) {
            const other = units.get(occ);
            if (other && other.ownerId !== unit.ownerId) {
                opponentsAtDest.push(other);
            }
        }
    }

    // If there are opponents at the destination, check if ANYONE has the ball
    if (opponentsAtDest.length > 0) {
        console.log(`⚔️ Opponents detected at node ${toId}:`, opponentsAtDest.map(u => u.id));
        
        // Find who has the ball (could be the moving unit or any opponent at dest)
        let ballCarrier = null;
        
        // Check if moving unit has ball
        if (unit.hasBall) {
            ballCarrier = unit;
            console.log(`  Moving unit ${unit.id} has the ball`);
        }
        
        // Check if any opponent at destination has ball
        if (!ballCarrier) {
            for (const opp of opponentsAtDest) {
                if (opp.hasBall) {
                    ballCarrier = opp;
                    console.log(`  Opponent ${opp.id} has the ball`);
                    break;
                }
            }
        }

        if (ballCarrier) {
            // Battle should be triggered!
            // Attacker is the ball carrier, defender is the first opponent
            const attacker = ballCarrier.id;
            const defender = ballCarrier.id === unit.id ? opponentsAtDest[0].id : unit.id;
            
            console.log(`⚔️ BATTLE TRIGGERED at node ${toId}!`);
            console.log(`  Attacker: ${attacker} (ball carrier)`);
            console.log(`  Defender: ${defender}`);
            
            return {
                result: "battle pending",
                attacker: attacker,
                defender: defender,
                nodeId: toId,
            };
        } else {
            console.log(`💤 Opponents at node but no one has ball → no battle`);
        }
    }

    return { result: "moved", unit: unitId }; // no battle, just moved
}

export { moveIfAllowed, TurnManager };