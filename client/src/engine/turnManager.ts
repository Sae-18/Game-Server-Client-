import { units } from "./unit";
import { moveUnit } from "./board";
import { resolve1v1 } from "./battleResolver";
import { getNode } from "./board"
import { GameManager } from "./game"



class TurnManager {
    currentPlayer: string;
    turnNumber: number;

    constructor() {
        this.currentPlayer = "P1";
        this.turnNumber = 1;
    }


    nextTurn() {
        // 🔹 Unlock units before switching
        for (const unit of units.values()) {
            if (unit.lockTurns > 0) unit.lockTurns--;
        }

        // 🔹 Switch players
        this.currentPlayer = this.currentPlayer === "P1" ? "P2" : "P1";
        this.turnNumber++;

        console.log(`Turn ${this.turnNumber}: ${this.currentPlayer}'s move`);
    }

}

function moveIfAllowed(unitId: string, fromId: number, toId: number, turnManager: TurnManager,  action: 'dribble' | 'pass' = 'dribble') {
    const unit = units.get(unitId);
    if (!unit) return false;
    if (unit.ownerId !== turnManager.currentPlayer) return false; // not your turn
    if (unit.lockTurns > 0) return false; // locked
    // Try to move
    const moved = moveUnit(unitId, fromId, toId);
    console.log(moved);
    if (!moved) return false;

    // After moving, check for battle
    const destNode = getNode(toId);
    if (!destNode) return false;

    for (const occ of destNode.occupants) {
        if (occ !== unitId) {
            const other = units.get(occ);
            if (other && other.ownerId !== unit.ownerId) {
                // 👇 Trigger battle!
                if (unit.hasBall || other.hasBall) {
                    const attacker = unit.hasBall ? unit.id : other.id;
                    const defender = unit.hasBall ? other.id : unit.id;
                    console.log(`⚔️ Battle triggered: ${attacker} (hasBall=${unit.hasBall}) vs ${defender} (hasBall = ${other.hasBall})`);
                    return {
                        result: "battle pending",
                        attacker: attacker,
                        defender: defender,
                        nodeId: destNode.id,
                    };
                } else {
                    console.log(`👀 ${unitId} entered enemy node but has no ball → no battle`);
                }
            }
        }
    }

    return { result: "moved", unit: unitId }; // no battle, just moved
}

export { moveIfAllowed, TurnManager, }

