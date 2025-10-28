import { units, cardMap } from "./unit";
import { getNode } from "./board";

function getRandInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function resolve1v1(attackerId, defenderId, action, turnManager, targetNodeId, manualRolls) {
    const attacker = units.get(attackerId);
    const defender = units.get(defenderId);
    if (!attacker || !defender) return null;

    const atkCard = cardMap.get(attacker.cardId);
    const defCard = cardMap.get(defender.cardId);
    if (!atkCard || !defCard) return null;

    let atkVal = 0, defVal = 0, atkCost = 0, defCost = 0;
    let atkSpeedPenalty = 0, defSpeedPenalty = 0;

    // Calculate battle values per rulebook
    if (action === "dribble") {
        atkCost = Math.max(atkCard.stats.dribbling?.cost || 0, atkCard.stats.speed?.cost || 0);
        defCost = Math.max(defCard.stats.defending?.cost || 0, defCard.stats.speed?.cost || 0);

        // Check stamina and apply penalties
        if (attacker.stamina < atkCost) atkSpeedPenalty = 3;
        if (defender.stamina < defCost) defSpeedPenalty = 3;

        atkVal = (atkCard.stats.dribbling?.value || 0) + (atkCard.stats.speed?.value || 0) - atkSpeedPenalty;
        defVal = (defCard.stats.defending?.value || 0) + (defCard.stats.speed?.value || 0) - defSpeedPenalty;
    } else if (action === "pass") {
        atkCost = Math.max(atkCard.stats.passing?.cost || 0, atkCard.stats.speed?.cost || 0);
        defCost = defCard.stats.speed?.cost || 0;

        // Check stamina and apply penalties
        if (attacker.stamina < atkCost) atkSpeedPenalty = 3;
        if (defender.stamina < defCost) defSpeedPenalty = 3;

        atkVal = (atkCard.stats.passing?.value || 0) + (atkCard.stats.speed?.value || 0) - atkSpeedPenalty;
        defVal = ((defCard.stats.speed?.value || 0) - defSpeedPenalty) * 2;
    } else if (action === "shoot") {
        atkCost = Math.max(atkCard.stats.shooting?.cost || 0, atkCard.stats.speed?.cost || 0);
        defCost = Math.max(defCard.stats.defending?.cost || 0, defCard.stats.speed?.cost || 0);

        // Check stamina and apply penalties
        if (attacker.stamina < atkCost) atkSpeedPenalty = 3;
        if (defender.stamina < defCost) defSpeedPenalty = 3;

        atkVal = (atkCard.stats.shooting?.value || 0) + (atkCard.stats.speed?.value || 0) - atkSpeedPenalty;
        defVal = (defCard.stats.defending?.value || 0) + (defCard.stats.speed?.value || 0) - defSpeedPenalty;
    }

    const diff = atkVal - defVal;
    let winner, dieRollUsed = false, atkRoll = null, defRoll = null;

    // Rulebook: diff > 5 = auto win
    if (Math.abs(diff) > 5) {
        winner = diff > 0 ? attackerId : defenderId;
        if (winner === defenderId) {
            // Attacker lost, spend stamina (cap at 0)
            attacker.stamina = Math.max(0, attacker.stamina - atkCost);
        } else {
            // Defender lost, spend stamina (cap at 0)
            defender.stamina = Math.max(0, defender.stamina - defCost);
        }
    } else {
        // Die roll battle - both spend stamina
        dieRollUsed = true;
        attacker.stamina = Math.max(0, attacker.stamina - atkCost);
        defender.stamina = Math.max(0, defender.stamina - defCost);

        if (manualRolls) {
            atkRoll = manualRolls.attacker;
            defRoll = manualRolls.defender;
        } else {
            atkRoll = getRandInt(1, 6);
            defRoll = getRandInt(1, 6);
        }

        // Apply -2 penalty to die roll of weaker side
        let finalAtkRoll = atkRoll;
        let finalDefRoll = defRoll;

        if (atkVal < defVal) {
            finalAtkRoll = atkRoll - 2;
        } else if (defVal < atkVal) {
            finalDefRoll = defRoll - 2;
        }

        // Winner determined purely by die rolls
        winner = finalAtkRoll > finalDefRoll ? attackerId : defenderId;
    }

    // Apply effects per rulebook
    const effects = {};
    if (dieRollUsed) {
        effects.attackerRoll = atkRoll;
        effects.defenderRoll = defRoll;
    }

    // Add stamina penalty info to effects
    if (atkSpeedPenalty > 0) effects.attackerStaminaPenalty = true;
    if (defSpeedPenalty > 0) effects.defenderStaminaPenalty = true;

    const loser = winner === attackerId ? defenderId : attackerId;
    const loserUnit = units.get(loser);

    // Locks: 2 turns for dribble, 1 for pass/shoot
    if (action === "dribble") {
        loserUnit.lockTurns = 4;
    } else {
        loserUnit.lockTurns = 3;
    }

    // Ball transfer
    if (winner === attackerId) {
        attacker.hasBall = true;
        defender.hasBall = false;

        if (action === "pass" && targetNodeId) {
            const targetNode = getNode(targetNodeId);
            if (targetNode) {
                for (const occId of targetNode.occupants) {
                    const occ = units.get(occId);
                    if (occ && occ.ownerId === attacker.ownerId) {
                        attacker.hasBall = false;
                        occ.hasBall = true;
                        effects.ballRecipient = occId;
                        break;
                    }
                }
            }
        } else if (action === "shoot") {
            effects.scoreGoal = true;
        }
    } else {
        defender.hasBall = true;
        attacker.hasBall = false;

        if (action === "shoot") {
            const pos = attacker.position;
            effects.moveBackNode = pos === 12 ? 10 : (pos === 1 ? 2 : null);
        }
    }

    return { winner, loser, action, postEffects: effects };
}

function resolve2v1(attackerId, defenderIds, action, turnManager, targetNodeId, manualRolls) {
    const attacker = units.get(attackerId);
    const def1 = units.get(defenderIds[0]);
    const def2 = units.get(defenderIds[1]);
    if (!attacker || !def1 || !def2) return null;

    const atkCard = cardMap.get(attacker.cardId);
    const def1Card = cardMap.get(def1.cardId);
    const def2Card = cardMap.get(def2.cardId);
    if (!atkCard || !def1Card || !def2Card) return null;

    let atkVal = 0, defVal = 0, atkCost = 0;
    let atkSpeedPenalty = 0, def1SpeedPenalty = 0, def2SpeedPenalty = 0;

    // Solo attacker gets 1.95x multiplier
    if (action === "dribble") {
        atkCost = Math.max(atkCard.stats.dribbling?.cost || 0, atkCard.stats.speed?.cost || 0);
        const def1Cost = Math.max(def1Card.stats.defending?.cost || 0, def1Card.stats.speed?.cost || 0);
        const def2Cost = Math.max(def2Card.stats.defending?.cost || 0, def2Card.stats.speed?.cost || 0);

        // Check stamina and apply penalties
        if (attacker.stamina < atkCost) atkSpeedPenalty = 3;
        if (def1.stamina < def1Cost) def1SpeedPenalty = 3;
        if (def2.stamina < def2Cost) def2SpeedPenalty = 3;

        atkVal = ((atkCard.stats.dribbling?.value || 0) + (atkCard.stats.speed?.value || 0) - atkSpeedPenalty) * 1.95;
        defVal = (def1Card.stats.defending?.value || 0) + (def1Card.stats.speed?.value || 0) - def1SpeedPenalty +
            (def2Card.stats.defending?.value || 0) + (def2Card.stats.speed?.value || 0) - def2SpeedPenalty;
    } else if (action === "pass") {
        atkCost = Math.max(atkCard.stats.passing?.cost || 0, atkCard.stats.speed?.cost || 0);
        const def1Cost = def1Card.stats.speed?.cost || 0;
        const def2Cost = def2Card.stats.speed?.cost || 0;

        // Check stamina and apply penalties
        if (attacker.stamina < atkCost) atkSpeedPenalty = 3;
        if (def1.stamina < def1Cost) def1SpeedPenalty = 3;
        if (def2.stamina < def2Cost) def2SpeedPenalty = 3;

        atkVal = ((atkCard.stats.passing?.value || 0) + (atkCard.stats.speed?.value || 0) - atkSpeedPenalty) * 1.95;
        defVal = (def1Card.stats.speed?.value || 0) - def1SpeedPenalty +
            (def2Card.stats.speed?.value || 0) - def2SpeedPenalty;
    } else if (action === "shoot") {
        atkCost = Math.max(atkCard.stats.shooting?.cost || 0, atkCard.stats.speed?.cost || 0);
        const def1Cost = Math.max(def1Card.stats.defending?.cost || 0, def1Card.stats.speed?.cost || 0);
        const def2Cost = Math.max(def2Card.stats.defending?.cost || 0, def2Card.stats.speed?.cost || 0);

        // Check stamina and apply penalties
        if (attacker.stamina < atkCost) atkSpeedPenalty = 3;
        if (def1.stamina < def1Cost) def1SpeedPenalty = 3;
        if (def2.stamina < def2Cost) def2SpeedPenalty = 3;

        atkVal = ((atkCard.stats.shooting?.value || 0) + (atkCard.stats.speed?.value || 0) - atkSpeedPenalty) * 1.95;
        defVal = (def1Card.stats.defending?.value || 0) + (def1Card.stats.speed?.value || 0) - def1SpeedPenalty +
            (def2Card.stats.defending?.value || 0) + (def2Card.stats.speed?.value || 0) - def2SpeedPenalty;
    }

    const diff = atkVal - defVal;
    let winner, dieRollUsed = false, atkRoll = null, defRoll = null;

    // Threshold is 10 for 2v1
    if (Math.abs(diff) > 10) {
        winner = diff > 0 ? attackerId : 'defenders';
        // Spend stamina for loser only
        if (winner === 'defenders') {
            attacker.stamina = Math.max(0, attacker.stamina - atkCost);
        } else {
            // Both defenders lose, spend their stamina
            const def1Cost = action === "pass" ? (def1Card.stats.speed?.cost || 0) :
                Math.max(def1Card.stats.defending?.cost || 0, def1Card.stats.speed?.cost || 0);
            const def2Cost = action === "pass" ? (def2Card.stats.speed?.cost || 0) :
                Math.max(def2Card.stats.defending?.cost || 0, def2Card.stats.speed?.cost || 0);
            def1.stamina = Math.max(0, def1.stamina - def1Cost);
            def2.stamina = Math.max(0, def2.stamina - def2Cost);
        }
    } else {
        dieRollUsed = true;
        // Both sides spend stamina in die roll
        attacker.stamina = Math.max(0, attacker.stamina - atkCost);
        const def1Cost = action === "pass" ? (def1Card.stats.speed?.cost || 0) :
            Math.max(def1Card.stats.defending?.cost || 0, def1Card.stats.speed?.cost || 0);
        const def2Cost = action === "pass" ? (def2Card.stats.speed?.cost || 0) :
            Math.max(def2Card.stats.defending?.cost || 0, def2Card.stats.speed?.cost || 0);
        def1.stamina = Math.max(0, def1.stamina - def1Cost);
        def2.stamina = Math.max(0, def2.stamina - def2Cost);

        if (manualRolls && manualRolls.attacker !== undefined &&
            (manualRolls.defenders !== undefined || manualRolls.defender !== undefined)) {
            atkRoll = manualRolls.attacker;
            defRoll = manualRolls.defenders !== undefined ? manualRolls.defenders : manualRolls.defender;
        } else {
            atkRoll = getRandInt(1, 6);
            defRoll = getRandInt(1, 6);
        }

        // Apply -2 penalty to die roll of weaker side
        let finalAtkRoll = atkRoll;
        let finalDefRoll = defRoll;

        if (atkVal < defVal) {
            finalAtkRoll = atkRoll - 2;
        } else if (defVal < atkVal) {
            finalDefRoll = defRoll - 2;
        }

        // Winner determined purely by die rolls
        winner = finalAtkRoll > finalDefRoll ? attackerId : 'defenders';
    }

    const effects = { is2v1: true, defenderIds };
    if (dieRollUsed) {
        effects.attackerRoll = atkRoll;
        effects.defendersRoll = defRoll;
    }

    // Add stamina penalty info to effects
    if (atkSpeedPenalty > 0) effects.attackerStaminaPenalty = true;
    if (def1SpeedPenalty > 0 || def2SpeedPenalty > 0) {
        effects.defendersStaminaPenalty = [];
        if (def1SpeedPenalty > 0) effects.defendersStaminaPenalty.push(defenderIds[0]);
        if (def2SpeedPenalty > 0) effects.defendersStaminaPenalty.push(defenderIds[1]);
    }

    // Locks
    if (winner === attackerId) {
        def1.lockTurns = action === "dribble" ? 4 : 3;
        def2.lockTurns = action === "dribble" ? 4 : 3;
        attacker.hasBall = true;
        def1.hasBall = false;
        def2.hasBall = false;

        if (action === "pass" && targetNodeId) {
            const targetNode = getNode(targetNodeId);
            if (targetNode) {
                for (const occId of targetNode.occupants) {
                    const occ = units.get(occId);
                    if (occ && occ.ownerId === attacker.ownerId) {
                        attacker.hasBall = false;
                        occ.hasBall = true;
                        effects.ballRecipient = occId;
                        break;
                    }
                }
            }
        } else if (action === "shoot") {
            effects.scoreGoal = true;
        }
    } else {
        attacker.lockTurns = action === "dribble" ? 4 : 3;
        attacker.hasBall = false;
        effects.chooseBallRecipient = true;

        if (action === "shoot") {
            const pos = attacker.position;
            effects.moveBackNode = pos === 12 ? 10 : (pos === 1 ? 2 : null);
        }
    }

    return { winner, losers: winner === attackerId ? defenderIds : [attackerId], action, postEffects: effects };
}

export { resolve1v1, resolve2v1 };