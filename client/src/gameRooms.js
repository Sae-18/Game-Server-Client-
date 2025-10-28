import { GameManager } from './engine/game.js';
import { units, spawnUnitFromCard, resetUnits } from './engine/unit.js';
import { MultiplayerSync } from './socketManager.js';

// Add this function near the top of gameRooms.js, after the imports
function setupBattleResultListener() {
  if (!mpSync || !mpSync.socket) return;

  // Remove any existing listener
  mpSync.socket.off('battleResolved');

  // Listen for battle results from server
  mpSync.socket.on('battleResolved', (data) => {
    console.log('🔔 Received battle result:', data);

    // Show the winner to this client
    if (data.winnerId) {
      const winnerUnit = units.get(data.winnerId);
      if (winnerUnit) {
        showBattleWinner(data.winnerId, data.action);
      } else if (data.winner === 'defenders') {
        // For 2v1 when defenders win
        showBattleWinner(data.winner, data.action);
      }
    }
  });
}

// ⚠️ IMPORTANT: Change this based on your environment
const SERVER_URL = 'https://game-server-production-b429.up.railway.app';

console.log('🔌 Will connect to server:', SERVER_URL);

let game = null;
let mpSync = null;
let localPlayerRole = null;
let roomCode = null;
let isJoining = false;
let isCreating = false;
const P1_CARDS = Object.freeze(['S01', 'S35', 'S41']);
const P2_CARDS = Object.freeze(['S08', 'S31', 'S43']);
let lastBattleContext = null;


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

  const p1Cards = P1_CARDS;
  const p2Cards = P2_CARDS;

  spawnUnitFromCard('P1', p1Cards[0], 1);
  spawnUnitFromCard('P1', p1Cards[1], 2);
  spawnUnitFromCard('P1', p1Cards[2], 3);
  spawnUnitFromCard('P2', p2Cards[0], 12);
  spawnUnitFromCard('P2', p2Cards[1], 11);
  spawnUnitFromCard('P2', p2Cards[2], 10);

  renderNodes();
  renderUnits();
  updateScoreboard();

  // ✅ Setup battle resolved listener
  setupBattleResolvedListener();
  setupBattleResultListener();

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



function setupBattleResolvedListener() {
  if (!mpSync || !mpSync.socket) return;

  // Remove old listener if exists
  mpSync.socket.off('battleResolved');

  // Listen for battle resolution from server
  mpSync.socket.on('battleResolved', (data) => {
    console.log('🏆 Received battleResolved event:', data);

    const { winner, loser, rolls, action, is2v1 } = data;

    // Handle 2v1 defender victory and ball choice
    if (is2v1 && winner === 'defenders') {
      // Get defender IDs from the last battle context or from loser array
      const defenderIds = lastBattleContext?.defenderIds || loser;

      if (!defenderIds || defenderIds.length !== 2) {
        console.error('❌ Cannot find defender IDs for ball choice');
        return;
      }

      const defender1 = units.get(defenderIds[0]);
      const defender2 = units.get(defenderIds[1]);

      if (!defender1 || !defender2) {
        console.error('❌ Defenders not found');
        return;
      }

      // Check if one of the defenders is mine
      if (defender1.ownerId === localPlayerRole || defender2.ownerId === localPlayerRole) {
        console.log('⚽ I am a defender in resolved 2v1 battle');

        // Small delay to ensure sync is complete
        setTimeout(() => {
          // Double-check no one has ball yet
          const def1 = units.get(defenderIds[0]);
          const def2 = units.get(defenderIds[1]);

          if (!def1?.hasBall && !def2?.hasBall) {
            console.log('⚽ Prompting ball choice for defenders');
            promptBallRecipientChoice(defenderIds);
          } else {
            console.log('✅ Ball already assigned, no prompt needed');
          }
        }, 500);
      }
    }

    // Clear battle context after handling
    setTimeout(() => {
      lastBattleContext = null;
    }, 1000);
  });
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

    // Filter out locked units – they can't fight
    const activeUnits = nodeUnits.filter(u => !u.locked && !(u.lockTurns > 0));
    if (activeUnits.length < 2) {
      console.log(`🔒 Node ${nodeId}: All or most units locked, skipping`);
      continue;
    }

    const p1Units = activeUnits.filter(u => u.ownerId === 'P1');
    const p2Units = activeUnits.filter(u => u.ownerId === 'P2');

    if (p1Units.length > 0 && p2Units.length > 0) {
      console.log(`⚔️ Node ${nodeId}: Opponents detected!`);

      const ballCarrier = activeUnits.find(u => u.hasBall);
      if (!ballCarrier) {
        console.log(`⚠️ Opponents at node but no ball carrier`);
        continue;
      }

      // Skip if ball carrier is locked
      if (ballCarrier.locked || ballCarrier.lockTurns > 0) {
        console.log(`🚫 Ball carrier ${ballCarrier.id} locked, skipping battle`);
        continue;
      }

      // ✅ Determine attacker and defender teams
      const attackerTeamUnits = activeUnits.filter(u => u.ownerId === ballCarrier.ownerId);
      const defenderTeamUnits = activeUnits.filter(u => u.ownerId !== ballCarrier.ownerId);

      // Filter out locked defenders
      const validDefenders = defenderTeamUnits.filter(u => !u.locked && !(u.lockTurns > 0));

      if (validDefenders.length === 0) {
        console.log(`🚫 All defenders locked, skipping battle`);
        continue;
      }

      const battleInitiator = game.turnManager.currentPlayer;

      // ✅ CHECK FOR 2v1 BATTLE
      if (attackerTeamUnits.length === 1 && validDefenders.length === 2) {
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
          is2v1: true
        };

        console.log(`⚔️⚔️ 2v1 Battle setup complete`);
        return true;
      }
      // ✅ CHECK FOR 1v1 BATTLE
      else if (attackerTeamUnits.length === 1 && validDefenders.length === 1) {
        const defender = validDefenders[0];

        if (defender.locked || defender.lockTurns > 0) {
          console.log(`🚫 Defender ${defender.id} locked, skipping battle`);
          continue;
        }

        console.log(`⚔️ 1v1 BATTLE TRIGGERED at node ${nodeId}!`, {
          attacker: ballCarrier.id,
          defender: defender.id,
          initiator: battleInitiator,
          ballCarrierOwner: ballCarrier.ownerId
        });

        game.pendingBattle = {
          attackerId: ballCarrier.id,
          defenderId: defender.id,
          nodeId: nodeId,
          initiator: battleInitiator,
          is2v1: false
        };

        console.log(`⚔️ 1v1 Battle setup complete`);
        return true;
      }
      // ✅ HANDLE UNUSUAL CONFIGURATIONS
      else if (validDefenders.length > 2) {
        console.log(`⚠️ More than 2 defenders detected at node ${nodeId}:`, {
          attackers: attackerTeamUnits.length,
          defenders: validDefenders.length
        });
        // For now, only use first 2 defenders
        console.log(`⚔️⚔️ Treating as 2v1 with first 2 defenders`);

        game.pendingBattle = {
          attackerId: ballCarrier.id,
          defenderIds: validDefenders.slice(0, 2).map(d => d.id),
          nodeId: nodeId,
          initiator: battleInitiator,
          is2v1: true
        };

        return true;
      }
      else {
        console.log(`⚠️ Unusual battle configuration at node ${nodeId}:`, {
          attackers: attackerTeamUnits.length,
          defenders: validDefenders.length
        });
      }
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
    const p1Cards = P1_CARDS;
    const p2Cards = P2_CARDS;

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

  // ✅ Setup battle resolved listener
  setupBattleResultListener();
  setupBattleResolvedListener();
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
    localPendingBattle: game.pendingBattle,
    serverPendingBattle: data.gameState?.pendingBattle,
    dataHasPendingBattle: !!data.gameState?.pendingBattle
  });

  if (data.kickoffChosen && game.state === 'coinToss') {
    const container = document.getElementById('kickoff-container');
    if (container) document.body.removeChild(container);
    game.state = 'inProgress';
  }

  // ✅ STORE BATTLE CONTEXT BEFORE ANY SYNCING
  if (game.pendingBattle) {
    lastBattleContext = {
      attackerId: game.pendingBattle.attackerId,
      defenderId: game.pendingBattle.defenderId,
      defenderIds: game.pendingBattle.defenderIds,
      nodeId: game.pendingBattle.nodeId,
      is2v1: game.pendingBattle.is2v1 || false,
      initiator: game.pendingBattle.initiator
    };
    console.log('💾 Stored battle context:', lastBattleContext);
  }

  // ✅ SYNC PENDING BATTLE FROM SERVER
  if (data.gameState?.pendingBattle !== undefined) {
    if (data.gameState.pendingBattle === null && game.pendingBattle) {
      console.log('✅ Server cleared battle, clearing local battle state');

      // Clear local battle state
      game.pendingBattle = null;
      battleActions.innerHTML = '';
      pendingBattlePanel.classList.add('hidden');
      game.battleAction = null;
      game.battleTargetNode = null;

      // Note: Ball choice handling is now in battleResolved listener
    }
    else if (data.gameState.pendingBattle) {
      console.log('⚔️ Syncing pending battle from server:', data.gameState.pendingBattle);
      game.pendingBattle = data.gameState.pendingBattle;
    }
  }

  renderUnits();
  updateScoreboard();
  checkAndLockDepletedUnits();

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
    const p1Units = nodeUnits.filter(u => u.ownerId === 'P1');
    const p2Units = nodeUnits.filter(u => u.ownerId === 'P2');

    const renderRow = (unitsList, verticalOffset) => {
      const n = unitsList.length;
      const spacing = 70;
      const totalWidth = (n - 1) * spacing;
      const startX = center.x - totalWidth / 2;

      unitsList.forEach((unit, index) => {
        const x = startX + (index * spacing);
        const y = center.y + verticalOffset;
        const u = document.createElement('div');
        u.className = 'unit-token absolute cursor-pointer';
        const rotation = unit.ownerId === 'P1' ? 'rotate(-90deg)' : 'rotate(90deg)';
        u.style.cssText = `left:${Math.round(x)}px; top:${Math.round(y)}px; transform:translate(-50%,-50%) ${rotation}`;

        const img = document.createElement('img');
        img.src = `/cards/${unit.rarity}/${unit.cardId}.png`;
        img.className = `
          w-16 h-20 sm:w-20 sm:h-28 md:w-32 md:h-44 lg:w-48 lg:h-60 
          object-contain relative rounded-lg border-4
        `;
        img.style.imageRendering = 'pixelated';
        img.style.borderRadius = '10px';

        // Border colors
        if (unit.hasBall) {
          img.style.borderColor = '#00ae09ff'; // green
        } else if (unit.ownerId === 'P1') {
          img.style.borderColor = '#1c71d8'; // blue
        } else {
          img.style.borderColor = '#ed333b'; // red
        }

        // Dim locked units
        if (unit.lockTurns > 0) {
          img.style.opacity = '0.5';
          img.style.filter = 'grayscale(20%)'; // optional: subtle desaturation for clarity
        } else {
          img.style.opacity = '1';
          img.style.filter = 'none';
        }

        // Selected unit highlight
        if (unit.id === selectedUnitId) {
          img.style.boxShadow = '0 0 0 4px rgba(245,194,17,0.8)';
        }

        u.appendChild(img);

        // Ball overlay
        if (unit.hasBall) {
          const ballImg = document.createElement('img');
          ballImg.src = '/ball.png';
          ballImg.className = 'absolute right-0 bottom-0 w-6 h-6 sm:w-8 sm:h-8 md:w-10 md:h-10 lg:w-12 lg:h-12 z-[1000] pointer-events-none';
          u.appendChild(ballImg);
        }

        // Click handler
        u.dataset.unitId = unit.id;
        u.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (game.state === 'coinToss') return;
          if (!mpSync || !mpSync.isMyTurn()) return;

          if (actionMode === 'pass' && selectedUnitId) {
            const origin = getUnitInstance(selectedUnitId); // Use getUnitInstance instead
            if (unit.ownerId === origin.ownerId && unit.id !== origin.id) {
              doPass(selectedUnitId, unit.position);
            }
            return;
          }

          selectUnit(unit.id);
        });

        unitsContainer.appendChild(u);
      });
    };

    if (p1Units.length > 0) renderRow(p1Units, +40);
    if (p2Units.length > 0) renderRow(p2Units, -40);
  });

  renderStaminaBars();
}





// Add this function anywhere in gameRooms.js (after renderStaminaBars is good)
function checkAndLockDepletedUnits() {
  let anyLocked = false;

  for (const unit of units.values()) {
    // If stamina is 0 or below and unit isn't already permanently locked
    if (unit.stamina <= 0 && !unit.permanentlyLocked) {
      console.log(`🔒 PERMANENT LOCK: ${unit.name} (${unit.ownerId}) depleted stamina`);
      unit.permanentlyLocked = true;
      unit.lockTurns = 999; // Effectively infinite
      unit.stamina = 0; // Ensure it's exactly 0
      anyLocked = true;
    }
  }

  if (anyLocked) {
    renderUnits();
    renderStaminaBars();
  }

  return anyLocked;
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

  const { attackerId, is2v1 } = game.pendingBattle;
  const attacker = units.get(attackerId);

  if (!attacker) {
    console.log('❌ Attacker not found:', attackerId);
    pendingBattlePanel.classList.add('hidden');
    return;
  }

  // ✅ Handle 2v1 battles
  if (is2v1) {
    const { defenderIds } = game.pendingBattle;

    if (!defenderIds || defenderIds.length !== 2) {
      console.log('❌ Invalid 2v1 battle setup:', defenderIds);
      pendingBattlePanel.classList.add('hidden');
      return;
    }

    const defender1 = units.get(defenderIds[0]);
    const defender2 = units.get(defenderIds[1]);

    if (!defender1 || !defender2) {
      console.log('❌ Defenders not found:', defenderIds);
      pendingBattlePanel.classList.add('hidden');
      return;
    }

    console.log('⚔️⚔️ Rendering 2v1 battle panel:', {
      attacker: `${attacker.name} (${attacker.ownerId})`,
      defender1: `${defender1.name} (${defender1.ownerId})`,
      defender2: `${defender2.name} (${defender2.ownerId})`,
      localPlayer: localPlayerRole,
      isAttacker: attacker.ownerId === localPlayerRole
    });

    pendingBattlePanel.classList.remove('hidden');
    battleText.textContent = `⚔️⚔️ ${attacker.name} vs ${defender1.name} & ${defender2.name}`;
    battleActions.innerHTML = '';

    // Set up defender roll listener for 2v1 (defenders roll together)
    // Set up defender roll listener for 2v1 (defenders roll together)
    mpSync.socket.off('promptDefenderRoll');
    mpSync.socket.on('promptDefenderRoll', () => {
      const defendersOwnedByLocal = [defender1, defender2].filter(d => d.ownerId === localPlayerRole);

      if (defendersOwnedByLocal.length === 0) {
        console.log('🛡️ promptDefenderRoll (2v1) - not my defenders, ignoring');
        return;
      }

      console.log(`🎲 Defenders (${localPlayerRole}) prompted to roll (owns ${defendersOwnedByLocal.map(d => d.name).join(', ')})`);
      battleActions.innerHTML = '';

      showManualDieRoll(
        `Defenders (${defender1.name} & ${defender2.name})`,
        (defenderRoll) => {
          console.log(`🎲 Defenders rolled: ${defenderRoll}`);
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
        }
      );
    });


    if (attacker.ownerId !== localPlayerRole) {
      const waiting = document.createElement('p');
      waiting.className = 'text-yellow-400 text-sm mt-2';
      waiting.textContent = 'Waiting for attacker to choose action...';
      battleActions.appendChild(waiting);
      console.log('⏳ Not attacker in 2v1, showing waiting message');
      return;
    }

    console.log('✅ Is attacker in 2v1, showing action buttons');

    ['dribble', 'pass', 'shoot'].forEach(action => {
      const btn = document.createElement('button');
      btn.textContent = action.charAt(0).toUpperCase() + action.slice(1);
      btn.className = 'px-3 py-1 m-1 rounded bg-blue-700 text-white hover:bg-blue-600 font-bold';
      btn.addEventListener('click', () => {
        console.log(`🎯 Attacker chose: ${action} in 2v1`);
        battleActions.querySelectorAll('button').forEach(b => b.disabled = true);
        resolveBattle(action);
      });
      battleActions.appendChild(btn);
    });

    return;
  }

  // ✅ Handle 1v1 battles (existing logic)
  const { defenderId } = game.pendingBattle;
  const defender = units.get(defenderId);

  if (!defender) {
    console.log('❌ Defender not found:', defenderId);
    pendingBattlePanel.classList.add('hidden');
    return;
  }

  console.log('⚔️ Rendering 1v1 battle panel:', {
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

  const { attackerId, is2v1 } = game.pendingBattle;
  const attacker = units.get(attackerId);

  if (!attacker) return;

  // ✅ PRE-FLIGHT CHECK FOR PASS (works for both 1v1 and 2v1)
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

  // ✅ SHARED POST-BATTLE HANDLER (works for both 1v1 and 2v1)
  const handleBattleComplete = async (result, rolls, is2v1Battle = false) => {
    if (!result) {
      console.error("❌ Battle resolution failed");
      return;
    }

    console.log("🏆 Battle resolved - Winner:", result.winner);

    // ✅ SET TURN TO WINNER
    // if (result.winner === 'defenders') {
    //   const defenderIds = is2v1Battle ? game.pendingBattle.defenderIds : [game.pendingBattle.defenderId];
    //   const firstDefender = units.get(defenderIds[0]);
    //   if (firstDefender) {
    //     game.turnManager.currentPlayer = firstDefender.ownerId;
    //     console.log(`✅ Turn awarded to defending team: ${firstDefender.ownerId}`);
    //   }
    // } else {
    //   const winnerUnit = units.get(result.winner);
    //   if (winnerUnit) {
    //     game.turnManager.currentPlayer = winnerUnit.ownerId;
    //     console.log(`✅ Turn awarded to battle winner: ${winnerUnit.ownerId}`);
    //   }
    // }

    // ✅ IMPORTANT: Show winner BEFORE clearing battle state
    // This ensures both clients can see who won
    showBattleWinner(result.winner, result.action);

    // Clear local battle state
    game.pendingBattle = null;
    battleActions.innerHTML = '';
    pendingBattlePanel.classList.add('hidden');
    game.battleAction = null;
    game.battleTargetNode = null;

    // Push to server
    await mpSync.pushToServer();

    // ✅ NEW: Emit battle result with detailed info for both clients
    mpSync.socket.emit('finalizeBattle', {
      roomCode,
      result: {
        winner: result.winner,
        winnerId: result.winner, // Unit ID
        loser: result.loser || result.losers,
        rolls: rolls,
        action: action,
        is2v1: is2v1Battle,
        // ✅ Add winner display info
        winnerName: units.get(result.winner)?.name || result.winner,
        winnerOwner: units.get(result.winner)?.ownerId ||
          (result.winner === 'defenders' ?
            units.get(is2v1Battle ? game.pendingBattle?.defenderIds?.[0] : game.pendingBattle?.defenderId)?.ownerId :
            null)
      }
    });

    // Update UI
    renderUnits();
    updateScoreboard();
    clearSelection();
    renderPendingBattlePanel();

    // ✅ Check for depleted units
    checkAndLockDepletedUnits();

    // ✅ CHECK IF DEFENDERS WON 2v1 AND NEED TO CHOOSE BALL RECIPIENT
    if (is2v1Battle && result.winner === 'defenders' && result.postEffects?.chooseBallRecipient) {
      console.log('⚽ Defenders won 2v1, prompting ball recipient choice');
      const defenderIds = game.pendingBattle ?
        game.pendingBattle.defenderIds :
        result.postEffects.defenderIds;

      if (defenderIds && defenderIds.length === 2) {
        promptBallRecipientChoice(defenderIds);
        return;
      }
    }

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

  // ✅ HANDLE 2v1 BATTLES
  if (is2v1) {
    const { defenderIds } = game.pendingBattle;
    const defender1 = units.get(defenderIds[0]);
    const defender2 = units.get(defenderIds[1]);

    if (!defender1 || !defender2) return;

    console.log('⚔️⚔️ Resolving 2v1 battle:', {
      attacker: attacker.id,
      defenders: defenderIds,
      action
    });

    // Determine battle type for 2v1
    const battleType = game.determineBattleType(action, attackerId, defenderIds);

    if (battleType && battleType.type === 'clear') {
      // NO DIE ROLL NEEDED FOR 2v1
      console.log(`⚔️⚔️ Clear 2v1 victory detected. Winner: ${battleType.winner}. No rolls needed.`);

      const fakeRolls = battleType.winner === attackerId
        ? { attacker: 6, defenders: 1 }
        : { attacker: 1, defenders: 6 };

      // ✅ ONLY ATTACKER RESOLVES
      if (attacker.ownerId !== localPlayerRole) {
        console.log("⏳ Defenders waiting for attacker to resolve clear 2v1 victory...");

        const clearBattleListener = (data) => {
          if (data.gameState && !data.gameState.pendingBattle) {
            console.log("✅ Defenders received 2v1 battle completion notification");
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

      console.log("⚔️⚔️ Attacker resolving clear 2v1 victory...");
      const result = game.resolvePending2v1Battle(action, targetNodeId);

      // ✅ USE SHARED HANDLER
      await handleBattleComplete(result, fakeRolls, true);

    } else if (battleType && battleType.type === 'die_roll') {
      // DIE ROLL REQUIRED FOR 2v1
      console.log(`🎲🎲 2v1 die roll required. Starting roll sequence...`);

      battleRollState = {
        attackerRoll: null,
        defenderRoll: null,
        action: action,
        targetNodeId: targetNodeId
      };

      // Attacker rolls
      if (attacker.ownerId === localPlayerRole) {
        console.log(`🎲 Prompting ${localPlayerRole} (ATTACKER) to roll in 2v1`);
        showBattleRollUI('attacker', attacker.name, (roll) => {
          console.log(`🎲 Attacker rolled: ${roll}`);
          battleRollState.attackerRoll = roll;

          mpSync.socket.emit('battleRoll', {
            roomCode,
            role: 'attacker',
            roll: roll
          });
        });
      }

      // Defenders roll together (one combined roll)
      if (defender1.ownerId === localPlayerRole) {
        console.log(`🎲 Prompting ${localPlayerRole} (DEFENDERS) to roll in 2v1`);
        showBattleRollUI('defender', `${defender1.name} & ${defender2.name}`, (roll) => {
          console.log(`🎲 Defenders rolled: ${roll}`);
          battleRollState.defenderRoll = roll;

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

        console.log('📊 2v1 Battle rolls update:', {
          attackerReady: rolls.attackerReady,
          defenderReady: rolls.defenderReady,
          attacker: rolls.attacker,
          defender: rolls.defender
        });

        if (rolls.attackerReady && rolls.defenderReady &&
          rolls.attacker !== null && rolls.defender !== null) {

          console.log("✅ Both 2v1 rolls complete!", rolls);
          mpSync.socket.off('gameStateUpdate', battleCompletionHandler);

          // Only attacker resolves
          if (attacker.ownerId !== localPlayerRole) {
            console.log("⏳ Waiting for attacker to resolve 2v1 battle...");
            return;
          }

          console.log("⚔️⚔️ Resolving 2v1 battle...");

          // Show both rolls (renamed to "Defenders" for 2v1)
          showBothRolls(rolls.attacker, rolls.defender, async () => {
            const result = game.resolvePending2v1Battle(
              battleRollState.action,
              battleRollState.targetNodeId,
              { attacker: rolls.attacker, defenders: rolls.defender }
            );

            // ✅ USE SHARED HANDLER
            await handleBattleComplete(result, { attacker: rolls.attacker, defenders: rolls.defender }, true);
          });
        }
      };

      mpSync.socket.on('gameStateUpdate', battleCompletionHandler);
    } else {
      console.error("Could not determine 2v1 battle type.");
    }

    return; // Exit early for 2v1
  }

  // ✅ HANDLE 1v1 BATTLES (existing logic)
  const { defenderId } = game.pendingBattle;
  const defender = units.get(defenderId);

  if (!defender) return;

  console.log('⚔️ Resolving 1v1 battle:', {
    attacker: attacker.id,
    defender: defender.id,
    action
  });

  // Determine battle type for 1v1
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
    await handleBattleComplete(result, fakeRolls, false);

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
          await handleBattleComplete(result, { attacker: rolls.attacker, defender: rolls.defender }, false);
        });
      }
    };

    mpSync.socket.on('gameStateUpdate', battleCompletionHandler);

  } else {
    console.error("Could not determine battle type.");
  }
}


// ✅ ADD THIS FUNCTION HERE
function promptBallRecipientChoice(defenderIds) {
  const defender1 = units.get(defenderIds[0]);
  const defender2 = units.get(defenderIds[1]);

  if (!defender1 || !defender2) {
    console.error('❌ Defenders not found for ball choice');
    return;
  }

  if (defender1.ownerId !== localPlayerRole) {
    console.log('⏳ Not my defenders, waiting...');
    return;
  }

  // Remove existing container if any
  const existing = document.getElementById('ball-recipient-choice');
  if (existing) existing.remove();

  const container = document.createElement('div');
  container.id = 'ball-recipient-choice';
  container.className = 'fixed inset-0 bg-black bg-opacity-75 flex flex-col items-center justify-center z-[10000]';

  const text = document.createElement('p');
  text.className = 'text-white text-2xl mb-4';
  text.textContent = 'Defenders won! Choose who gets the ball:';
  container.appendChild(text);

  [defender1, defender2].forEach(defender => {
    const btn = document.createElement('button');
    btn.textContent = defender.name;
    btn.className = 'px-4 py-2 m-2 rounded bg-blue-700 text-white hover:bg-blue-600 font-bold';
    btn.addEventListener('click', async () => {
      console.log(`⚽ ${defender.name} chosen to receive ball`);

      // Give ball to chosen defender
      defender1.hasBall = false;
      defender2.hasBall = false;
      defender.hasBall = true;

      document.body.removeChild(container);
      await mpSync.pushToServer();
      renderUnits();
      updateScoreboard();

      // Check for new battles after ball is assigned
      setTimeout(() => {
        if (checkForBattles()) {
          mpSync.pushToServer();
          renderPendingBattlePanel();
        }
      }, 100);
    });
    container.appendChild(btn);
  });

  document.body.appendChild(container);
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

  // const handleClick = async (ev) => {
  //   const nodeEl = ev.target.closest('[data-node-id]');
  //   if (!nodeEl) return;
  //   const nodeId = Number(nodeEl.dataset.nodeId);
  //   const res = game.executePostBattleMove(winnerId, nodeId);
  //   if (res?.result === 'moved') {
  //     const el = document.getElementById('post-battle-container');
  //     if (el) document.body.removeChild(el);
  //     nodesContainer.removeEventListener('click', handleClick);
  //     Array.from(nodesContainer.children).forEach(n => n.style.outline = '');
  //     await mpSync.pushToServer();
  //     renderUnits();
  //     clearSelection();
  //   }
  // };
  // nodesContainer.addEventListener('click', handleClick);
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

// Add this function near handleGoal()
function checkMatchEnd() {
  if (!game) return false;

  const winningScore = 3;
  let winner = null;

  if (game.score.P1 >= winningScore) {
    winner = 'P1';
  } else if (game.score.P2 >= winningScore) {
    winner = 'P2';
  }

  if (winner) {
    console.log(`🏆 MATCH END! ${winner} wins ${game.score.P1}-${game.score.P2}`);
    game.state = 'finished';

    // Show victory screen
    showMatchEndScreen(winner);
    return true;
  }

  return false;
}

// Add this function to show the victory screen
function showMatchEndScreen(winner) {
  // Remove any existing screens
  const existing = document.getElementById('match-end-container');
  if (existing) existing.remove();

  const container = document.createElement('div');
  container.id = 'match-end-container';
  container.className = 'fixed inset-0 bg-black bg-opacity-90 flex flex-col items-center justify-center z-[10000]';

  const trophy = document.createElement('div');
  trophy.className = 'text-8xl mb-6 animate-bounce';
  trophy.textContent = '🏆';
  container.appendChild(trophy);

  const winnerText = document.createElement('h1');
  winnerText.className = 'text-white text-6xl font-bold mb-4';
  winnerText.textContent = `${winner} WINS!`;
  container.appendChild(winnerText);

  const scoreText = document.createElement('p');
  scoreText.className = 'text-white text-3xl mb-8';
  scoreText.textContent = `Final Score: ${game.score.P1} - ${game.score.P2}`;
  container.appendChild(scoreText);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.className = 'px-8 py-3 rounded bg-blue-700 text-white font-bold hover:bg-blue-600 text-2xl';
  closeBtn.addEventListener('click', () => {
    document.body.removeChild(container);
    window.location.reload();
  });
  container.appendChild(closeBtn);

  document.body.appendChild(container);
}

// ...existing code...
async function handleGoal() {
  // Only get scorer from autoGoal check, don't use current player as fallback
  const scorer = checkForAutoGoal();

  // Only increment score if it was an auto-goal
  if (scorer) {
    game.score[scorer] = (game.score[scorer] || 0) + 1;
  }

  alert(`Goal scored by ${scorer || game.turnManager.currentPlayer}!`);

  // Preserve stamina values keyed by ownerId::cardId (store arrays to handle duplicates)
  const staminaKey = (u) => `${u.ownerId}::${u.cardId}`;
  const staminaValues = new Map();
  for (const u of units.values()) {
    if (!u || !u.cardId) continue;
    const k = staminaKey(u);
    if (!staminaValues.has(k)) staminaValues.set(k, []);
    staminaValues.get(k).push(u.stamina ?? 100);
  }

  const p1Cards = P1_CARDS;
  const p2Cards = P2_CARDS;

  // Reset units (this may clear units map and cause spawnUnitFromCard to return different shapes)
  resetUnits();

  // Helper that handles spawnUnitFromCard return value being either a unit object or an id string.
  const spawnWithStamina = (ownerId, cardId, position) => {
    const ret = spawnUnitFromCard(ownerId, cardId, position);
    let unit = null;

    // spawnUnitFromCard might return the created Unit instance or the new unit id string
    if (ret && typeof ret === 'object' && ret.id) {
      unit = ret;
    } else if (typeof ret === 'string') {
      unit = units.get(ret);
    }

    // Fallback: try to locate by owner/card/position if still not found
    if (!unit) {
      unit = Array.from(units.values()).find(u => u.ownerId === ownerId && u.cardId === cardId && Number(u.position) === Number(position));
    }

    if (!unit) {
      console.error('❌ spawnWithStamina: could not find spawned unit', { ownerId, cardId, position, ret });
      return null;
    }

    const k = `${ownerId}::${cardId}`;
    const arr = staminaValues.get(k);
    if (arr && arr.length > 0) {
      const restored = arr.shift();
      if (typeof restored === 'number') unit.stamina = restored;
    }

    return unit;
  };

  spawnWithStamina('P1', p1Cards[0], 1);
  spawnWithStamina('P1', p1Cards[1], 2);
  spawnWithStamina('P1', p1Cards[2], 3);
  spawnWithStamina('P2', p2Cards[0], 12);
  spawnWithStamina('P2', p2Cards[1], 11);
  spawnWithStamina('P2', p2Cards[2], 10);

  // Set kickoff to opposite team of who scored
  const kickoffTeam = game.turnManager.currentPlayer === 'P1' ? 'P2' : 'P1';
  const firstUnit = Array.from(units.values()).find(u => u.ownerId === kickoffTeam);
  if (firstUnit) {
    for (const u of units.values()) u.hasBall = false;
    firstUnit.hasBall = true;
    game.turnManager.currentPlayer = kickoffTeam;
  }

  await mpSync.pushToServer();
  renderUnits();
  updateScoreboard();

  if (checkMatchEnd()) {
    return; // Match is over, don't continue
  }
}

// ...existing code...

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
  let winnerText = '';

  if (winnerId === 'defenders') {
    winnerText = 'Defenders win!';
  } else {
    const winnerUnit = units.get(winnerId);
    if (!winnerUnit) {
      console.warn('⚠️ Winner unit not found:', winnerId);
      return;
    }
    winnerText = `${winnerUnit.name} (${winnerUnit.ownerId}) wins!`;
  }

  const container = document.createElement('div');
  container.className = 'fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[9998] pointer-events-none';

  const text = document.createElement('p');
  text.className = 'text-white text-4xl font-bold text-center';
  text.style.textShadow = '3px 3px 6px rgba(0,0,0,0.7)';
  text.textContent = winnerText;
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