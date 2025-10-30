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

    // Get all units at destination (including the unit that just moved)
    const allUnitsAtDest = [];
    for (const occ of destNode.occupants) {
        const u = units.get(occ);
        if (u) allUnitsAtDest.push(u);
    }

    // Separate by team
    const movingPlayerUnits = allUnitsAtDest.filter(u => u.ownerId === unit.ownerId);
    const opponentUnits = allUnitsAtDest.filter(u => u.ownerId !== unit.ownerId);

    // Check if there are opponents at the destination
    if (opponentUnits.length > 0) {
        console.log(`⚔️ Opponents detected at node ${toId}`);

        // Find ball carrier (could be moving unit or any unit at dest)
        let ballCarrier = null;
        for (const u of allUnitsAtDest) {
            if (u.hasBall) {
                ballCarrier = u;
                break;
            }
        }

        if (!ballCarrier) {
            console.log(`💤 No ball carrier at node → no battle`);
            return { result: "moved", unit: unitId };
        }

        console.log(`⚽ Ball carrier: ${ballCarrier.id} (${ballCarrier.ownerId})`);

        // Determine battle configuration
        const ballCarrierTeam = ballCarrier.ownerId;
        const attackingTeamUnits = allUnitsAtDest.filter(u => u.ownerId === ballCarrierTeam && !u.locked && !(u.lockTurns > 0));
        const defendingTeamUnits = allUnitsAtDest.filter(u => u.ownerId !== ballCarrierTeam && !u.locked && !(u.lockTurns > 0));

        if (defendingTeamUnits.length === 0) {
            console.log(`💤 All opponents locked → no battle`);
            return { result: "moved", unit: unitId };
        }

        // ✅ CHECK FOR 2 ATTACKERS VS 1 DEFENDER
        if (attackingTeamUnits.length === 2 && defendingTeamUnits.length === 1) {
            const attackerIds = attackingTeamUnits.map(u => u.id);
            const defenderId = defendingTeamUnits[0].id;

            console.log(`⚔️⚔️ 2v1 ATTACKERS BATTLE TRIGGERED at node ${toId}!`);
            console.log(`  Attackers: [${attackerIds.join(', ')}] (ball carrier team)`);
            console.log(`  Defender: ${defenderId}`);

            return {
                result: "battle pending",
                attackerIds: attackerIds,  // ✅ Array of attackers
                defenderId: defenderId,
                nodeId: toId,
                type: "2v1",
                is2v1: true,
                is2v1Attackers: true,  // ✅ Flag for 2 attackers vs 1 defender
                is2v1Defenders: false
            };
        }

        // ✅ CHECK FOR 1 ATTACKER VS 2 DEFENDERS
        if (attackingTeamUnits.length === 1 && defendingTeamUnits.length >= 2) {
            const attackerId = ballCarrier.id;
            const defenderIds = defendingTeamUnits.slice(0, 2).map(d => d.id);

            console.log(`⚔️⚔️ 2v1 DEFENDERS BATTLE TRIGGERED at node ${toId}!`);
            console.log(`  Attacker: ${attackerId} (ball carrier)`);
            console.log(`  Defenders: [${defenderIds.join(', ')}]`);

            return {
                result: "battle pending",
                attackerIds: [attackerId],  // ✅ Array with single attacker
                defenderIds: defenderIds,
                nodeId: toId,
                type: "2v1",
                is2v1: true,
                is2v1Attackers: false,
                is2v1Defenders: true  // ✅ Flag for 1 attacker vs 2 defenders
            };
        }

        // ✅ CHECK FOR 1v1 BATTLE
        if (attackingTeamUnits.length === 1 && defendingTeamUnits.length === 1) {
            const attackerId = ballCarrier.id;
            const defenderId = defendingTeamUnits[0].id;

            console.log(`⚔️ 1v1 BATTLE TRIGGERED at node ${toId}!`);
            console.log(`  Attacker: ${attackerId} (ball carrier)`);
            console.log(`  Defender: ${defenderId}`);

            return {
                result: "battle pending",
                attackerIds: [attackerId],  // ✅ Array with single attacker
                defenderId: defenderId,
                nodeId: toId,
                type: "1v1",
                is2v1: false,
                is2v1Attackers: false,
                is2v1Defenders: false
            };
        }

        // ✅ HANDLE UNUSUAL CONFIGURATIONS
        console.log(`⚠️ Unusual battle configuration at node ${toId}:`, {
            attackers: attackingTeamUnits.length,
            defenders: defendingTeamUnits.length
        });
    }

    return { result: "moved", unit: unitId }; // no battle, just moved
}

export { moveIfAllowed, TurnManager };