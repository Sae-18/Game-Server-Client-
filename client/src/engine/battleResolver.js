import { units, cardMap } from "./unit";
import { getNode } from "./board";

function getRandInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getGKSpeedPenalty(unit) {
    if (!unit || !unit.isGK) return 0;

    const pos = unit.position;

    if (unit.ownerId === 'P1') {
        if (pos === 1) return 0;
        if (pos === 2 || pos === 3) return 3;
        return 6;
    }

    if (unit.ownerId === 'P2') {
        if (pos === 12) return 0;
        if (pos === 10 || pos === 11) return 3;
        return 6;
    }

    return 0;
}

function resolve1v1(attackerId, defenderId, action, turnManager, targetNodeId, manualRolls, isSurrender = false, surrenderingSide = null) {
    const attacker = units.get(attackerId);
    const defender = units.get(defenderId);
    if (!attacker || !defender) return null;

    const atkCard = cardMap.get(attacker.cardId);
    const defCard = cardMap.get(defender.cardId);
    if (!atkCard || !defCard) return null;

    // ✅ HANDLE SURRENDER
    if (isSurrender) {
        const winner = surrenderingSide === 'attacker' ? defenderId : attackerId;
        const loser = surrenderingSide === 'attacker' ? attackerId : defenderId;
        const loserUnit = units.get(loser);

        // Deduct 2 stamina from surrendering unit
        loserUnit.stamina = Math.max(0, loserUnit.stamina - 2);

        // Apply locks
        loserUnit.lockTurns = 2; //

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
                            return {
                                winner,
                                loser,
                                action,
                                postEffects: { ballRecipient: occId, surrendered: true }
                            };
                        }
                    }
                }
            } else if (action === "shoot") {
                return {
                    winner,
                    loser,
                    action,
                    postEffects: { scoreGoal: true, surrendered: true }
                };
            }
        } else {
            defender.hasBall = true;
            attacker.hasBall = false;

            if (action === "shoot") {
                const pos = attacker.position;
                return {
                    winner,
                    loser,
                    action,
                    postEffects: {
                        moveBackNode: pos === 12 ? 10 : (pos === 1 ? 2 : null),
                        surrendered: true
                    }
                };
            }
        }

        return { winner, loser, action, postEffects: { surrendered: true } };
    }

    // ✅ NORMAL BATTLE with GK penalty
    let atkVal = 0, defVal = 0, atkCost = 0, defCost = 0;
    let atkSpeedPenalty = 0, defSpeedPenalty = 0;

    // ✅ Get GK penalties
    const atkGKPenalty = getGKSpeedPenalty(attacker);
    const defGKPenalty = getGKSpeedPenalty(defender);

    if (action === "dribble") {
        atkCost = Math.max(atkCard.stats.dribbling?.cost || 0, atkCard.stats.speed?.cost || 0);
        defCost = Math.max(defCard.stats.defending?.cost || 0, defCard.stats.speed?.cost || 0);

        if (attacker.stamina < atkCost) atkSpeedPenalty = 3;
        if (defender.stamina < defCost) defSpeedPenalty = 3;

        atkVal = (atkCard.stats.dribbling?.value || 0) + (atkCard.stats.speed?.value || 0) - atkSpeedPenalty - atkGKPenalty;
        defVal = (defCard.stats.defending?.value || 0) + (defCard.stats.speed?.value || 0) - defSpeedPenalty - defGKPenalty;
    } else if (action === "pass") {
        atkCost = Math.max(atkCard.stats.passing?.cost || 0, atkCard.stats.speed?.cost || 0);
        defCost = defCard.stats.speed?.cost || 0;

        if (attacker.stamina < atkCost) atkSpeedPenalty = 3;
        if (defender.stamina < defCost) defSpeedPenalty = 3;

        atkVal = (atkCard.stats.passing?.value || 0) + (atkCard.stats.speed?.value || 0) - atkSpeedPenalty - atkGKPenalty;
        defVal = ((defCard.stats.speed?.value || 0) - defSpeedPenalty - defGKPenalty) * 2;
    } else if (action === "shoot") {
        atkCost = Math.max(atkCard.stats.shooting?.cost || 0, atkCard.stats.speed?.cost || 0);
        defCost = Math.max(defCard.stats.defending?.cost || 0, defCard.stats.speed?.cost || 0);

        if (attacker.stamina < atkCost) atkSpeedPenalty = 3;
        if (defender.stamina < defCost) defSpeedPenalty = 3;

        atkVal = (atkCard.stats.shooting?.value || 0) + (atkCard.stats.speed?.value || 0) - atkSpeedPenalty - atkGKPenalty;
        defVal = (defCard.stats.defending?.value || 0) + (defCard.stats.speed?.value || 0) - defSpeedPenalty - defGKPenalty;
    }

    const diff = atkVal - defVal;
    let winner, dieRollUsed = false, atkRoll = null, defRoll = null;

    if (Math.abs(diff) > 5) {
        winner = diff > 0 ? attackerId : defenderId;
        if (winner === defenderId) {
            attacker.stamina = Math.max(0, attacker.stamina - atkCost);
        } else {
            defender.stamina = Math.max(0, defender.stamina - defCost);
        }
    } else {
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

        let finalAtkRoll = atkRoll;
        let finalDefRoll = defRoll;

        if (atkVal < defVal) {
            finalAtkRoll = atkRoll - 2;
        } else if (defVal < atkVal) {
            finalDefRoll = defRoll - 2;
        }

        winner = finalAtkRoll > finalDefRoll ? attackerId : defenderId;
    }

    const effects = {};
    if (dieRollUsed) {
        effects.attackerRoll = atkRoll;
        effects.defenderRoll = defRoll;
    }

    if (atkSpeedPenalty > 0) effects.attackerStaminaPenalty = true;
    if (defSpeedPenalty > 0) effects.defenderStaminaPenalty = true;
    if (atkGKPenalty > 0) effects.attackerGKPenalty = atkGKPenalty;
    if (defGKPenalty > 0) effects.defenderGKPenalty = defGKPenalty;

    const loser = winner === attackerId ? defenderId : attackerId;
    const loserUnit = units.get(loser);

    loserUnit.lockTurns = action === "dribble" ? 4 : 3;

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

// ✅ UPDATE resolve2v1 (1 attacker vs 2 defenders) - Add to function signature
function resolve2v1(attackerId, defenderIds, action, turnManager, targetNodeId, manualRolls, isSurrender = false, surrenderingSide = null) {
    const attacker = units.get(attackerId);
    const def1 = units.get(defenderIds[0]);
    const def2 = units.get(defenderIds[1]);
    if (!attacker || !def1 || !def2) return null;

    const atkCard = cardMap.get(attacker.cardId);
    const def1Card = cardMap.get(def1.cardId);
    const def2Card = cardMap.get(def2.cardId);
    if (!atkCard || !def1Card || !def2Card) return null;

    // ✅ HANDLE SURRENDER
    if (isSurrender) {
        const winner = surrenderingSide === 'attacker' ? 'defenders' : attackerId;

        if (surrenderingSide === 'attacker') {
            // Attacker surrenders: -2 stamina, lock, lose ball
            attacker.stamina = Math.max(0, attacker.stamina - 2);
            attacker.lockTurns = 2;
            attacker.hasBall = false;
            // One defender gets ball (handled by UI)
            return {
                winner: 'defenders',
                losers: [attackerId],
                action,
                postEffects: { surrendered: true, chooseBallRecipient: true }
            };
        } else {
            // Defenders surrender: -2 stamina each, lock both, attacker keeps ball
            def1.stamina = Math.max(0, def1.stamina - 2);
            def2.stamina = Math.max(0, def2.stamina - 2);
            def1.lockTurns = 2; // ✅ Always 2 turns for surrender
            def2.lockTurns = 2; // ✅ Always 2 turns for surrender
            def1.hasBall = false;
            def2.hasBall = false;
            attacker.hasBall = true;

            if (action === "shoot") {
                return {
                    winner: attackerId,
                    losers: defenderIds,
                    action,
                    postEffects: { surrendered: true, scoreGoal: true }
                };
            }

            return {
                winner: attackerId,
                losers: defenderIds,
                action,
                postEffects: { surrendered: true }
            };
        }
    }

    // ✅ NORMAL BATTLE with GK penalty
    let atkVal = 0, defVal = 0, atkCost = 0;
    let atkSpeedPenalty = 0, def1SpeedPenalty = 0, def2SpeedPenalty = 0;

    // ✅ Get GK penalties
    const atkGKPenalty = getGKSpeedPenalty(attacker);
    const def1GKPenalty = getGKSpeedPenalty(def1);
    const def2GKPenalty = getGKSpeedPenalty(def2);

    if (action === "dribble") {
        atkCost = Math.max(atkCard.stats.dribbling?.cost || 0, atkCard.stats.speed?.cost || 0);
        const def1Cost = Math.max(def1Card.stats.defending?.cost || 0, def1Card.stats.speed?.cost || 0);
        const def2Cost = Math.max(def2Card.stats.defending?.cost || 0, def2Card.stats.speed?.cost || 0);

        if (attacker.stamina < atkCost) atkSpeedPenalty = 3;
        if (def1.stamina < def1Cost) def1SpeedPenalty = 3;
        if (def2.stamina < def2Cost) def2SpeedPenalty = 3;

        atkVal = ((atkCard.stats.dribbling?.value || 0) + (atkCard.stats.speed?.value || 0) - atkSpeedPenalty - atkGKPenalty) * 1.95;
        defVal = (def1Card.stats.defending?.value || 0) + (def1Card.stats.speed?.value || 0) - def1SpeedPenalty - def1GKPenalty +
            (def2Card.stats.defending?.value || 0) + (def2Card.stats.speed?.value || 0) - def2SpeedPenalty - def2GKPenalty;
    } else if (action === "pass") {
        atkCost = Math.max(atkCard.stats.passing?.cost || 0, atkCard.stats.speed?.cost || 0);
        const def1Cost = def1Card.stats.speed?.cost || 0;
        const def2Cost = def2Card.stats.speed?.cost || 0;

        if (attacker.stamina < atkCost) atkSpeedPenalty = 3;
        if (def1.stamina < def1Cost) def1SpeedPenalty = 3;
        if (def2.stamina < def2Cost) def2SpeedPenalty = 3;

        atkVal = ((atkCard.stats.passing?.value || 0) + (atkCard.stats.speed?.value || 0) - atkSpeedPenalty - atkGKPenalty) * 1.95;
        defVal = (def1Card.stats.speed?.value || 0) - def1SpeedPenalty - def1GKPenalty +
            (def2Card.stats.speed?.value || 0) - def2SpeedPenalty - def2GKPenalty;
    } else if (action === "shoot") {
        atkCost = Math.max(atkCard.stats.shooting?.cost || 0, atkCard.stats.speed?.cost || 0);
        const def1Cost = Math.max(def1Card.stats.defending?.cost || 0, def1Card.stats.speed?.cost || 0);
        const def2Cost = Math.max(def2Card.stats.defending?.cost || 0, def2Card.stats.speed?.cost || 0);

        if (attacker.stamina < atkCost) atkSpeedPenalty = 3;
        if (def1.stamina < def1Cost) def1SpeedPenalty = 3;
        if (def2.stamina < def2Cost) def2SpeedPenalty = 3;

        atkVal = ((atkCard.stats.shooting?.value || 0) + (atkCard.stats.speed?.value || 0) - atkSpeedPenalty - atkGKPenalty) * 1.95;
        defVal = (def1Card.stats.defending?.value || 0) + (def1Card.stats.speed?.value || 0) - def1SpeedPenalty - def1GKPenalty +
            (def2Card.stats.defending?.value || 0) + (def2Card.stats.speed?.value || 0) - def2SpeedPenalty - def2GKPenalty;
    }

    const diff = atkVal - defVal;
    let winner, dieRollUsed = false, atkRoll = null, defRoll = null;

    if (Math.abs(diff) > 10) {
        winner = diff > 0 ? attackerId : 'defenders';
        if (winner === 'defenders') {
            attacker.stamina = Math.max(0, attacker.stamina - atkCost);
        } else {
            const def1Cost = action === "pass" ? (def1Card.stats.speed?.cost || 0) :
                Math.max(def1Card.stats.defending?.cost || 0, def1Card.stats.speed?.cost || 0);
            const def2Cost = action === "pass" ? (def2Card.stats.speed?.cost || 0) :
                Math.max(def2Card.stats.defending?.cost || 0, def2Card.stats.speed?.cost || 0);
            def1.stamina = Math.max(0, def1.stamina - def1Cost);
            def2.stamina = Math.max(0, def2.stamina - def2Cost);
        }
    } else {
        dieRollUsed = true;
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

        let finalAtkRoll = atkRoll;
        let finalDefRoll = defRoll;

        if (atkVal < defVal) {
            finalAtkRoll = atkRoll - 2;
        } else if (defVal < atkVal) {
            finalDefRoll = defRoll - 2;
        }

        winner = finalAtkRoll > finalDefRoll ? attackerId : 'defenders';
    }

    const effects = { is2v1: true, defenderIds };
    if (dieRollUsed) {
        effects.attackerRoll = atkRoll;
        effects.defendersRoll = defRoll;
    }

    if (atkSpeedPenalty > 0) effects.attackerStaminaPenalty = true;
    if (def1SpeedPenalty > 0 || def2SpeedPenalty > 0) {
        effects.defendersStaminaPenalty = [];
        if (def1SpeedPenalty > 0) effects.defendersStaminaPenalty.push(defenderIds[0]);
        if (def2SpeedPenalty > 0) effects.defendersStaminaPenalty.push(defenderIds[1]);
    }
    if (atkGKPenalty > 0) effects.attackerGKPenalty = atkGKPenalty;
    if (def1GKPenalty > 0 || def2GKPenalty > 0) {
        effects.defendersGKPenalty = [];
        if (def1GKPenalty > 0) effects.defendersGKPenalty.push({ id: defenderIds[0], penalty: def1GKPenalty });
        if (def2GKPenalty > 0) effects.defendersGKPenalty.push({ id: defenderIds[1], penalty: def2GKPenalty });
    }

    // Rest of the function remains the same...
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

// ✅ UPDATE resolve2v1Attackers similarly (2 attackers vs 1 defender)
function resolve2v1Attackers(attackerIds, defenderId, action, turnManager, targetNodeId, manualRolls, isSurrender = false, surrenderingSide = null) {
    const attacker1 = units.get(attackerIds[0]);
    const attacker2 = units.get(attackerIds[1]);
    const defender = units.get(defenderId);

    if (!attacker1 || !attacker2 || !defender) return null;

    const atk1Card = cardMap.get(attacker1.cardId);
    const atk2Card = cardMap.get(attacker2.cardId);
    const defCard = cardMap.get(defender.cardId);

    if (!atk1Card || !atk2Card || !defCard) return null;

    // ✅ HANDLE SURRENDER
    if (isSurrender) {
        const winner = surrenderingSide === 'attacker' ? defenderId : 'attackers';

        if (surrenderingSide === 'attacker') {
            // Attackers surrender: -2 stamina each, lock both, lose ball
            attacker1.stamina = Math.max(0, attacker1.stamina - 2);
            attacker2.stamina = Math.max(0, attacker2.stamina - 2);
            attacker1.lockTurns = 2; // ✅ Always 2 turns for surrender
            attacker2.lockTurns = 2; // ✅ Always 2 turns for surrender
            attacker1.hasBall = false;
            attacker2.hasBall = false;
            defender.hasBall = true;

            if (action === "shoot") {
                const ballCarrier = attacker1.hasBall ? attacker1 : attacker2;
                const pos = ballCarrier.position;
                return {
                    winner: defenderId,
                    losers: attackerIds,
                    action,
                    postEffects: {
                        surrendered: true,
                        moveBackNode: pos === 12 ? 10 : (pos === 1 ? 2 : null)
                    }
                };
            }

            return {
                winner: defenderId,
                losers: attackerIds,
                action,
                postEffects: { surrendered: true }
            };
        } else {
            // Defender surrenders: -2 stamina, lock, attackers keep ball
            defender.stamina = Math.max(0, defender.stamina - 2);
            defender.lockTurns = 2;
            defender.hasBall = false;

            let ballCarrier = attacker1.hasBall ? attacker1 : attacker2;
            ballCarrier.hasBall = true;

            if (action === "pass") {
                const otherAttacker = ballCarrier.id === attacker1.id ? attacker2 : attacker1;
                ballCarrier.hasBall = false;
                otherAttacker.hasBall = true;
                return {
                    winner: 'attackers',
                    losers: [defenderId],
                    action,
                    postEffects: { surrendered: true, ballRecipient: otherAttacker.id }
                };
            } else if (action === "shoot") {
                return {
                    winner: 'attackers',
                    losers: [defenderId],
                    action,
                    postEffects: { surrendered: true, scoreGoal: true }
                };
            }

            return {
                winner: 'attackers',
                losers: [defenderId],
                action,
                postEffects: { surrendered: true }
            };
        }
    }

    // ✅ NORMAL BATTLE with GK penalty
    let atkVal = 0, defVal = 0, atkCost1 = 0, atkCost2 = 0, defCost = 0;
    let atk1SpeedPenalty = 0, atk2SpeedPenalty = 0, defSpeedPenalty = 0;

    // ✅ Get GK penalties
    const atk1GKPenalty = getGKSpeedPenalty(attacker1);
    const atk2GKPenalty = getGKSpeedPenalty(attacker2);
    const defGKPenalty = getGKSpeedPenalty(defender);

    if (action === "dribble") {
        atkCost1 = Math.max(atk1Card.stats.dribbling?.cost || 0, atk1Card.stats.speed?.cost || 0);
        atkCost2 = Math.max(atk2Card.stats.dribbling?.cost || 0, atk2Card.stats.speed?.cost || 0);
        defCost = Math.max(defCard.stats.defending?.cost || 0, defCard.stats.speed?.cost || 0);

        if (attacker1.stamina < atkCost1) atk1SpeedPenalty = 3;
        if (attacker2.stamina < atkCost2) atk2SpeedPenalty = 3;
        if (defender.stamina < defCost) defSpeedPenalty = 3;

        atkVal = (atk1Card.stats.dribbling?.value || 0) + (atk1Card.stats.speed?.value || 0) - atk1SpeedPenalty - atk1GKPenalty +
            (atk2Card.stats.dribbling?.value || 0) + (atk2Card.stats.speed?.value || 0) - atk2SpeedPenalty - atk2GKPenalty;
        defVal = ((defCard.stats.defending?.value || 0) + (defCard.stats.speed?.value || 0) - defSpeedPenalty - defGKPenalty) * 1.95;
    } else if (action === "pass") {
        atkCost1 = Math.max(atk1Card.stats.passing?.cost || 0, atk1Card.stats.speed?.cost || 0);
        atkCost2 = Math.max(atk2Card.stats.passing?.cost || 0, atk2Card.stats.speed?.cost || 0);
        defCost = defCard.stats.speed?.cost || 0;

        if (attacker1.stamina < atkCost1) atk1SpeedPenalty = 3;
        if (attacker2.stamina < atkCost2) atk2SpeedPenalty = 3;
        if (defender.stamina < defCost) defSpeedPenalty = 3;

        atkVal = (atk1Card.stats.passing?.value || 0) + (atk1Card.stats.speed?.value || 0) - atk1SpeedPenalty - atk1GKPenalty +
            (atk2Card.stats.passing?.value || 0) + (atk2Card.stats.speed?.value || 0) - atk2SpeedPenalty - atk2GKPenalty;
        defVal = ((defCard.stats.speed?.value || 0) - defSpeedPenalty - defGKPenalty) * 1.95;
    } else if (action === "shoot") {
        atkCost1 = Math.max(atk1Card.stats.shooting?.cost || 0, atk1Card.stats.speed?.cost || 0);
        atkCost2 = Math.max(atk2Card.stats.shooting?.cost || 0, atk2Card.stats.speed?.cost || 0);
        defCost = Math.max(defCard.stats.defending?.cost || 0, defCard.stats.speed?.cost || 0);

        if (attacker1.stamina < atkCost1) atk1SpeedPenalty = 3;
        if (attacker2.stamina < atkCost2) atk2SpeedPenalty = 3;
        if (defender.stamina < defCost) defSpeedPenalty = 3;

        atkVal = (atk1Card.stats.shooting?.value || 0) + (atk1Card.stats.speed?.value || 0) - atk1SpeedPenalty - atk1GKPenalty +
            (atk2Card.stats.shooting?.value || 0) + (atk2Card.stats.speed?.value || 0) - atk2SpeedPenalty - atk2GKPenalty;
        defVal = ((defCard.stats.defending?.value || 0) + (defCard.stats.speed?.value || 0) - defSpeedPenalty - defGKPenalty) * 1.95;
    }

    const diff = atkVal - defVal;
    let winner, dieRollUsed = false, atkRoll = null, defRoll = null;

    if (Math.abs(diff) > 10) {
        winner = diff > 0 ? 'attackers' : defenderId;
        if (winner === defenderId) {
            attacker1.stamina = Math.max(0, attacker1.stamina - atkCost1);
            attacker2.stamina = Math.max(0, attacker2.stamina - atkCost2);
        } else {
            defender.stamina = Math.max(0, defender.stamina - defCost);
        }
    } else {
        dieRollUsed = true;
        attacker1.stamina = Math.max(0, attacker1.stamina - atkCost1);
        attacker2.stamina = Math.max(0, attacker2.stamina - atkCost2);
        defender.stamina = Math.max(0, defender.stamina - defCost);

        if (manualRolls && manualRolls.attackers !== undefined && manualRolls.defender !== undefined) {
            atkRoll = manualRolls.attackers;
            defRoll = manualRolls.defender;
        } else {
            atkRoll = getRandInt(1, 6);
            defRoll = getRandInt(1, 6);
        }

        let finalAtkRoll = atkRoll;
        let finalDefRoll = defRoll;

        if (atkVal < defVal) {
            finalAtkRoll = atkRoll - 2;
        } else if (defVal < atkVal) {
            finalDefRoll = defRoll - 2;
        }

        winner = finalAtkRoll > finalDefRoll ? 'attackers' : defenderId;
    }

    const effects = { is2v1Attackers: true, attackerIds };
    if (dieRollUsed) {
        effects.attackersRoll = atkRoll;
        effects.defenderRoll = defRoll;
    }

    if (atk1SpeedPenalty > 0 || atk2SpeedPenalty > 0) {
        effects.attackersStaminaPenalty = [];
        if (atk1SpeedPenalty > 0) effects.attackersStaminaPenalty.push(attackerIds[0]);
        if (atk2SpeedPenalty > 0) effects.attackersStaminaPenalty.push(attackerIds[1]);
    }
    if (defSpeedPenalty > 0) effects.defenderStaminaPenalty = true;
    if (atk1GKPenalty > 0 || atk2GKPenalty > 0) {
        effects.attackersGKPenalty = [];
        if (atk1GKPenalty > 0) effects.attackersGKPenalty.push({ id: attackerIds[0], penalty: atk1GKPenalty });
        if (atk2GKPenalty > 0) effects.attackersGKPenalty.push({ id: attackerIds[1], penalty: atk2GKPenalty });
    }
    if (defGKPenalty > 0) effects.defenderGKPenalty = defGKPenalty;

    // Rest of the function remains the same...
    if (winner === 'attackers') {
        defender.lockTurns = action === "dribble" ? 4 : 3;

        let ballCarrier = attacker1.hasBall ? attacker1 : attacker2;
        ballCarrier.hasBall = true;
        defender.hasBall = false;

        if (action === "pass") {
            const otherAttacker = ballCarrier.id === attacker1.id ? attacker2 : attacker1;
            ballCarrier.hasBall = false;
            otherAttacker.hasBall = true;
            effects.ballRecipient = otherAttacker.id;
        } else if (action === "shoot") {
            effects.scoreGoal = true;
        }
    } else {
        attacker1.lockTurns = action === "dribble" ? 4 : 3;
        attacker2.lockTurns = action === "dribble" ? 4 : 3;
        attacker1.hasBall = false;
        attacker2.hasBall = false;
        defender.hasBall = true;

        if (action === "shoot") {
            const ballCarrier = attacker1.hasBall ? attacker1 : attacker2;
            const pos = ballCarrier.position;
            effects.moveBackNode = pos === 12 ? 10 : (pos === 1 ? 2 : null);
        }
    }

    return {
        winner,
        losers: winner === 'attackers' ? [defenderId] : attackerIds,
        action,
        postEffects: effects
    };
}

export { resolve1v1, resolve2v1, resolve2v1Attackers };