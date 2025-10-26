import { GameManager } from './engine/game';
import { units, spawnUnitFromCard, resetUnits } from './engine/unit';
const game = new GameManager();
// DOM references
const nodesContainer = document.getElementById('nodes-container');
const unitsContainer = document.getElementById('units-container');
const actionPanel = document.getElementById('action-panel');
const scoreP1 = document.getElementById('score-p1');
const scoreP2 = document.getElementById('score-p2');
const currentTurnEl = document.getElementById('current-turn');
let selectedUnitId = null;
let actionMode = 'idle';
// ----- Node coordinates (PERCENT) -----
const nodeCoordinates = new Map([
    [1, { xPercent: 12.5, yPercent: 50 }],
    [2, { xPercent: 25, yPercent: 25 }],
    [3, { xPercent: 25, yPercent: 75 }],
    [4, { xPercent: 37.25, yPercent: 25 }],
    [5, { xPercent: 37.25, yPercent: 50 }],
    [6, { xPercent: 37.25, yPercent: 75 }],
    [7, { xPercent: 50, yPercent: 25 }],
    [8, { xPercent: 50, yPercent: 50 }],
    [9, { xPercent: 50, yPercent: 75 }],
    [10, { xPercent: 62.5, yPercent: 25 }],
    [11, { xPercent: 62.5, yPercent: 75 }],
    [12, { xPercent: 75, yPercent: 50 }]
]);
function getPixelPosition(xPercent, yPercent, container) {
    return {
        x: (xPercent / 100) * container.clientWidth,
        y: (yPercent / 100) * container.clientHeight
    };
}
// ----- Render nodes -----
function renderNodes() {
    nodesContainer.innerHTML = '';
    nodeCoordinates.forEach((coord, nodeId) => {
        const nodeEl = document.createElement('div');
        nodeEl.className = 'node-marker';
        nodeEl.style.position = 'absolute';
        const { x, y } = getPixelPosition(coord.xPercent, coord.yPercent, nodesContainer);
        nodeEl.style.left = `${x}px`;
        nodeEl.style.top = `${y}px`;
        nodeEl.style.width = '28px';
        nodeEl.style.height = '28px';
        nodeEl.style.transform = 'translate(-50%,-50%)';
        nodeEl.style.border = '2px solid rgba(156,163,175,0.8)';
        nodeEl.style.borderRadius = '9999px';
        nodeEl.style.zIndex = '20';
        nodeEl.dataset.nodeId = String(nodeId);
        nodesContainer.appendChild(nodeEl);
    });
}
// ----- Render units (spaced & rounded) -----
function renderUnits() {
    unitsContainer.innerHTML = '';
    const grouped = new Map();
    for (const unit of units.values()) {
        const nodeId = Number(unit.position);
        if (!grouped.has(nodeId))
            grouped.set(nodeId, []);
        grouped.get(nodeId).push(unit);
    }
    grouped.forEach((nodeUnits, nodeId) => {
        const coord = nodeCoordinates.get(nodeId);
        if (!coord)
            return;
        const center = getPixelPosition(coord.xPercent, coord.yPercent, unitsContainer);
        const n = nodeUnits.length;
        const minRadius = 25;
        const scaleFactor = 15;
        const radius = Math.min(60, minRadius + (n - 2) * scaleFactor);
        const offsetRadius = n === 1 ? 0 : radius;
        nodeUnits.forEach((unit, index) => {
            const angle = (2 * Math.PI * index) / n;
            const dx = Math.cos(angle) * offsetRadius;
            const dy = Math.sin(angle) * offsetRadius;
            // Unit token
            const u = document.createElement('div'); // this is the container
            u.style.position = 'absolute'; // keep the absolute positioning
            u.style.left = `${Math.round(center.x + dx)}px`;
            u.style.top = `${Math.round(center.y + dy)}px`;
            u.style.height = '240px'; // Ensure height is defined
            u.style.transform = 'translate(-50%,-50%)';
            u.style.display = 'flex';
            // Card Image
            const img = document.createElement('img');
            u.className = 'unit-token';
            img.src = `/cards/${unit.rarity}/${unit.cardId}.png`;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.borderRadius = '12px'; // Make it circular
            img.style.objectFit = 'cover'; // Prevents distortion
            img.style.imageRendering = 'pixelated';
            img.style.position = 'relative'; // Ensure the ball image is relative to this
            u.style.alignItems = 'center';
            u.style.justifyContent = 'center';
            u.style.color = 'white';
            u.style.fontWeight = '700';
            u.style.cursor = 'pointer';
            u.style.zIndex = `${10 + index}`;
            // Ball Indicator (if hasBall)
            if (unit.hasBall) {
                const ballImg = document.createElement('img');
                ballImg.src = '/ball.png';
                ballImg.style.position = 'absolute';
                ballImg.style.right = '0px'; // bottom right
                ballImg.style.bottom = '0px';
                ballImg.style.width = '50px';
                ballImg.style.height = '50px';
                ballImg.style.zIndex = '100';
                u.appendChild(ballImg);
            }
            u.style.background = unit.hasBall ? '#f59e0b' : (unit.ownerId === 'P1' ? '#1e40af' : '#dc2626');
            if (unit.id === selectedUnitId)
                u.style.boxShadow = '0 0 0 6px rgba(245,158,11,0.95)';
            u.appendChild(img); // Append image instead of text
            u.dataset.unitId = unit.id;
            u.title = `${unit.cardId} (${unit.id}) @ ${unit.position}`;
            u.addEventListener('click', ev => {
                ev.stopPropagation();
                if (actionMode === 'pass' && selectedUnitId) {
                    const origin = units.get(selectedUnitId);
                    return;
                }
                selectUnit(unit.id);
            });
            unitsContainer.appendChild(u);
        });
    });
}
const staminaBars = document.getElementById('stamina-bars');
function renderStamina() {
    staminaBars.innerHTML = '';
    Array.from(units.values()).forEach(unit => {
        const wrapper = document.createElement('div');
        wrapper.className = 'space-y-1';
        const label = document.createElement('div');
        label.textContent = `${unit.cardId} (${unit.name})`;
        label.className = 'text-sm font-semibold';
        const barOuter = document.createElement('div');
        barOuter.className = 'w-full bg-slate-700 h-3 rounded relative';
        const barInner = document.createElement('div');
        barInner.className = 'h-3 rounded transition-all duration-300';
        barInner.style.width = `${unit.stamina}%`;
        barInner.style.backgroundColor = unit.stamina > 30 ? '#22c55e' : '#ef4444';
        // Add numeric value
        const valueLabel = document.createElement('div');
        valueLabel.textContent = `${unit.stamina}/100`;
        valueLabel.className = 'absolute top-0 left-1 text-xs text-white font-bold';
        valueLabel.style.pointerEvents = 'none';
        barOuter.appendChild(barInner);
        barOuter.appendChild(valueLabel);
        wrapper.appendChild(label);
        wrapper.appendChild(barOuter);
        staminaBars.appendChild(wrapper);
    });
}
// ----- Unit selection -----
function selectUnit(unitId) {
    const unit = units.get(unitId);
    if (!unit)
        return;
    if (unit.ownerId !== game.turnManager.currentPlayer)
        return;
    selectedUnitId = unitId;
    actionMode = 'idle';
    renderUnits();
    renderActionPanel();
}
function clearSelection() {
    selectedUnitId = null;
    actionMode = 'idle';
    actionPanel.innerHTML = '';
    renderUnits();
}
// ----- Action panel -----
function renderActionPanel() {
    actionPanel.innerHTML = '';
    actionPanel.style.display = 'none';
    if (!selectedUnitId)
        return;
    const unit = units.get(selectedUnitId);
    if (!unit.hasBall || unit.ownerId !== game.turnManager.currentPlayer)
        return;
    ['dribble', 'pass', 'shoot'].forEach(action => {
        const btn = document.createElement('button');
        btn.textContent = action;
        btn.className = 'px-3 py-1 m-1 rounded bg-slate-700 text-white';
        btn.addEventListener('click', () => {
            if (!selectedUnitId)
                return;
            if (action === 'pass') {
                actionMode = 'pass';
                highlightPassable(selectedUnitId);
            }
            else if (action === 'dribble') {
                actionMode = 'dribble'; // 🔥 set mode instead of moving immediately
                // highlightDribbleOptions(selectedUnitId); // optional helper for UI
            }
            else if (action === 'shoot') {
                finishAction(game.handleAction(selectedUnitId, 'shoot', -1));
            }
        });
        actionPanel.appendChild(btn);
    });
    actionPanel.style.display = 'block';
}
// ----- Die Roll Animation -----
function showDieRoll(roll, onComplete) {
    const scene = document.createElement('div');
    scene.id = 'die-scene';
    scene.className = 'die-scene';
    const cube = document.createElement('div');
    cube.className = 'die-cube';
    const rotations = {
        1: 'rotateX(0deg) rotateY(0deg)',
        2: 'rotateX(-90deg)',
        3: 'rotateY(-90deg)',
        4: 'rotateY(90deg)',
        5: 'rotateX(90deg)',
        6: 'rotateY(180deg)',
    };
    for (let i = 1; i <= 6; i++) {
        const face = document.createElement('div');
        face.className = `die-face face-${i}`;
        face.style.backgroundImage = `url(/dice/die-${i}.jpg)`;
        cube.appendChild(face);
    }
    scene.appendChild(cube);
    document.body.appendChild(scene);
    // Start spinning animation
    cube.style.animation = 'spin-die 1.5s ease-out';
    setTimeout(() => {
        // Stop spinning and show the final result
        cube.style.animation = '';
        cube.style.transform = rotations[roll];
        setTimeout(() => {
            if (document.body.contains(scene))
                document.body.removeChild(scene);
            onComplete();
        }, 1500); // Show result for 1.5s
    }, 1500); // Spin for 1.5s
}
// ----- Coin Toss UI -----
function showCoinToss() {
    const container = document.createElement('div');
    container.id = 'coin-toss-container';
    container.className = 'fixed inset-0 bg-black bg-opacity-75 flex flex-col items-center justify-center z-[10000]';
    const text = document.createElement('p');
    text.className = 'text-white text-2xl mb-4';
    text.textContent = 'Coin toss...';
    container.appendChild(text);
    const winner = game.coinTossWinner;
    setTimeout(() => {
        text.textContent = `${winner} wins the toss! Choose a unit to start with the ball.`;
        const unitsToChoose = Array.from(units.values()).filter(u => u.ownerId === winner);
        const unitChoiceContainer = document.createElement('div');
        unitChoiceContainer.className = 'flex gap-4 mt-4';
        unitsToChoose.forEach(unit => {
            const unitButton = document.createElement('button');
            unitButton.textContent = unit.name;
            unitButton.className = 'px-4 py-2 rounded bg-slate-700 text-white font-bold hover:bg-slate-600';
            unitButton.addEventListener('click', () => handleKickoffChoice(unit.id));
            unitChoiceContainer.appendChild(unitButton);
        });
        container.appendChild(unitChoiceContainer);
    }, 1500); // Wait 1.5s for "Coin toss..." message
    document.body.appendChild(container);
}
function handleKickoffChoice(unitId) {
    if (game.setKickoffUnit(unitId)) {
        const container = document.getElementById('coin-toss-container');
        if (container) {
            document.body.removeChild(container);
        }
        // Now that kickoff is decided, do the initial render
        initGame();
    }
}
// ----- Battle Indicator -----
function showBattleIndicator(nodeId) {
    const coord = nodeCoordinates.get(nodeId);
    if (!coord)
        return;
    const container = document.getElementById('units-container');
    const { x, y } = getPixelPosition(coord.xPercent, coord.yPercent, container);
    const indicator = document.createElement('div');
    indicator.textContent = 'CLASH!';
    indicator.className = 'battle-indicator';
    indicator.style.position = 'absolute';
    indicator.style.left = `${x}px`;
    indicator.style.top = `${y}px`;
    indicator.style.transform = 'translate(-50%, -50%)';
    indicator.style.color = '#facc15'; // amber-400
    indicator.style.fontSize = '2.25rem'; // text-4xl
    indicator.style.fontWeight = '900';
    indicator.style.zIndex = '999';
    indicator.style.textShadow = '2px 2px 4px rgba(0,0,0,0.7)';
    indicator.style.pointerEvents = 'none';
    // Apply animation
    indicator.style.animation = 'clash-animation 1.2s ease-out forwards';
    container.appendChild(indicator);
    setTimeout(() => {
        container.removeChild(indicator);
    }, 1200); // Remove after animation ends
}
// ----- Battle Winner Display -----
function showBattleWinner(winnerId, reason) {
    const winnerUnit = units.get(winnerId);
    if (!winnerUnit)
        return;
    const container = document.createElement('div');
    container.id = 'battle-winner-container';
    container.className = 'fixed inset-0 bg-black bg-opacity-60 flex flex-col items-center justify-center z-[9998] pointer-events-none';
    const text = document.createElement('p');
    text.className = 'text-white text-4xl font-bold text-center';
    text.style.textShadow = '3px 3px 6px rgba(0,0,0,0.7)';
    text.style.animation = 'clash-animation 2.5s ease-out forwards';
    text.textContent = `${winnerUnit.name} (${winnerUnit.ownerId}) wins the clash!`;
    container.appendChild(text);
    document.body.appendChild(container);
    // The animation will fade it out, but we'll remove the element after
    setTimeout(() => {
        if (document.body.contains(container)) {
            document.body.removeChild(container);
        }
    }, 2500); // Remove after animation completes
}
// ----- Post-Battle Move Prompt -----
function promptPostBattleMove(winnerId) {
    const unit = units.get(winnerId);
    const container = document.createElement('div');
    container.id = 'post-battle-container';
    container.className = 'fixed inset-0 bg-black bg-opacity-75 flex flex-col items-center justify-center z-[10000]';
    const text = document.createElement('p');
    text.className = 'text-white text-2xl mb-4';
    text.textContent = `${unit.name} won the dribble! Choose an adjacent empty node to move to, or skip.`;
    container.appendChild(text);
    const skipButton = document.createElement('button');
    skipButton.textContent = 'Skip Move';
    skipButton.className = 'px-4 py-2 rounded bg-slate-700 text-white font-bold hover:bg-slate-600';
    skipButton.addEventListener('click', () => {
        game.state = 'inProgress'; // Reset state
        const el = document.getElementById('post-battle-container');
        if (el)
            document.body.removeChild(el);
        clearSelection();
        advanceTurn();
    });
    container.appendChild(skipButton);
    document.body.appendChild(container);
    // Highlight valid move targets
    const originNode = document.querySelector(`[data-node-id="${unit.position}"]`);
    if (originNode) {
        originNode.style.outline = '4px solid #f59e0b';
    }
    Array.from(nodesContainer.children).forEach(n => {
        const nodeId = Number(n.dataset.nodeId);
        const isNeighbor = game.board.getNode(unit.position).neighbors.includes(nodeId);
        const isEmpty = game.board.getNode(nodeId).isEmpty();
        if (isNeighbor && isEmpty) {
            n.style.outline = '3px solid rgba(59, 130, 246, 0.8)';
        }
    });
}
// ----- Highlight passable units -----
function highlightPassable(originId) {
    Array.from(nodesContainer.children).forEach(n => n.style.outline = '');
    Array.from(nodesContainer.children).forEach(n => {
        const nodeId = Number(n.dataset.nodeId);
        const candidate = Array.from(units.values()).find(u => u.position === nodeId && u.ownerId === units.get(originId).ownerId && u.id !== originId);
        if (candidate)
            n.style.outline = '3px solid rgba(34,197,94,0.8)';
    });
}
// ----- Node click -----
nodesContainer.addEventListener('click', ev => {
    const nodeEl = ev.target.closest('[data-node-id]');
    if (!nodeEl || !selectedUnitId)
        return;
    const nodeId = Number(nodeEl.dataset.nodeId);
    const origin = units.get(selectedUnitId);
    if (actionMode === 'pass') {
        const candidate = Array.from(units.values())
            .find(u => u.position === nodeId && u.ownerId === origin.ownerId && u.id !== origin.id);
        if (!candidate)
            return console.log('No friendly unit at that node.');
        doPass(selectedUnitId, nodeId);
        return;
    }
    if (actionMode === 'dribble') {
        finishAction(game.handleAction(selectedUnitId, 'dribble', nodeId));
        return;
    }
    if (game.state === 'postBattleMove') {
        const res = game.executePostBattleMove(selectedUnitId, nodeId);
        if (res && res.result === 'moved') {
            const el = document.getElementById('post-battle-container');
            if (el)
                document.body.removeChild(el);
            advanceTurn();
        }
        else {
            console.log('Invalid post-battle move');
        }
        return;
    }
    // fallback: normal move
    const res = game.moveMyUnit(selectedUnitId, origin.position, nodeId);
    if ((res === null || res === void 0 ? void 0 : res.result) === 'battle pending') {
        showBattleIndicator(nodeId);
        return renderPendingBattlePanel();
    }
    if (!res || res.result === 'illegal')
        return console.log('Move illegal', res);
    renderUnits();
    advanceTurn();
});
// ----- Pending battle panel -----
const pendingBattlePanel = document.getElementById('pending-battle-panel');
const battleText = document.getElementById('battle-text');
const battleActions = document.getElementById('battle-actions');
function renderPendingBattlePanel() {
    if (!game.pendingBattle)
        return;
    const { attackerId, defenderId } = game.pendingBattle;
    const attacker = units.get(attackerId);
    const defender = units.get(defenderId);
    pendingBattlePanel.classList.remove('hidden');
    battleText.textContent = `${attacker.cardId} vs ${defender.cardId}`;
    battleActions.innerHTML = '';
    ['dribble', 'pass', 'shoot'].forEach(action => {
        const btn = document.createElement('button');
        btn.textContent = action;
        btn.className = 'px-3 py-1 m-1 rounded bg-slate-700 text-white';
        btn.addEventListener('click', () => {
            finishBattle(game.resolvePendingBattle(action));
        });
        battleActions.appendChild(btn);
    });
}
function finishBattle(result) {
    console.log('Battle resolved:', result);
    const showWinner = () => {
        if (result && result.winner) {
            showBattleWinner(result.winner, result.reason);
        }
    };
    if (result && result.postEffects && result.postEffects.dieRoll) {
        showDieRoll(result.postEffects.dieRoll, showWinner);
    }
    pendingBattlePanel.classList.add('hidden');
    game.pendingBattle = undefined;
    renderUnits();
    // Check if we need to prompt for a post-battle move
    if (game.state === 'postBattleMove') {
        selectUnit(result.winner);
        promptPostBattleMove(result.winner);
    }
    else {
        advanceTurn();
    }
}
// ----- Pass helper -----
function doPass(originId, targetNodeId) {
    finishAction(game.handleAction(originId, 'pass', targetNodeId));
}
// ----- Finish action -----
function finishAction(result) {
    if (!result)
        return;
    // If battle resolved or normal move, render units
    renderUnits();
    updateScoreboard();
    // Handle goal: reset units, assign possession to opposing team, re-render
    if (result.result === 'goal') {
        alert(`Goal scored by ${game.turnManager.currentPlayer}!`);
        // Clear all units
        resetUnits();
        // Spawn units again
        spawnInitialUnits();
        // Give possession to the opposing team
        const kickoffTeam = game.turnManager.currentPlayer === 'P1' ? 'P2' : 'P1';
        const firstUnit = Array.from(units.values()).find(u => u.ownerId === kickoffTeam);
        if (firstUnit) {
            firstUnit.hasBall = true;
            game.turnManager.currentPlayer = kickoffTeam;
        }
        renderUnits();
        updateScoreboard();
        return;
    }
    // If battle pending, skip advancing turn
    if (result.result === 'battle pending') {
        showBattleIndicator(result.nodeId);
        renderPendingBattlePanel();
        return;
    }
    // Otherwise, normal turn advance
    advanceTurn();
    // Check for game over
    if (result.result === 'game over' || game.state === 'finished') {
        alert(`Game over! Winner: ${game.score.P1 > game.score.P2 ? 'P1' : 'P2'}`);
    }
}
// ----- Advance turn -----
function advanceTurn() {
    selectedUnitId = null;
    actionMode = 'idle';
    Array.from(nodesContainer.children).forEach(n => n.style.outline = '');
    updateScoreboard();
    renderUnits();
    actionPanel.innerHTML = '';
}
// ----- Scoreboard -----
function updateScoreboard() {
    scoreP1.textContent = `P1: ${game.score.P1}`;
    scoreP2.textContent = `P2: ${game.score.P2}`;
    currentTurnEl.textContent = `${game.turnManager.currentPlayer} (Turn ${game.turnManager.turnNumber})`;
}
// ----- Spawn units -----
function spawnInitialUnits() {
    spawnUnitFromCard('P1', 'S01', 1);
    spawnUnitFromCard('P1', 'S13', 2);
    spawnUnitFromCard('P1', 'S15', 3);
    spawnUnitFromCard('P2', 'S02', 12);
    spawnUnitFromCard('P2', 'S03', 11);
    spawnUnitFromCard('P2', 'S12', 10);
}
// ----- Resize -----
window.addEventListener('resize', () => {
    renderNodes();
    renderUnits();
});
// ----- Initialize -----
function initGame() {
    renderNodes();
    renderUnits();
    updateScoreboard();
    renderStamina();
}
function startGame() {
    spawnInitialUnits();
    if (game.state === 'coinToss') {
        showCoinToss();
    }
    else {
        initGame();
    }
}
startGame();
console.log('Current units Map:', Array.from(units.entries()));
// Expose helpers for console
window.selectUnit = selectUnit;
window.dribble = () => { if (!selectedUnitId)
    return; finishAction(game.handleAction(selectedUnitId, 'dribble', -1)); };
window.passTo = (nodeId) => { if (!selectedUnitId)
    return; finishAction(game.handleAction(selectedUnitId, 'pass', nodeId)); };
window.shoot = () => { if (!selectedUnitId)
    return; finishAction(game.handleAction(selectedUnitId, 'shoot', -1)); };
window.game = game;
window.units = units;
export { renderStamina };
