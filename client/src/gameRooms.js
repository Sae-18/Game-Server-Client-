import { GameManager } from './engine/game.js';
import { units, spawnUnitFromCard, resetUnits } from './engine/unit.js';
import { MultiplayerSync } from './socketManager.js';

// ⚠️ IMPORTANT: Change this based on your environment
const SERVER_URL = 'http://localhost:3000';

console.log('🔌 Will connect to server:', SERVER_URL);

let game = null;
let mpSync = null;
let localPlayerRole = null;
let roomCode = null;
let isJoining = false;
let isCreating = false;

const nodesContainer = document.getElementById('nodes-container');
const unitsContainer = document.getElementById('units-container');
const actionPanel = document.getElementById('action-panel');
const scoreP1 = document.getElementById('score-p1');
const scoreP2 = document.getElementById('score-p2');
const currentTurnEl = document.getElementById('current-turn');
const pendingBattlePanel = document.getElementById('pending-battle-panel');
const battleText = document.getElementById('battle-text');
const battleActions = document.getElementById('battle-actions');

let selectedUnitId = null;
let actionMode = 'idle';

// Battle roll state
let battleRollState = {
  attackerRoll: null,
  defenderRoll: null,
  action: null,
  targetNodeId: null
};

const nodeCoordinates = new Map([
  [1, { xPercent: 12.5, yPercent: 50 }],
  [2, { xPercent: 25, yPercent: 25 }],
  [3, { xPercent: 25, yPercent: 75 }],
  [4, { xPercent: 40, yPercent: 25 }],
  [5, { xPercent: 40, yPercent: 50 }],
  [6, { xPercent: 40, yPercent: 75 }],
  [7, { xPercent: 55, yPercent: 25 }],
  [8, { xPercent: 55, yPercent: 50 }],
  [9, { xPercent: 55, yPercent: 75 }],
  [10, { xPercent: 70, yPercent: 25 }],
  [11, { xPercent: 70, yPercent: 75 }],
  [12, { xPercent: 82.5, yPercent: 50 }]
]);

function getPixelPosition(xPercent, yPercent, container) {
  return { x: (xPercent / 100) * container.clientWidth, y: (yPercent / 100) * container.clientHeight };
}

export async function createRoom() {
  console.log('🗝️ Creating room...');
  console.log('📡 Connecting to server:', SERVER_URL);

  try {
    const code = await new Promise((resolve, reject) => {
      game = new GameManager();
      game.state = 'waiting';
      mpSync = new MultiplayerSync(null, null, game, onGameStateChange);

      mpSync.connect(SERVER_URL).then(() => {
        console.log('✅ Connected successfully, creating room...');
        mpSync.socket.emit('createRoom', (response) => {
          console.log('📨 Create room response:', response);
          if (response.success) {
            localPlayerRole = response.playerRole;
            roomCode = response.roomCode;
            mpSync.roomCode = roomCode;
            mpSync.localPlayerRole = localPlayerRole;
            initializeGameForCreator();
            resolve(response.roomCode);
          } else {
            reject(new Error(response.error));
          }
        });
      }).catch(error => {
        console.error('❌ Connection failed:', error);
        reject(error);
      });
    });

    return code;
  } catch (error) {
    console.error('❌ Create room error:', error);
    throw error;
  }
}

function initializeGameForCreator() {
  console.log('🎮 Initializing game for room creator...');
  game.state = 'coinToss';

  const p1Cards = ['C01', 'C01', 'S41'];
  const p2Cards = ['S01', 'S02', 'C03'];

  spawnUnitFromCard('P1', p1Cards[0], 1);
  spawnUnitFromCard('P1', p1Cards[1], 2);
  spawnUnitFromCard('P1', p1Cards[2], 3);
  spawnUnitFromCard('P2', p2Cards[0], 12);
  spawnUnitFromCard('P2', p2Cards[1], 11);
  spawnUnitFromCard('P2', p2Cards[2], 10);

  renderNodes();
  renderUnits();
  updateScoreboard();

  const roomUpdateListener = (data) => {
    if (data.players.P1 && data.players.P2 && data.state === 'inProgress') {
      console.log('✅ Both players connected, showing coin toss');
      mpSync.socket.off('roomUpdate', roomUpdateListener);
      showCoinToss();
    }
  };

  mpSync.socket.on('roomUpdate', roomUpdateListener);
}

export async function joinRoom(code) {
  await new Promise((resolve, reject) => {
    game = new GameManager();
    game.state = 'waiting';
    mpSync = new MultiplayerSync(code, null, game, onGameStateChange);

    mpSync.connect(SERVER_URL).then(() => {
      mpSync.socket.emit('joinRoom', code, (response) => {
        if (response.success) {
          localPlayerRole = response.playerRole;
          roomCode = response.roomCode;
          mpSync.roomCode = roomCode;
          mpSync.localPlayerRole = localPlayerRole;

          mpSync.socket.emit('getRoomState', code, (stateResponse) => {
            if (stateResponse.success) {
              initializeGame(code, stateResponse.room);
            }
            resolve();
          });
        } else {
          reject(new Error(response.error));
        }
      });
    }).catch(reject);
  });
}

function checkForAutoGoal() {
  let ballCarrier = null;
  for (const unit of units.values()) {
    if (unit.hasBall) {
      ballCarrier = unit;
      break;
    }
  }

  if (!ballCarrier) return null;

  const isAtGoal = (ballCarrier.ownerId === 'P1' && ballCarrier.position === 12) ||
    (ballCarrier.ownerId === 'P2' && ballCarrier.position === 1);
  if (!isAtGoal) return null;

  const goalNode = game.board.getNode(ballCarrier.position);
  if (!goalNode) return null;

  let hasOpponent = false;
  for (const occId of goalNode.occupants) {
    const occ = units.get(occId);
    if (occ && occ.ownerId !== ballCarrier.ownerId) {
      hasOpponent = true;
      break;
    }
  }

  if (!hasOpponent) {
    console.log(`AUTO GOAL! ${ballCarrier.ownerId} at node ${ballCarrier.position}`);
    return ballCarrier.ownerId;
  }
  return null;
}

function checkForBattles() {
  console.log("🔍 Checking for battles...", {
    pendingBattle: game.pendingBattle,
    gameState: game.state,
    currentTurn: game.turnManager.currentPlayer
  });

  // Don't check if already in a battle or not active
  if (game.pendingBattle || game.state !== 'inProgress') {
    console.log("⏹️ Not checking - pending battle or wrong state");
    return false;
  }

  const unitsPerNode = getUnitsPerNode();
  console.log("📊 Units per node:",
    Array.from(unitsPerNode.entries()).map(([nodeId, units]) => ({
      nodeId,
      count: units.length,
      units: units.map(u => ({
        id: u.id,
        owner: u.ownerId,
        hasBall: u.hasBall,
        lockTurns: u.lockTurns || 0
      }))
    }))
  );

  for (const [nodeId, nodeUnits] of unitsPerNode.entries()) {
    if (nodeUnits.length < 2) continue;

    // Filter out locked units — they can't fight
    const activeUnits = nodeUnits.filter(u => !u.locked && !(u.lockTurns > 0));
    if (activeUnits.length < 2) {
      console.log(`🔒 Node ${nodeId}: All or most units locked, skipping`);
      continue;
    }

    const p1Units = activeUnits.filter(u => u.ownerId === 'P1');
    const p2Units = activeUnits.filter(u => u.ownerId === 'P2');

    // In checkForBattles() - around line 230
    if (p1Units.length > 0 && p2Units.length > 0) {
      console.log(`⚔️ Node ${nodeId}: Opponents detected!`);

      const ballCarrier = activeUnits.find(u => u.hasBall);
      if (!ballCarrier) {
        console.log(`⚠️ Opponents at node but no ball carrier`);
        continue;
      }

      if (ballCarrier.locked) {
        console.log(`🚫 Ball carrier ${ballCarrier.id} locked, skipping battle`);
        continue;
      }

      // ✅ NEW: Check if it's a 2v1 situation
      const attackerTeamUnits = activeUnits.filter(u => u.ownerId === ballCarrier.ownerId);
      const defenderTeamUnits = activeUnits.filter(u => u.ownerId !== ballCarrier.ownerId);

      // Check for locked defenders
      const validDefenders = defenderTeamUnits.filter(u => !u.locked && !(u.lockTurns > 0));

      if (validDefenders.length === 0) {
        console.log(`🚫 All defenders locked, skipping battle`);
        continue;
      }

      // ✅ Determine battle type: 1v1 or 2v1
      const battleInitiator = game.turnManager.currentPlayer;

      if (attackerTeamUnits.length === 1 && validDefenders.length === 2) {
        // 2v1 Battle
        console.log(`⚔️⚔️ 2v1 BATTLE TRIGGERED at node ${nodeId}!`, {
          attacker: ballCarrier.id,
          defenders: validDefenders.map(d => d.id),
          initiator: battleInitiator
        });

        game.pendingBattle = {
          attackerId: ballCarrier.id,
          defenderIds: validDefenders.map(d => d.id),
          nodeId: nodeId,
          initiator: battleInitiator,
          is2v1: true  // ✅ Flag for 2v1
        };

        console.log(`⚔️ 2v1 Battle setup complete`);
        return true;
      } else if (attackerTeamUnits.length === 1 && validDefenders.length === 1) {
        // 1v1 Battle (existing code)
        const defender = validDefenders[0];

        if (defender.locked) {
          console.log(`🚫 Defender ${defender.id} locked, skipping battle`);
          continue;
        }

        console.log(`⚔️ BATTLE TRIGGERED at node ${nodeId}!`, {
          attacker: ballCarrier.id,
          defender: defender.id,
          initiator: battleInitiator
        });

        game.pendingBattle = {
          attackerId: ballCarrier.id,
          defenderId: defender.id,
          nodeId: nodeId,
          initiator: battleInitiator
        };

        console.log(`⚔️ Battle setup complete, turn will go to winner after resolution`);
        return true;
      } else {
        console.log(`⚠️ Unusual battle configuration:`, {
          attackers: attackerTeamUnits.length,
          defenders: validDefenders.length
        });
      }
    }

    console.log("❌ No battles detected");
    return false;
  }


  function getUnitsPerNode() {
    const grouped = new Map();
    for (const unit of units.values()) {
      const nodeId = Number(unit.position);
      if (!grouped.has(nodeId)) grouped.set(nodeId, []);
      grouped.get(nodeId).push(unit);
    }
    return grouped;
  }

  async function initializeGame(code, initialData) {
    game.state = 'coinToss';

    if (initialData.kickoffChosen && initialData.gameState?.units?.length > 0) {
      game.state = 'inProgress';
      renderNodes();
      renderUnits();
      updateScoreboard();
    } else {
      const p1Cards = ['C01', 'C01', 'S41'];
      const p2Cards = ['S01', 'S02', 'C03'];

      spawnUnitFromCard('P1', p1Cards[0], 1);
      spawnUnitFromCard('P1', p1Cards[1], 2);
      spawnUnitFromCard('P1', p1Cards[2], 3);
      spawnUnitFromCard('P2', p2Cards[0], 12);
      spawnUnitFromCard('P2', p2Cards[1], 11);
      spawnUnitFromCard('P2', p2Cards[2], 10);

      renderNodes();
      renderUnits();
      updateScoreboard();

      console.log('✅ P2 joined, both players ready for coin toss');
      showCoinToss();
    }
  }

  function showCoinToss() {
    if (document.getElementById('coin-toss-container')) {
      console.log('⚠️ Coin toss already showing');
      return;
    }

    const container = document.createElement('div');
    container.id = 'coin-toss-container';
    container.className = 'fixed inset-0 bg-black bg-opacity-75 flex flex-col items-center justify-center z-[10000]';

    const text = document.createElement('p');
    text.className = 'text-white text-2xl mb-4';
    text.textContent = 'Coin Toss - Roll the Die!';
    container.appendChild(text);

    const instruction = document.createElement('p');
    instruction.className = 'text-white text-lg mb-4';
    instruction.textContent = `${localPlayerRole}, click to roll your die`;
    container.appendChild(instruction);

    const rollBtn = document.createElement('button');
    rollBtn.textContent = 'Roll Die';
    rollBtn.className = 'px-6 py-3 rounded bg-blue-700 text-white font-bold hover:bg-blue-600 text-xl';
    rollBtn.addEventListener('click', () => handleCoinTossRoll());
    container.appendChild(rollBtn);

    const resultsDiv = document.createElement('div');
    resultsDiv.id = 'coin-toss-results';
    resultsDiv.className = 'text-white text-xl mt-6';
    container.appendChild(resultsDiv);

    document.body.appendChild(container);

    mpSync.socket.off('gameStateUpdate', updateCoinTossDisplay);

    const coinTossListener = (data) => {
      updateCoinTossDisplay(data, resultsDiv, rollBtn, coinTossListener);
    };

    mpSync.socket.on('gameStateUpdate', coinTossListener);
  }

  async function handleCoinTossRoll() {
    const roll = Math.floor(Math.random() * 6) + 1;
    mpSync.socket.emit('coinTossRoll', {
      roomCode,
      playerRole: localPlayerRole,
      roll
    });
  }

  async function resetCoinToss() {
    mpSync.socket.emit('resetCoinToss', roomCode);
  }

  function updateCoinTossDisplay(data, resultsDiv, rollBtn, listener) {
    const rolls = data.coinTossRolls;
    let html = '';

    if (rolls.P1 !== null) html += `<p>P1 rolled: ${rolls.P1}</p>`;
    if (rolls.P2 !== null) html += `<p>P2 rolled: ${rolls.P2}</p>`;

    resultsDiv.innerHTML = html;

    if (data.coinTossState === 'pending' && rolls[localPlayerRole] === null) {
      rollBtn.disabled = false;
      rollBtn.textContent = 'Roll Die';
      rollBtn.className = 'px-6 py-3 rounded bg-blue-700 text-white font-bold hover:bg-blue-600 text-xl';
      return;
    }

    if (rolls.P1 !== null && rolls.P2 !== null) {
      rollBtn.disabled = true;
      rollBtn.textContent = 'Waiting for winner...';
      rollBtn.className = 'px-6 py-3 rounded bg-gray-600 text-white font-bold text-xl cursor-not-allowed';

      let winner;
      if (rolls.P1 > rolls.P2) winner = 'P1';
      else if (rolls.P2 > rolls.P1) winner = 'P2';
      else {
        resultsDiv.innerHTML += '<p class="text-yellow-400 font-bold mt-2">Tie! Rolling again...</p>';
        setTimeout(() => resetCoinToss(), 2000);
        return;
      }

      resultsDiv.innerHTML += `<p class="text-green-400 font-bold mt-2">${winner} wins!</p>`;
      game.coinTossWinner = winner;

      if (listener) {
        mpSync.socket.off('gameStateUpdate', listener);
      }

      setTimeout(() => {
        const container = document.getElementById('coin-toss-container');
        if (container) document.body.removeChild(container);
        showKickoffChoice(winner);
      }, 2000);
    } else if (data.coinTossState === 'P2Rolling' && localPlayerRole === 'P2' && rolls.P2 === null) {
      rollBtn.disabled = false;
      rollBtn.textContent = 'Roll Die';
      rollBtn.className = 'px-6 py-3 rounded bg-blue-700 text-white font-bold hover:bg-blue-600 text-xl';
    } else if (rolls[localPlayerRole] !== null) {
      rollBtn.disabled = true;
      rollBtn.textContent = 'Waiting for opponent...';
      rollBtn.className = 'px-6 py-3 rounded bg-gray-600 text-white font-bold text-xl cursor-not-allowed';
    }
  }

  function showKickoffChoice(winner) {
    if (document.getElementById('kickoff-container')) {
      console.log('⚠️ Kickoff choice already showing');
      return;
    }

    const container = document.createElement('div');
    container.id = 'kickoff-container';
    container.className = 'fixed inset-0 bg-black bg-opacity-75 flex flex-col items-center justify-center z-[10000]';

    const text = document.createElement('p');
    text.className = 'text-white text-2xl mb-4';
    text.textContent = `${winner} wins the coin toss!`;
    container.appendChild(text);

    if (localPlayerRole === winner) {
      const instruction = document.createElement('p');
      instruction.className = 'text-white text-lg mb-4';
      instruction.textContent = 'Choose a unit to start with the ball:';
      container.appendChild(instruction);

      const unitChoiceContainer = document.createElement('div');
      unitChoiceContainer.className = 'flex gap-4 mt-4';

      Array.from(units.values()).filter(u => u.ownerId === winner).forEach(unit => {
        const btn = document.createElement('button');
        btn.textContent = unit.name;
        btn.className = 'px-4 py-2 rounded bg-slate-700 text-white font-bold hover:bg-slate-600';
        btn.addEventListener('click', () => handleKickoffChoice(unit.id));
        unitChoiceContainer.appendChild(btn);
      });
      container.appendChild(unitChoiceContainer);
    } else {
      const waiting = document.createElement('p');
      waiting.className = 'text-white text-lg mt-4';
      waiting.textContent = 'Waiting for opponent to choose...';
      container.appendChild(waiting);

      const kickoffListener = (data) => {
        if (data.kickoffChosen) {
          console.log('✅ Opponent chose kickoff, removing screen');
          mpSync.socket.off('gameStateUpdate', kickoffListener);
          const kickoffContainer = document.getElementById('kickoff-container');
          if (kickoffContainer) document.body.removeChild(kickoffContainer);
        }
      };
      mpSync.socket.on('gameStateUpdate', kickoffListener);
    }

    document.body.appendChild(container);
  }

  async function handleKickoffChoice(unitId) {
    console.log('⚽ Handling kickoff choice for unit:', unitId);

    for (const unit of units.values()) {
      unit.hasBall = false;
    }

    const unit = units.get(unitId);
    if (!unit) {
      console.error('❌ Unit not found:', unitId);
      return;
    }

    unit.hasBall = true;
    game.turnManager.currentPlayer = game.coinTossWinner;
    game.state = 'inProgress';

    console.log('✅ Ball given to:', unit.name, 'Turn:', game.turnManager.currentPlayer);

    const container = document.getElementById('kickoff-container');
    if (container) document.body.removeChild(container);

    const unitsArray = Array.from(units.values()).map(u => ({
      id: u.id ?? null,
      cardId: u.cardId ?? null,
      name: u.name ?? null,
      ownerId: u.ownerId ?? null,
      position: u.position ?? null,
      hasBall: u.hasBall || false,
      stamina: u.stamina ?? 100,
      lockTurns: u.lockTurns ?? 0,
      stats: u.stats ?? null,
      rarity: u.rarity ?? null
    }));

    mpSync.socket.emit('updateGameState', {
      roomCode,
      turn: game.turnManager.currentPlayer,
      turnNumber: game.turnManager.turnNumber,
      score: game.score,
      state: game.state,
      kickoffChosen: true,
      gameState: {
        units: unitsArray,
        pendingBattle: null
      }
    });

    renderUnits();
    updateScoreboard();

    console.log('🎮 Game ready! Current turn:', game.turnManager.currentPlayer);
  }

  function onGameStateChange(data) {
    console.log('📡 onGameStateChange called:', {
      kickoffChosen: data.kickoffChosen,
      gameState: game.state,
      pendingBattle: game.pendingBattle,
      dataHasPendingBattle: !!data.gameState?.pendingBattle
    });

    if (data.kickoffChosen && game.state === 'coinToss') {
      const container = document.getElementById('kickoff-container');
      if (container) document.body.removeChild(container);
      game.state = 'inProgress';
    }

    // ✅ SYNC PENDING BATTLE FROM SERVER
    if (data.gameState?.pendingBattle !== undefined) {
      // If server says no battle, clear local battle
      if (data.gameState.pendingBattle === null && game.pendingBattle) {
        console.log('✅ Server cleared battle, clearing local battle state');
        game.pendingBattle = null;
        battleActions.innerHTML = '';
        pendingBattlePanel.classList.add('hidden');
        game.battleAction = null;
        game.battleTargetNode = null;
      }
      // If server has a battle, sync it locally
      else if (data.gameState.pendingBattle) {
        console.log('⚔️ Syncing pending battle from server');
        game.pendingBattle = data.gameState.pendingBattle;
      }
    }

    renderUnits();
    updateScoreboard();

    if (game.state === 'inProgress' && !game.pendingBattle) {
      const scorer = checkForAutoGoal();
      if (scorer) {
        handleGoal();
        return;
      }
      if (checkForBattles()) {
        console.log('⚔️ Battle detected in onGameStateChange');
        mpSync.pushToServer();
      }
    }

    // ✅ CHECK LOCAL PENDING BATTLE (now synced with server)
    if (game.pendingBattle) {
      console.log('⚔️ Has pending battle, rendering panel');
      renderPendingBattlePanel();
    } else {
      console.log('✅ No pending battle, hiding panel');
      pendingBattlePanel.classList.add('hidden');
    }

    if (!game.pendingBattle) {
      clearSelection();
    }
  }

  // Simplified battle roll UI (like coin toss)
  function showBattleRollUI(role, unitName, onRollComplete) {
    const container = document.createElement('div');
    container.id = `battle-roll-${role}`;
    container.className = 'fixed inset-0 bg-black bg-opacity-75 flex flex-col items-center justify-center z-[10000]';

    const text = document.createElement('p');
    text.className = 'text-white text-2xl mb-4';
    text.textContent = `${role === 'attacker' ? 'Attacker' : 'Defender'}: ${unitName}`;
    container.appendChild(text);

    const instruction = document.createElement('p');
    instruction.className = 'text-white text-lg mb-4';
    instruction.textContent = 'Roll your die!';
    container.appendChild(instruction);

    const rollBtn = document.createElement('button');
    rollBtn.textContent = 'Roll Die';
    rollBtn.className = 'px-6 py-3 rounded bg-blue-700 text-white font-bold hover:bg-blue-600 text-xl';
    rollBtn.addEventListener('click', () => {
      const roll = Math.floor(Math.random() * 6) + 1;
      rollBtn.disabled = true;
      rollBtn.textContent = `Rolled: ${roll}`;
      rollBtn.className = 'px-6 py-3 rounded bg-gray-600 text-white font-bold text-xl cursor-not-allowed';

      setTimeout(() => {
        if (document.body.contains(container)) {
          document.body.removeChild(container);
        }
        onRollComplete(roll);
      }, 1500);
    });
    container.appendChild(rollBtn);

    document.body.appendChild(container);
  }

  function showBothRolls(attackerRoll, defenderRoll, onComplete) {
    const scene = document.createElement('div');
    scene.className = 'fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[9999]';

    const container = document.createElement('div');
    container.className = 'flex gap-8 items-center';

    const attackerDiv = document.createElement('div');
    attackerDiv.className = 'text-center';
    attackerDiv.innerHTML = `
    <p class="text-white text-2xl font-bold mb-4">Attacker</p>
    <div class="text-6xl font-bold text-blue-400">${attackerRoll}</div>
  `;

    const defenderDiv = document.createElement('div');
    defenderDiv.className = 'text-center';
    defenderDiv.innerHTML = `
    <p class="text-white text-2xl font-bold mb-4">Defender</p>
    <div class="text-6xl font-bold text-red-400">${defenderRoll}</div>
  `;

    container.appendChild(attackerDiv);
    container.appendChild(defenderDiv);
    scene.appendChild(container);
    document.body.appendChild(scene);

    setTimeout(() => {
      if (document.body.contains(scene)) document.body.removeChild(scene);
      onComplete();
    }, 2500);
  }

  const roomEdges = [
    { from: 1, to: 2 }, { from: 1, to: 3 }, { from: 2, to: 4 }, { from: 2, to: 5 },
    { from: 3, to: 5 }, { from: 3, to: 6 }, { from: 4, to: 7 }, { from: 4, to: 8 },
    { from: 5, to: 9 }, { from: 5, to: 8 }, { from: 5, to: 7 }, { from: 5, to: 9 },
    { from: 6, to: 8 }, { from: 4, to: 5 }, { from: 5, to: 6 }, { from: 6, to: 9 },
    { from: 7, to: 10 }, { from: 8, to: 9 }, { from: 9, to: 11 }, { from: 10, to: 12 },
    { from: 11, to: 12 }, { from: 7, to: 8 }, { from: 8, to: 10 }, { from: 8, to: 11 }
  ];

  function renderNodes() {
    nodesContainer.innerHTML = '';
    const colorMap = {
      red: { border: 'rgba(255, 80, 80, 0.8)', glow: 'rgba(255, 60, 60, 0.9)', core: 'rgba(255, 120, 120, 1.0)' },
      yellow: { border: 'rgba(255, 220, 120, 0.8)', glow: 'rgba(255, 200, 60, 0.9)', core: 'rgba(255, 240, 150, 1.0)' },
      blue: { border: 'rgba(120, 180, 255, 0.8)', glow: 'rgba(80, 160, 255, 0.9)', core: 'rgba(180, 220, 255, 1.0)' }
    };
    const nodesMap = {};

    nodeCoordinates.forEach((coord, nodeId) => {
      let scheme;
      if (nodeId === 1 || nodeId === 12) scheme = colorMap.red;
      else if ([2, 3, 10, 11].includes(nodeId)) scheme = colorMap.yellow;
      else scheme = colorMap.blue;

      const nodeEl = document.createElement('div');
      nodeEl.className = 'node-marker';
      nodeEl.style.cssText = `
      position: absolute;
      width: 28px;
      height: 28px;
      transform: translate(-50%, -50%);
      border-radius: 9999px;
      background: rgba(255, 255, 255, 0.05);
      border: 2px solid ${scheme.border};
      box-shadow: 0 0 6px ${scheme.glow}, 0 0 12px ${scheme.glow}, 0 0 20px ${scheme.glow};
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 20;
      cursor: pointer;
    `;

      const coreEl = document.createElement('div');
      coreEl.style.cssText = `
      width: 12px;
      height: 12px;
      border-radius: 9999px;
      background: ${scheme.core};
      box-shadow: 0 0 8px ${scheme.glow};
      pointer-events: none;
    `;
      nodeEl.appendChild(coreEl);

      const { x, y } = getPixelPosition(coord.xPercent, coord.yPercent, nodesContainer);
      nodeEl.style.left = `${x}px`;
      nodeEl.style.top = `${y}px`;
      nodeEl.dataset.nodeId = String(nodeId);

      nodeEl.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const clickedNodeId = Number(nodeEl.dataset.nodeId);
        console.log('🎯 Node clicked directly:', clickedNodeId);
        handleNodeClick(clickedNodeId);
      });

      nodesContainer.appendChild(nodeEl);
      nodesMap[nodeId] = { x, y };
    });

    renderEdges(roomEdges, nodesMap);
  }

  function handleNodeClick(nodeId) {
    console.log('🎯 Handling node click:', {
      nodeId,
      selectedUnitId,
      gameState: game?.state,
      isMyTurn: mpSync?.isMyTurn(),
      pendingBattle: game?.pendingBattle
    });

    if (!selectedUnitId) {
      console.log('⚠️ No unit selected');
      return;
    }

    if (game.state === 'coinToss') {
      console.log('⚠️ Still in coin toss state');
      return;
    }

    if (!mpSync || !mpSync.isMyTurn()) {
      console.log('⚠️ Not your turn');
      return;
    }

    const origin = units.get(selectedUnitId);
    if (!origin) {
      console.log('❌ Selected unit not found');
      return;
    }

    if (actionMode === 'pass') {
      const candidate = Array.from(units.values()).find(
        u => u.position === nodeId && u.ownerId === origin.ownerId && u.id !== origin.id
      );
      if (!candidate) {
        console.log('⚠️ No teammate at target node');
        return;
      }
      console.log('✅ Executing pass');
      executeAction(selectedUnitId, 'pass', nodeId);
      return;
    }

    const fromNode = game.board.getNode(origin.position);
    if (!fromNode || !fromNode.neighbors.includes(nodeId)) {
      console.log('⚠️ Not an adjacent node');
      return;
    }

    console.log('✅ Attempting move from', origin.position, 'to', nodeId);

    const result = game.moveMyUnit(selectedUnitId, origin.position, nodeId);

    if (!result) {
      console.log('❌ Move failed');
      return;
    }

    console.log('📊 Move result:', result);

    if (result.result === 'battle pending') {
      console.log('⚔️ Battle triggered!', game.pendingBattle);
      clearSelection();

      mpSync.pushToServer().then(() => {
        renderUnits();
        setTimeout(() => {
          console.log('🎮 Showing battle panel for:', game.pendingBattle);
          renderPendingBattlePanel();
        }, 100);
      });
      return;
    }

    if (result.result === 'moved') {
      console.log('✅ Move successful');

      mpSync.pushToServer().then(() => {
        renderUnits();
        updateScoreboard();
        clearSelection();

        setTimeout(() => {
          const scorer = checkForAutoGoal();
          if (scorer) {
            handleGoal();
            return;
          }
          if (checkForBattles()) {
            console.log('⚔️ New battle detected after move');
            mpSync.pushToServer().then(() => {
              renderPendingBattlePanel();
            });
          }
        }, 100);
      });
    } else if (result.result === 'illegal') {
      console.log('⚠️ Illegal move:', result.reason);
      alert(result.reason || 'Cannot move there');
    }
  }

  function renderEdges(edges, nodes) {
    const svg = document.getElementById("edges-container");
    if (!svg) {
      console.warn('⚠️ edges-container SVG not found in DOM');
      return;
    }

    const container = nodesContainer;
    if (container) {
      svg.setAttribute('width', container.clientWidth);
      svg.setAttribute('height', container.clientHeight);
      svg.style.position = 'absolute';
      svg.style.top = '0';
      svg.style.left = '0';
      svg.style.pointerEvents = 'none';
    }

    svg.innerHTML = "";

    edges.forEach(edge => {
      const from = nodes[edge.from];
      const to = nodes[edge.to];
      if (from && to) {
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", from.x);
        line.setAttribute("y1", from.y);
        line.setAttribute("x2", to.x);
        line.setAttribute("y2", to.y);
        line.setAttribute("stroke", "rgba(255,255,255,0.3)");
        line.setAttribute("stroke-width", "2");
        svg.appendChild(line);
      }
    });

    console.log(`✅ Rendered ${edges.length} edges`);
  }

  function renderUnits() {
    unitsContainer.innerHTML = '';

    getUnitsPerNode().forEach((nodeUnits, nodeId) => {
      const coord = nodeCoordinates.get(nodeId);
      if (!coord) return;
      const center = getPixelPosition(coord.xPercent, coord.yPercent, unitsContainer);
      const n = nodeUnits.length;
      const radius = Math.min(60, 25 + (n - 2) * 15);
      const offsetRadius = n === 1 ? 0 : radius;

      nodeUnits.forEach((unit, index) => {
        const angle = (2 * Math.PI * index) / n;
        const dx = Math.cos(angle) * offsetRadius;
        const dy = Math.sin(angle) * offsetRadius;
        const u = document.createElement('div');
        u.className = 'unit-token absolute flex items-center justify-center cursor-pointer';

        u.style.cssText = `left:${Math.round(center.x + dx)}px;top:${Math.round(center.y + dy)}px;transform:translate(-50%,-50%)`;

        const img = document.createElement('img');
        img.src = `/cards/${unit.rarity}/${unit.cardId}.png`;
        img.className = 'w-16 h-20 sm:w-20 sm:h-28 md:w-32 md:h-44 lg:w-48 lg:h-60 object-contain';
        img.style.cssText = 'image-rendering:pixelated;position:relative';

        if (unit.hasBall) {
          const ballImg = document.createElement('img');
          ballImg.src = '/ball.png';
          ballImg.className = 'absolute right-0 bottom-0 w-6 h-6 sm:w-8 sm:h-8 md:w-10 md:h-10 lg:w-12 lg:h-12 z-[100]';
          u.appendChild(ballImg);
        }

        u.style.background = unit.hasBall ? '#f59e0b' : (unit.ownerId === 'P1' ? '#1e40af' : '#dc2626');
        if (unit.id === selectedUnitId) u.style.boxShadow = '0 0 0 6px rgba(245,158,11,0.95)';

        u.appendChild(img);
        u.dataset.unitId = unit.id;
        u.addEventListener('click', (ev) => {
          ev.stopPropagation();

          console.log('👆 Unit clicked:', {
            unitId: unit.id,
            ownerId: unit.ownerId,
            gameState: game.state,
            actionMode,
            selectedUnitId,
            hasBall: unit.hasBall
          });

          if (game.state === 'coinToss') {
            console.log('⚠️ Still in coin toss state');
            return;
          }

          if (!mpSync) {
            console.log('⚠️ No multiplayer sync');
            return;
          }

          if (!mpSync.isMyTurn()) {
            console.log('⚠️ Not your turn (unit click)');
            return;
          }

          if (actionMode === 'pass' && selectedUnitId) {
            const origin = units.get(selectedUnitId);
            if (unit.ownerId === origin.ownerId && unit.id !== origin.id) {
              console.log('✅ Passing to teammate');
              doPass(selectedUnitId, unit.position);
            }
            return;
          }

          selectUnit(unit.id);
        });
        unitsContainer.appendChild(u);
      });
    });
    renderStaminaBars();
  }

  function renderStaminaBars() {
    const staminaPanel = document.getElementById('stamina-panel');
    if (!staminaPanel) return;
    const staminaBars = document.getElementById('stamina-bars');
    if (!staminaBars) return;
    staminaBars.innerHTML = '';

    Array.from(units.values()).forEach(unit => {
      const wrapper = document.createElement('div');
      wrapper.className = 'space-y-1';

      const label = document.createElement('div');
      label.textContent = `${unit.name} (${unit.ownerId})`;
      label.className = 'text-sm font-semibold';
      label.style.color = unit.ownerId === 'P1' ? '#3b82f6' : '#ef4444';

      const barOuter = document.createElement('div');
      barOuter.className = 'w-full bg-slate-700 h-3 rounded relative';

      const barInner = document.createElement('div');
      barInner.className = 'h-3 rounded transition-all duration-300';
      barInner.style.width = `${unit.stamina}%`;
      barInner.style.backgroundColor = unit.stamina > 30 ? '#22c55e' : '#ef4444';

      const valueLabel = document.createElement('div');
      valueLabel.textContent = `${unit.stamina}/100`;
      valueLabel.className = 'absolute top-0 left-1 text-xs text-white font-bold';
      valueLabel.style.pointerEvents = 'none';

      barOuter.appendChild(barInner);
      barOuter.appendChild(valueLabel);
      wrapper.appendChild(label);
      wrapper.appendChild(barOuter);

      if (unit.lockTurns > 0) {
        const lockStatus = document.createElement('div');
        lockStatus.className = 'text-xs font-bold mt-1 px-2 py-1 rounded';
        lockStatus.style.backgroundColor = '#fbbf24';
        lockStatus.style.color = '#78350f';
        lockStatus.textContent = `🔒 Locked for ${unit.lockTurns} turn${unit.lockTurns > 1 ? 's' : ''}`;
        wrapper.appendChild(lockStatus);
      }

      staminaBars.appendChild(wrapper);
    });
  }

  function updateScoreboard() {
    if (!game) return;
    scoreP1.textContent = `P1: ${game.score.P1}`;
    scoreP2.textContent = `P2: ${game.score.P2}`;

    const turnText = `${game.turnManager.currentPlayer} (Turn ${game.turnManager.turnNumber})`;
    const isMyTurn = mpSync && mpSync.isMyTurn();

    currentTurnEl.textContent = turnText;

    if (isMyTurn) {
      currentTurnEl.style.color = '#22c55e';
      currentTurnEl.style.fontWeight = 'bold';
    } else {
      currentTurnEl.style.color = '#ef4444';
      currentTurnEl.style.fontWeight = 'normal';
    }

    console.log('📊 Scoreboard:', {
      turn: game.turnManager.currentPlayer,
      isMyTurn,
      localPlayer: localPlayerRole
    });
  }

  function selectUnit(unitId) {
    const unit = units.get(unitId);

    console.log('🎯 Attempting to select unit:', {
      unitId,
      exists: !!unit,
      ownerId: unit?.ownerId,
      hasMpSync: !!mpSync,
      isMyTurn: mpSync?.isMyTurn(),
      isMyUnit: mpSync?.isMyUnit(unitId),
      localPlayer: localPlayerRole,
      currentTurn: game?.turnManager.currentPlayer
    });

    if (!unit) {
      console.log('❌ Unit not found');
      return;
    }

    if (!mpSync) {
      console.log('❌ No multiplayer sync');
      return;
    }

    if (!mpSync.isMyTurn()) {
      console.log('❌ Not your turn');
      return;
    }

    if (!mpSync.isMyUnit(unitId)) {
      console.log('❌ Not your unit');
      return;
    }

    selectedUnitId = unitId;
    actionMode = 'idle';

    console.log('✅ Unit selected:', unitId);

    renderUnits();
    renderActionPanel();
  }

  function clearSelection() {
    selectedUnitId = null;
    actionMode = 'idle';
    if (actionPanel) actionPanel.style.display = 'none';
    renderUnits();
  }

  function renderActionPanel() {
    actionPanel.innerHTML = '';
    actionPanel.style.display = 'none';
    if (!selectedUnitId || !mpSync || !mpSync.isMyTurn()) return;
    const unit = units.get(selectedUnitId);
    if (!unit || !unit.hasBall || unit.ownerId !== localPlayerRole) return;

    const passBtn = document.createElement('button');
    passBtn.textContent = 'Pass';
    passBtn.className = 'px-3 py-1 m-1 rounded bg-slate-700 text-white hover:bg-slate-600';
    passBtn.addEventListener('click', () => {
      actionMode = 'pass';
      highlightPassable(selectedUnitId);
    });
    actionPanel.appendChild(passBtn);
    actionPanel.style.display = 'block';
  }

  function renderPendingBattlePanel() {
    console.log('🎮 renderPendingBattlePanel called', {
      hasPendingBattle: !!game.pendingBattle,
      pendingBattle: game.pendingBattle,
      localPlayerRole
    });

    if (!game.pendingBattle) {
      console.log('⚠️ No pending battle, hiding panel');
      pendingBattlePanel.classList.add('hidden');
      return;
    }

    const { attackerId, defenderId } = game.pendingBattle;
    const attacker = units.get(attackerId);
    const defender = units.get(defenderId);

    if (!attacker || !defender) {
      console.log('❌ Battle units not found:', { attackerId, defenderId });
      pendingBattlePanel.classList.add('hidden');
      return;
    }

    console.log('⚔️ Rendering battle panel:', {
      attacker: `${attacker.name} (${attacker.ownerId})`,
      defender: `${defender.name} (${defender.ownerId})`,
      localPlayer: localPlayerRole,
      isAttacker: attacker.ownerId === localPlayerRole
    });

    pendingBattlePanel.classList.remove('hidden');
    battleText.textContent = `⚔️ ${attacker.name} vs ${defender.name}`;
    battleActions.innerHTML = '';

    // Set up defender roll listener regardless of role
    mpSync.socket.off('promptDefenderRoll');
    mpSync.socket.on('promptDefenderRoll', () => {
      if (defender.ownerId === localPlayerRole) {
        console.log(`🎲 Defender ${localPlayerRole} prompted to roll`);
        battleActions.innerHTML = '';
        showManualDieRoll(`Defender (${defender.name})`, (defenderRoll) => {
          console.log(`🎲 Defender rolled: ${defenderRoll}`);
          mpSync.socket.emit('battleRoll', {
            roomCode,
            role: 'defender',
            roll: defenderRoll
          });

          // Show waiting message after rolling
          battleActions.innerHTML = '';
          const waiting = document.createElement('p');
          waiting.className = 'text-yellow-400 text-sm mt-2';
          waiting.textContent = 'Roll submitted, waiting for resolution...';
          battleActions.appendChild(waiting);
        });
      }
    });

    if (attacker.ownerId !== localPlayerRole) {
      const waiting = document.createElement('p');
      waiting.className = 'text-yellow-400 text-sm mt-2';
      waiting.textContent = 'Waiting for attacker to choose action...';
      battleActions.appendChild(waiting);
      console.log('⏳ Not attacker, showing waiting message');
      return;
    }

    console.log('✅ Is attacker, showing action buttons');

    ['dribble', 'pass', 'shoot'].forEach(action => {
      const btn = document.createElement('button');
      btn.textContent = action.charAt(0).toUpperCase() + action.slice(1);
      btn.className = 'px-3 py-1 m-1 rounded bg-blue-700 text-white hover:bg-blue-600 font-bold';
      btn.addEventListener('click', () => {
        console.log(`🎯 Attacker chose: ${action}`);
        battleActions.querySelectorAll('button').forEach(b => b.disabled = true);
        resolveBattle(action);
      });
      battleActions.appendChild(btn);
    });
  }

  // Helper function to initiate battle rolls for both players
  function initiateBattleRolls(action, attackerId, defenderId) {
    const attacker = units.get(attackerId);
    const defender = units.get(defenderId);

    if (!attacker || !defender) return;

    console.log(`🎲 Initiating battle rolls for action: ${action}`);

    // Determine if this player is attacker or defender
    const isAttacker = attacker.ownerId === localPlayerRole;
    const role = isAttacker ? 'attacker' : 'defender';
    const unitName = isAttacker ? attacker.name : defender.name;

    // Show roll UI for this player
    showBattleRollUI(role, unitName, (roll) => {
      console.log(`🎲 ${role} rolled: ${roll}`);

      // Emit to server
      mpSync.socket.emit('battleRoll', {
        roomCode,
        role: role,
        roll: roll
      });
    });
  }





  function showManualDieRoll(label, callback) {
    // Remove any existing overlay if it exists
    const existing = document.getElementById('dice-roll-overlay');
    if (existing) existing.remove();

    // === Overlay container ===
    const overlay = document.createElement('div');
    overlay.id = 'dice-roll-overlay';
    overlay.className = `
    fixed inset-0 bg-black/70 flex items-center justify-center z-50
    transition-opacity duration-300
  `;

    // === Modal box ===
    const box = document.createElement('div');
    box.className = `
    bg-gray-900 text-white rounded-2xl shadow-2xl p-6 text-center w-80
    border border-blue-500/40
  `;

    // === Title ===
    const title = document.createElement('h2');
    title.className = 'text-xl font-bold mb-4 text-blue-400';
    title.textContent = `${label}: Roll Your Die`;
    box.appendChild(title);

    // === Die display ===
    const dieDisplay = document.createElement('div');
    dieDisplay.className = `
    text-6xl font-extrabold mb-6 text-yellow-400 select-none
  `;
    dieDisplay.textContent = '🎲';
    box.appendChild(dieDisplay);

    // === Roll button ===
    const rollBtn = document.createElement('button');
    rollBtn.textContent = 'Roll!';
    rollBtn.className = `
    px-5 py-2 bg-blue-700 hover:bg-blue-600 rounded-lg font-bold
    transition transform active:scale-95 shadow-lg
  `;
    box.appendChild(rollBtn);

    // === Status / result text ===
    const resultText = document.createElement('p');
    resultText.className = 'text-sm mt-4 text-gray-300';
    resultText.textContent = 'Click to roll the die.';
    box.appendChild(resultText);

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // === Rolling logic ===
    rollBtn.addEventListener('click', () => {
      rollBtn.disabled = true;
      resultText.textContent = 'Rolling...';
      dieDisplay.textContent = '⚙️';

      // Roll animation (like shaking dice)
      let rollCount = 0;
      const interval = setInterval(() => {
        dieDisplay.textContent = String(Math.floor(Math.random() * 6) + 1);
        rollCount++;
        if (rollCount > 10) {
          clearInterval(interval);
          const finalRoll = Math.floor(Math.random() * 6) + 1;
          dieDisplay.textContent = finalRoll;
          resultText.textContent = `You rolled a ${finalRoll}!`;
          resultText.classList.add('text-green-400');

          setTimeout(() => {
            overlay.classList.add('opacity-0');
            setTimeout(() => overlay.remove(), 300);
            callback(finalRoll);
          }, 1000);
        }
      }, 100);
    });
  }






  // NEW SIMPLIFIED BATTLE RESOLUTION (like coin toss)
  async function resolveBattle(action) {
    if (!game.pendingBattle) return;

    const { attackerId, defenderId } = game.pendingBattle;
    const attacker = units.get(attackerId);
    const defender = units.get(defenderId);
    if (!attacker || !defender) return;

    // Pre-flight check for pass
    let targetNodeId = null;
    if (action === 'pass') {
      const attackerNode = game.board.getNode(attacker.position);
      if (attackerNode) {
        for (const nId of attackerNode.neighbors) {
          const nNode = game.board.getNode(nId);
          if (nNode) {
            for (const occId of nNode.occupants) {
              if (units.get(occId)?.ownerId === attacker.ownerId) {
                targetNodeId = nId;
                break;
              }
            }
          }
          if (targetNodeId) break;
        }
      }
      if (!targetNodeId) {
        alert("No adjacent teammate to pass to!");
        return;
      }
    }

    // ✅ SHARED POST-BATTLE HANDLER
    const handleBattleComplete = async (result, rolls) => {
      if (!result) {
        console.error("❌ Battle resolution failed");
        return;
      }

      console.log("🏆 Battle resolved - Winner:", result.winner);

      // ✅ SET TURN TO WINNER
      const winnerUnit = units.get(result.winner);
      if (winnerUnit) {
        game.turnManager.currentPlayer = winnerUnit.ownerId;
        console.log(`✅ Turn awarded to battle winner: ${winnerUnit.ownerId}`);
      }

      showBattleWinner(result.winner, result.action);

      // Clear local battle state
      game.pendingBattle = null;
      battleActions.innerHTML = '';
      pendingBattlePanel.classList.add('hidden');
      game.battleAction = null;
      game.battleTargetNode = null;

      // Push to server
      await mpSync.pushToServer();

      // Emit battle finalization
      mpSync.socket.emit('finalizeBattle', {
        roomCode,
        result: {
          winner: result.winner,
          loser: result.loser,
          rolls: rolls,
          action: action
        }
      });

      mpSync.socket.emit('battleResolved', {
        roomCode,
        winner: result.winner,
        loser: result.loser,
        rolls: rolls
      });

      // Update UI
      renderUnits();
      updateScoreboard();
      clearSelection();
      renderPendingBattlePanel();

      // Handle post-battle states
      if (game.state === 'postBattleMove' && result.winner === attackerId && action === 'dribble') {
        promptPostBattleMove(result.winner);
        return;
      }

      if (result.postEffects?.scoreGoal) {
        setTimeout(() => handleGoal(), 500);
        return;
      }

      // Check for new battles
      setTimeout(() => {
        if (checkForBattles()) {
          mpSync.pushToServer();
          renderPendingBattlePanel();
        }
      }, 100);
    };

    // Determine battle type
    const battleType = game.determineBattleType(action, attackerId, defenderId);

    if (battleType && battleType.type === 'clear') {
      // NO DIE ROLL NEEDED
      console.log(`⚔️ Clear victory detected. Winner: ${battleType.winner}. No rolls needed.`);

      const fakeRolls = battleType.winner === attackerId
        ? { attacker: 6, defender: 1 }
        : { attacker: 1, defender: 6 };

      // ✅ ONLY ATTACKER RESOLVES (like die roll path)
      if (attacker.ownerId !== localPlayerRole) {
        console.log("⏳ Defender waiting for attacker to resolve clear victory...");

        // ✅ DEFENDER LISTENS FOR BATTLE COMPLETION
        const clearBattleListener = (data) => {
          // Check if battle is resolved (pendingBattle should be null in gameState)
          if (data.gameState && !data.gameState.pendingBattle) {
            console.log("✅ Defender received battle completion notification");
            mpSync.socket.off('gameStateUpdate', clearBattleListener);

            // Clear local battle UI
            game.pendingBattle = null;
            battleActions.innerHTML = '';
            pendingBattlePanel.classList.add('hidden');
            game.battleAction = null;
            game.battleTargetNode = null;

            // Update UI
            renderUnits();
            updateScoreboard();
            clearSelection();
            renderPendingBattlePanel();
          }
        };

        mpSync.socket.on('gameStateUpdate', clearBattleListener);
        return;
      }

      console.log("⚔️ Attacker resolving clear victory...");
      const result = game.resolvePendingBattle(action, targetNodeId, fakeRolls);

      // ✅ USE SHARED HANDLER
      await handleBattleComplete(result, fakeRolls);

    } else if (battleType && battleType.type === 'die_roll') {
      // DIE ROLL REQUIRED - Use simple roll UI like coin toss
      console.log(`🎲 Die roll required. Starting roll sequence...`);

      // Reset battle roll state
      battleRollState = {
        attackerRoll: null,
        defenderRoll: null,
        action: action,
        targetNodeId: targetNodeId
      };

      // BOTH PLAYERS ROLL IMMEDIATELY - JUST LIKE COIN TOSS
      // Attacker rolls
      if (attacker.ownerId === localPlayerRole) {
        console.log(`🎲 Prompting ${localPlayerRole} (ATTACKER) to roll`);
        showBattleRollUI('attacker', attacker.name, (roll) => {
          console.log(`🎲 Attacker rolled: ${roll}`);
          battleRollState.attackerRoll = roll;

          // Emit to server
          mpSync.socket.emit('battleRoll', {
            roomCode,
            role: 'attacker',
            roll: roll
          });
        });
      }

      // Defender rolls (NO WAITING - SIMULTANEOUS)
      if (defender.ownerId === localPlayerRole) {
        console.log(`🎲 Prompting ${localPlayerRole} (DEFENDER) to roll`);
        showBattleRollUI('defender', defender.name, (roll) => {
          console.log(`🎲 Defender rolled: ${roll}`);
          battleRollState.defenderRoll = roll;

          // Emit to server
          mpSync.socket.emit('battleRoll', {
            roomCode,
            role: 'defender',
            roll: roll
          });
        });
      }

      // Listen for both rolls completion
      const battleCompletionHandler = (data) => {
        const rolls = data.gameState?.battleRolls;
        if (!rolls) return;

        console.log('📊 Battle rolls update:', {
          attackerReady: rolls.attackerReady,
          defenderReady: rolls.defenderReady,
          attacker: rolls.attacker,
          defender: rolls.defender
        });

        if (rolls.attackerReady && rolls.defenderReady &&
          rolls.attacker !== null && rolls.defender !== null) {

          console.log("✅ Both rolls complete!", rolls);
          mpSync.socket.off('gameStateUpdate', battleCompletionHandler);

          // Only attacker resolves
          if (attacker.ownerId !== localPlayerRole) {
            console.log("⏳ Waiting for attacker to resolve battle...");
            return;
          }

          console.log("⚔️ Resolving battle...");

          // Show both rolls
          showBothRolls(rolls.attacker, rolls.defender, async () => {
            const result = game.resolvePendingBattle(
              battleRollState.action,
              battleRollState.targetNodeId,
              { attacker: rolls.attacker, defender: rolls.defender }
            );

            // ✅ USE SHARED HANDLER
            await handleBattleComplete(result, { attacker: rolls.attacker, defender: rolls.defender });
          });
        }
      };

      mpSync.socket.on('gameStateUpdate', battleCompletionHandler);

    } else {
      console.error("Could not determine battle type.");
    }
  }


  function promptPostBattleMove(winnerId) {
    const unit = units.get(winnerId);
    if (!unit) return;

    const container = document.createElement('div');
    container.id = 'post-battle-container';
    container.className = 'fixed inset-0 bg-black bg-opacity-75 flex flex-col items-center justify-center z-[10000]';

    const text = document.createElement('p');
    text.className = 'text-white text-2xl mb-4';
    text.textContent = `${unit.name} won! Choose adjacent empty node:`;
    container.appendChild(text);

    // const skipBtn = document.createElement('button');
    // skipBtn.textContent = 'Skip';
    // skipBtn.className = 'px-4 py-2 rounded bg-slate-700 text-white font-bold hover:bg-slate-600';
    // skipBtn.addEventListener('click', async () => {
    //   game.state = 'inProgress';
    //   const el = document.getElementById('post-battle-container');
    //   if (el) document.body.removeChild(el);
    //   await mpSync.pushToServer();
    //   clearSelection();
    // });
    // container.appendChild(skipBtn);
    // document.body.appendChild(container);

    const originNode = game.board.getNode(unit.position);
    if (originNode) {
      originNode.neighbors.forEach(nId => {
        const nNode = game.board.getNode(nId);
        if (nNode?.isEmpty()) {
          const nodeEl = document.querySelector(`[data-node-id="${nId}"]`);
          if (nodeEl) nodeEl.style.outline = '3px solid rgba(34,197,94,0.8)';
        }
      });
    }

    const handleClick = async (ev) => {
      const nodeEl = ev.target.closest('[data-node-id]');
      if (!nodeEl) return;
      const nodeId = Number(nodeEl.dataset.nodeId);
      const res = game.executePostBattleMove(winnerId, nodeId);
      if (res?.result === 'moved') {
        const el = document.getElementById('post-battle-container');
        if (el) document.body.removeChild(el);
        nodesContainer.removeEventListener('click', handleClick);
        Array.from(nodesContainer.children).forEach(n => n.style.outline = '');
        await mpSync.pushToServer();
        renderUnits();
        clearSelection();
      }
    };
    nodesContainer.addEventListener('click', handleClick);
  }

  async function executeAction(unitId, action, target) {
    if (!mpSync || !mpSync.isMyTurn()) return;
    const result = game.handleAction(unitId, action, target);
    if (!result) return;

    if (result.result === 'battle pending') renderPendingBattlePanel();
    else if (result.result === 'goal') handleGoal();

    await mpSync.pushToServer();
    renderUnits();
    updateScoreboard();
    clearSelection();
  }

  async function handleGoal() {
    alert(`Goal scored by ${game.turnManager.currentPlayer}!`);

    const p1Cards = ['S01', 'S13', 'S15'];
    const p2Cards = ['S02', 'S03', 'S12'];

    resetUnits();

    spawnUnitFromCard('P1', p1Cards[0], 1);
    spawnUnitFromCard('P1', p1Cards[1], 2);
    spawnUnitFromCard('P1', p1Cards[2], 3);
    spawnUnitFromCard('P2', p2Cards[0], 12);
    spawnUnitFromCard('P2', p2Cards[1], 11);
    spawnUnitFromCard('P2', p2Cards[2], 10);

    const kickoffTeam = game.turnManager.currentPlayer === 'P1' ? 'P2' : 'P1';
    const firstUnit = Array.from(units.values()).find(u => u.ownerId === kickoffTeam);
    if (firstUnit) {
      firstUnit.hasBall = true;
      game.turnManager.currentPlayer = kickoffTeam;
    }

    await mpSync.pushToServer();
    renderUnits();
    updateScoreboard();
  }

  function doPass(originId, targetNodeId) {
    executeAction(originId, 'pass', targetNodeId);
  }

  function highlightPassable(originId) {
    Array.from(nodesContainer.children).forEach(n => n.style.outline = '');
    const origin = units.get(originId);
    if (!origin) return;

    const originNode = game.board.getNode(origin.position);
    if (!originNode) return;

    Array.from(nodesContainer.children).forEach(n => {
      const nodeId = Number(n.dataset.nodeId);
      if (originNode.neighbors.includes(nodeId)) {
        const candidate = Array.from(units.values()).find(u => u.position === nodeId && u.ownerId === origin.ownerId && u.id !== origin.id);
        if (candidate) n.style.outline = '3px solid rgba(34,197,94,0.8)';
      }
    });
  }

  nodesContainer.addEventListener('click', async (ev) => {
    const nodeEl = ev.target.closest('[data-node-id]');

    console.log('🎯 Node container clicked', {
      hasNodeEl: !!nodeEl,
      selectedUnitId,
      gameState: game?.state,
      hasMpSync: !!mpSync,
      isMyTurn: mpSync?.isMyTurn(),
      currentPlayer: game?.turnManager?.currentPlayer,
      localPlayer: localPlayerRole
    });

    if (!nodeEl) {
      console.log('⚠️ No node element found');
      return;
    }

    if (!selectedUnitId) {
      console.log('⚠️ No unit selected');
      return;
    }

    if (game.state === 'coinToss') {
      console.log('⚠️ Still in coin toss state');
      return;
    }

    if (!mpSync) {
      console.log('⚠️ No multiplayer sync');
      return;
    }

    if (!mpSync.isMyTurn()) {
      console.log('⚠️ Not your turn:', {
        currentPlayer: game.turnManager.currentPlayer,
        localPlayer: localPlayerRole
      });
      return;
    }

    const nodeId = Number(nodeEl.dataset.nodeId);
    const origin = units.get(selectedUnitId);

    console.log('🎯 Node clicked:', {
      nodeId,
      unitId: selectedUnitId,
      actionMode,
      originPosition: origin?.position,
      currentTurn: game.turnManager.currentPlayer
    });

    if (actionMode === 'pass') {
      const candidate = Array.from(units.values()).find(u => u.position === nodeId && u.ownerId === origin.ownerId && u.id !== origin.id);
      if (!candidate) {
        console.log('⚠️ No teammate at target node');
        return;
      }
      console.log('✅ Executing pass');
      await executeAction(selectedUnitId, 'pass', nodeId);
      return;
    }

    if (actionMode === 'dribble') {
      console.log('✅ Executing dribble');
      await executeAction(selectedUnitId, 'dribble', nodeId);
      return;
    }

    const fromNode = game.board.getNode(origin.position);
    if (!fromNode) {
      console.log('❌ Origin node not found');
      return;
    }

    console.log('🔍 From node:', {
      id: origin.position,
      neighbors: fromNode.neighbors,
      occupants: Array.from(fromNode.occupants)
    });

    if (!fromNode.neighbors.includes(nodeId)) {
      console.log('⚠️ Not an adjacent node:', {
        from: origin.position,
        to: nodeId,
        neighbors: fromNode.neighbors
      });
      return;
    }

    console.log('✅ Attempting move from', origin.position, 'to', nodeId);

    const result = game.moveMyUnit(selectedUnitId, origin.position, nodeId);

    if (!result) {
      console.log('❌ Move failed - game returned false/null');
      return;
    }

    console.log('✅ Move result:', result);

    if (result.result === 'battle pending') {
      console.log('⚔️ Battle triggered!');
      await mpSync.pushToServer();
      renderPendingBattlePanel();
      renderUnits();
      return;
    }

    if (result.result === 'moved') {
      console.log('✅ Move successful, syncing to server');
      await mpSync.pushToServer();
      renderUnits();
      updateScoreboard();
      clearSelection();

      setTimeout(() => {
        const scorer = checkForAutoGoal();
        if (scorer) {
          handleGoal();
          return;
        }
        if (checkForBattles()) {
          mpSync.pushToServer();
          renderPendingBattlePanel();
        }
      }, 100);
    } else if (result.result === 'illegal') {
      console.log('⚠️ Illegal move:', result.reason);
      alert(result.reason || 'Cannot move there');
    }
  });

  function showBattleWinner(winnerId, reason) {
    const winnerUnit = units.get(winnerId);
    if (!winnerUnit) return;

    const container = document.createElement('div');
    container.className = 'fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[9998] pointer-events-none';

    const text = document.createElement('p');
    text.className = 'text-white text-4xl font-bold text-center';
    text.style.textShadow = '3px 3px 6px rgba(0,0,0,0.7)';
    text.textContent = `${winnerUnit.name} (${winnerUnit.ownerId}) wins!`;
    container.appendChild(text);
    document.body.appendChild(container);

    setTimeout(() => {
      if (document.body.contains(container)) document.body.removeChild(container);
    }, 2000);
  }

  document.getElementById('createBtn')?.addEventListener('click', async () => {
    if (isCreating) {
      console.log("Create already in progress...");
      return;
    }

    isCreating = true;
    const createBtn = document.getElementById('createBtn');
    const originalText = createBtn.textContent;
    createBtn.disabled = true;
    createBtn.textContent = "Creating...";

    try {
      const code = await createRoom();
      document.getElementById('roomCode').textContent = code;
      document.getElementById('joinStatus').textContent = "Waiting for opponent...";
    } catch (err) {
      console.error(err);
      alert(err.message);
      isCreating = false;
      createBtn.disabled = false;
      createBtn.textContent = originalText;
    }
  });

  document.getElementById('joinBtn')?.addEventListener('click', async () => {
    if (isJoining) {
      console.log("Join already in progress...");
      return;
    }

    const code = document.getElementById('joinInput').value.trim().toUpperCase();
    if (!code) {
      alert("Please enter a room code");
      return;
    }

    isJoining = true;
    const joinBtn = document.getElementById('joinBtn');
    const originalText = joinBtn.textContent;
    joinBtn.disabled = true;
    joinBtn.textContent = "Joining...";

    try {
      await joinRoom(code);
      document.getElementById('joinStatus').textContent = "Joined! Starting...";
    } catch (err) {
      console.error(err);
      alert(err.message);
      isJoining = false;
      joinBtn.disabled = false;
      joinBtn.textContent = originalText;
    }
  });

  window.addEventListener('resize', () => {
    if (game) {
      renderNodes();
      renderUnits();
    }
  });

  export { renderStaminaBars };