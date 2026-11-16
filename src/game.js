// ============================================================================
// STEP 20: Dash Afterimage Trail
// ============================================================================
// Dashing with Space now leaves fading cyan afterimage circles behind you,
// making your movement speed and dash path immediately readable.

/**
 * Starts the game on the given <canvas> element.
 * Returns a cleanup function that stops the loop when needed.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {() => void}
 */
export function startGame(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return () => {};
  }

  let width = 0;
  let height = 0;

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    width = window.innerWidth;
    height = window.innerHeight;

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  const prefersReducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --------------------------------------------------------------------------
  // PERSISTENT SAVE DATA (localStorage)
  // --------------------------------------------------------------------------
  const BEST_SCORE_KEY = 'apex_survivor_best_score';
  const BEST_TIME_KEY = 'apex_survivor_best_time';

  function loadSavedNumber(key) {
    try {
      const raw = window.localStorage.getItem(key);
      const parsed = raw ? Number(raw) : 0;
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    } catch {
      return 0;
    }
  }

  function saveRecords(newBestScore, newBestTime) {
    try {
      window.localStorage.setItem(BEST_SCORE_KEY, String(newBestScore));
      window.localStorage.setItem(BEST_TIME_KEY, String(Math.floor(newBestTime)));
    } catch {
      // Ignore storage errors if private browsing blocks localStorage.
    }
  }

  // --------------------------------------------------------------------------
  // SIMPLE PROCEDURAL SOUND EFFECTS (Web Audio API)
  // --------------------------------------------------------------------------
  /** @type {AudioContext | null} */
  let audioCtx = null;
  let isMuted = false;

  function ensureAudioReady() {
    if (isMuted) return null;
    try {
      if (!audioCtx) {
        const AudioContextClass =
          window.AudioContext ||
          /** @type {typeof AudioContext} */ (
            /** @type {unknown} */ (
              /** @type {{ webkitAudioContext?: typeof AudioContext }} */ (
                window
              ).webkitAudioContext
            )
          );
        if (!AudioContextClass) return null;
        audioCtx = new AudioContextClass();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      return audioCtx;
    } catch {
      return null;
    }
  }

  /**
   * @param {number} startFreq
   * @param {number} endFreq
   * @param {number} duration
   * @param {OscillatorType} waveType
   * @param {number} volume
   * @param {number} delay
   */
  function playTone(
    startFreq,
    endFreq,
    duration,
    waveType = 'sine',
    volume = 0.08,
    delay = 0
  ) {
    const audio = ensureAudioReady();
    if (!audio) return;

    const now = audio.currentTime + delay;
    const osc = audio.createOscillator();
    const gain = audio.createGain();

    osc.type = waveType;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(20, endFreq),
      now + duration
    );

    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(audio.destination);

    osc.start(now);
    osc.stop(now + duration);
  }

  /** @param {'shoot' | 'hit' | 'kill' | 'xp' | 'levelUp' | 'playerHit' | 'gameOver' | 'dash' | 'bossSpawn' | 'magnet' | 'heal'} type */
  function playSound(type) {
    if (isMuted) return;

    if (type === 'shoot') {
      playTone(540, 260, 0.06, 'triangle', 0.04, 0);
    } else if (type === 'hit') {
      playTone(220, 110, 0.05, 'square', 0.035, 0);
    } else if (type === 'kill') {
      playTone(190, 75, 0.11, 'sawtooth', 0.06, 0);
    } else if (type === 'xp') {
      playTone(660, 920, 0.07, 'sine', 0.05, 0);
    } else if (type === 'levelUp') {
      playTone(523, 523, 0.09, 'triangle', 0.08, 0);
      playTone(659, 659, 0.09, 'triangle', 0.08, 0.08);
      playTone(784, 988, 0.16, 'triangle', 0.09, 0.16);
    } else if (type === 'playerHit') {
      playTone(150, 55, 0.18, 'sawtooth', 0.1, 0);
    } else if (type === 'gameOver') {
      playTone(300, 180, 0.18, 'sawtooth', 0.08, 0);
      playTone(180, 85, 0.3, 'sawtooth', 0.08, 0.16);
    } else if (type === 'dash') {
      playTone(320, 680, 0.11, 'sine', 0.07, 0);
    } else if (type === 'bossSpawn') {
      playTone(140, 95, 0.22, 'sawtooth', 0.09, 0);
      playTone(110, 70, 0.3, 'sawtooth', 0.1, 0.18);
    } else if (type === 'magnet') {
      playTone(440, 880, 0.14, 'sine', 0.07, 0);
      playTone(660, 1180, 0.18, 'sine', 0.07, 0.09);
    } else if (type === 'heal') {
      playTone(523, 659, 0.1, 'sine', 0.06, 0);
      playTone(659, 880, 0.14, 'sine', 0.06, 0.08);
    }
  }

  // --------------------------------------------------------------------------
  // GAME STATE & RECORDS
  // --------------------------------------------------------------------------
  /** @type {'MENU' | 'PLAYING' | 'PAUSED' | 'LEVEL_UP' | 'GAME_OVER'} */
  let gameState = 'MENU';

  let pendingLevelUps = 0;
  let elapsedTime = 0;
  let score = 0;
  let bestScore = loadSavedNumber(BEST_SCORE_KEY);
  let bestTime = loadSavedNumber(BEST_TIME_KEY);

  let shakeTimer = 0;
  let shakeIntensity = 0;
  let hitstopTimer = 0;
  let nextBossTime = 45;
  let bossAlertTimer = 0;
  let magnetPulseTimer = 0;
  let dashTrailTimer = 0;

  /** @param {number} intensity @param {number} duration */
  function triggerShake(intensity, duration) {
    if (prefersReducedMotion) return;
    shakeIntensity = Math.max(shakeIntensity, intensity);
    shakeTimer = Math.max(shakeTimer, duration);
  }

  function updateRecords() {
    let changed = false;
    if (score > bestScore) {
      bestScore = score;
      changed = true;
    }
    if (Math.floor(elapsedTime) > bestTime) {
      bestTime = Math.floor(elapsedTime);
      changed = true;
    }
    if (changed) {
      saveRecords(bestScore, bestTime);
    }
  }

  /** @param {number} totalSeconds */
  function formatTime(totalSeconds) {
    const wholeSeconds = Math.floor(totalSeconds);
    const minutes = Math.floor(wholeSeconds / 60);
    const seconds = wholeSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  // --------------------------------------------------------------------------
  // PLAYER DATA
  // --------------------------------------------------------------------------
  const player = {
    x: width / 2,
    y: height / 2,
    radius: 18,
    speed: 260,
    color: '#38bdf8',
    outlineColor: '#e0f2fe',
    // Health
    hp: 100,
    maxHp: 100,
    invulnerableTimer: 0,
    invulnerableDuration: 0.6,
    // Auto-attack
    attackRange: 340,
    attackCooldown: 0.4,
    attackDamage: 1,
    attackTimer: 0,
    bulletCount: 1, // how many bullets fire per volley
    bulletPierce: 0, // how many extra enemies each bullet can pass through
    // Orbiting shield orbs
    orbCount: 0,
    orbAngle: 0,
    orbOrbitRadius: 56,
    orbRadius: 9,
    // Level & XP
    level: 1,
    xp: 0,
    xpToNextLevel: 30,
    pickupRadius: 95,
    // Dash stats
    lastFacingX: 1,
    lastFacingY: 0,
    dashSpeed: 760,
    dashDuration: 0.16,
    dashTimer: 0,
    dashCooldown: 1.6,
    dashCooldownTimer: 0,
    dashDirX: 1,
    dashDirY: 0,
  };

  // --------------------------------------------------------------------------
  // UPGRADES POOL
  // --------------------------------------------------------------------------
  const UPGRADES = [
    {
      id: 'multi_shot',
      title: 'Multi-Shot',
      description: '+1 extra bullet per shot',
      accent: '#fde047',
      apply: () => {
        player.bulletCount += 1;
      },
    },
    {
      id: 'piercing_shot',
      title: 'Piercing Shot',
      description: 'Bullets pass through +1 enemy',
      accent: '#fb923c',
      apply: () => {
        player.bulletPierce += 1;
      },
    },
    {
      id: 'orbit_shield',
      title: 'Orbit Shield',
      description: '+1 orbiting damage orb',
      accent: '#22d3ee',
      apply: () => {
        player.orbCount += 1;
      },
    },
    {
      id: 'rapid_fire',
      title: 'Rapid Fire',
      description: 'Shoot 20% faster',
      accent: '#facc15',
      apply: () => {
        player.attackCooldown = Math.max(0.12, player.attackCooldown * 0.8);
      },
    },
    {
      id: 'heavy_shot',
      title: 'Heavy Shot',
      description: '+1 bullet damage',
      accent: '#f97316',
      apply: () => {
        player.attackDamage += 1;
      },
    },
    {
      id: 'swift_feet',
      title: 'Swift Feet',
      description: '+35 movement speed',
      accent: '#38bdf8',
      apply: () => {
        player.speed += 35;
      },
    },
    {
      id: 'far_sight',
      title: 'Far Sight',
      description: '+55 attack range',
      accent: '#a855f7',
      apply: () => {
        player.attackRange += 55;
      },
    },
    {
      id: 'xp_magnet',
      title: 'XP Magnet',
      description: '+45 gem pickup range',
      accent: '#10b981',
      apply: () => {
        player.pickupRadius += 45;
      },
    },
    {
      id: 'vitality',
      title: 'Vitality',
      description: '+25 max HP and heal 25',
      accent: '#ef4444',
      apply: () => {
        player.maxHp += 25;
        player.hp = Math.min(player.maxHp, player.hp + 25);
      },
    },
  ];

  /** @type {typeof UPGRADES} */
  let upgradeChoices = [];

  /** @type {Array<{ x: number, y: number, width: number, height: number }>} */
  let upgradeCardRects = [];
  let hoveredUpgradeIndex = -1;

  function rollUpgradeChoices() {
    const pool = [...UPGRADES];
    for (let i = pool.length - 1; i > 0; i--) {
      const randomIndex = Math.floor(Math.random() * (i + 1));
      const temp = pool[i];
      pool[i] = pool[randomIndex];
      pool[randomIndex] = temp;
    }
    upgradeChoices = pool.slice(0, 3);
    hoveredUpgradeIndex = -1;
  }

  /** @param {number} index */
  function selectUpgrade(index) {
    if (gameState !== 'LEVEL_UP') return;
    const chosen = upgradeChoices[index];
    if (!chosen) return;

    chosen.apply();
    playSound('xp');
    pendingLevelUps = Math.max(0, pendingLevelUps - 1);

    if (pendingLevelUps > 0) {
      rollUpgradeChoices();
    } else {
      upgradeChoices = [];
      hoveredUpgradeIndex = -1;
      canvas.style.cursor = 'default';
      gameState = 'PLAYING';
    }
  }

  // --------------------------------------------------------------------------
  // ENEMIES, BULLETS, XP GEMS & PARTICLES
  // --------------------------------------------------------------------------
  let nextEnemyId = 1;

  /** @type {Array<{ id: number, x: number, y: number, size: number, speed: number, hp: number, maxHp: number, damage: number, xpValue: number, scoreValue: number, hitFlashTimer: number, orbHitCooldown: number, isBoss: boolean, color: string, outlineColor: string }>} */
  const enemies = [];

  /** @type {Array<{ x: number, y: number, vx: number, vy: number, radius: number, damage: number, pierceLeft: number, hitEnemyIds: Set<number>, color: string }>} */
  const bullets = [];

  /** @type {Array<{ x: number, y: number, radius: number, value: number, magnetized: boolean, color: string, outlineColor: string }>} */
  const xpGems = [];

  /** @type {Array<{ x: number, y: number, radius: number }>} */
  const magnetPickups = [];

  /** @type {Array<{ x: number, y: number, radius: number, healAmount: number }>} */
  const medkitPickups = [];

  /** @type {Array<{ x: number, y: number, radius: number, life: number, maxLife: number }>} */
  const dashTrail = [];

  /** @type {Array<{ x: number, y: number, vx: number, vy: number, size: number, life: number, maxLife: number, color: string }>} */
  const particles = [];

  /** @type {Array<{ x: number, y: number, vy: number, text: string, life: number, maxLife: number, color: string }>} */
  const damageTexts = [];

  function spawnParticles(x, y, color, count = 8, speed = 160) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const particleSpeed = speed * (0.4 + Math.random() * 0.8);
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * particleSpeed,
        vy: Math.sin(angle) * particleSpeed,
        size: 4 + Math.random() * 4,
        life: 0.25 + Math.random() * 0.15,
        maxLife: 0.4,
        color,
      });
    }
  }

  /** @param {number} x @param {number} y @param {number | string} amount @param {string} color */
  function spawnDamageText(x, y, amount, color = '#fde047') {
    if (damageTexts.length >= 40) {
      damageTexts.shift();
    }
    const jitterX = (Math.random() * 2 - 1) * 10;
    damageTexts.push({
      x: x + jitterX,
      y,
      vy: -42,
      text: String(amount),
      life: 0.45,
      maxLife: 0.45,
      color,
    });
  }

  let spawnTimer = 0;

  const startButton = { x: 0, y: 0, width: 210, height: 52 };
  let isHoveringStart = false;

  const restartButton = { x: 0, y: 0, width: 190, height: 48 };
  let isHoveringRestart = false;

  const resumeButton = { x: 0, y: 0, width: 190, height: 46 };
  let isHoveringResume = false;

  const menuButton = { x: 0, y: 0, width: 190, height: 42 };
  let isHoveringMenu = false;

  const muteButton = { x: 0, y: 0, width: 112, height: 28 };
  let isHoveringMute = false;

  function resetGame() {
    ensureAudioReady();

    player.x = width / 2;
    player.y = height / 2;
    player.speed = 260;
    player.hp = 100;
    player.maxHp = 100;
    player.invulnerableTimer = 0;
    player.attackRange = 340;
    player.attackCooldown = 0.4;
    player.attackDamage = 1;
    player.attackTimer = 0;
    player.bulletCount = 1;
    player.bulletPierce = 0;
    player.orbCount = 0;
    player.orbAngle = 0;
    player.level = 1;
    player.xp = 0;
    player.xpToNextLevel = 30;
    player.pickupRadius = 95;
    player.lastFacingX = 1;
    player.lastFacingY = 0;
    player.dashTimer = 0;
    player.dashCooldownTimer = 0;
    player.dashDirX = 1;
    player.dashDirY = 0;

    nextEnemyId = 1;
    enemies.length = 0;
    bullets.length = 0;
    xpGems.length = 0;
    magnetPickups.length = 0;
    medkitPickups.length = 0;
    dashTrail.length = 0;
    particles.length = 0;
    damageTexts.length = 0;
    spawnTimer = 0;
    elapsedTime = 0;
    score = 0;
    pendingLevelUps = 0;
    upgradeChoices = [];
    upgradeCardRects = [];
    hoveredUpgradeIndex = -1;
    shakeTimer = 0;
    shakeIntensity = 0;
    hitstopTimer = 0;
    nextBossTime = 45;
    bossAlertTimer = 0;
    magnetPulseTimer = 0;
    dashTrailTimer = 0;

    isHoveringStart = false;
    isHoveringRestart = false;
    isHoveringResume = false;
    isHoveringMenu = false;
    canvas.style.cursor = 'default';
    gameState = 'PLAYING';
  }

  function returnToMainMenu() {
    updateRecords();
    keysHeld.clear();
    isHoveringResume = false;
    isHoveringMenu = false;
    isHoveringRestart = false;
    canvas.style.cursor = 'default';
    gameState = 'MENU';
  }

  function togglePause() {
    if (gameState === 'PLAYING') {
      keysHeld.clear();
      gameState = 'PAUSED';
    } else if (gameState === 'PAUSED') {
      isHoveringResume = false;
      isHoveringMenu = false;
      canvas.style.cursor = 'default';
      gameState = 'PLAYING';
    }
  }

  function getCurrentSpawnInterval() {
    return Math.max(0.25, 1.2 - elapsedTime * 0.015);
  }

  function spawnEnemy() {
    const baseSpeed = Math.min(220, 135 + elapsedTime * 1.1);
    const bonusHp = Math.floor(elapsedTime / 25);

    const roll = Math.random();
    let size = 28;
    let speed = baseSpeed;
    let hp = 2 + bonusHp;
    let damage = 20;
    let xpValue = 10;
    let scoreValue = 10;
    let color = '#f43f5e';
    let outlineColor = '#ffe4e6';

    if (elapsedTime >= 35 && roll < 0.22) {
      size = 20;
      speed = baseSpeed * 1.35;
      hp = 1 + bonusHp;
      damage = 15;
      xpValue = 15;
      scoreValue = 20;
      color = '#e879f9';
      outlineColor = '#fae8ff';
    } else if (elapsedTime >= 18 && roll < 0.42) {
      size = 38;
      speed = baseSpeed * 0.82;
      hp = 5 + bonusHp * 2;
      damage = 30;
      xpValue = 25;
      scoreValue = 30;
      color = '#f97316';
      outlineColor = '#ffedd5';
    }

    const margin = size;
    const side = Math.floor(Math.random() * 4);

    let x = 0;
    let y = 0;

    if (side === 0) {
      x = Math.random() * width;
      y = -margin;
    } else if (side === 1) {
      x = width + margin;
      y = Math.random() * height;
    } else if (side === 2) {
      x = Math.random() * width;
      y = height + margin;
    } else {
      x = -margin;
      y = Math.random() * height;
    }

    enemies.push({
      id: nextEnemyId++,
      x,
      y,
      size,
      speed,
      hp,
      maxHp: hp,
      damage,
      xpValue,
      scoreValue,
      hitFlashTimer: 0,
      orbHitCooldown: 0,
      isBoss: false,
      color,
      outlineColor,
    });
  }

  /** @param {number} bossWave */
  function spawnBoss(bossWave) {
    const size = 62;
    const margin = size;
    const side = Math.floor(Math.random() * 4);

    let x = 0;
    let y = 0;

    if (side === 0) {
      x = Math.random() * width;
      y = -margin;
    } else if (side === 1) {
      x = width + margin;
      y = Math.random() * height;
    } else if (side === 2) {
      x = Math.random() * width;
      y = height + margin;
    } else {
      x = -margin;
      y = Math.random() * height;
    }

    const baseSpeed = Math.min(220, 135 + elapsedTime * 1.1);
    const bossHp = 22 + (bossWave - 1) * 14;

    enemies.push({
      id: nextEnemyId++,
      x,
      y,
      size,
      speed: baseSpeed * 0.72,
      hp: bossHp,
      maxHp: bossHp,
      damage: 35,
      xpValue: 20,
      scoreValue: 150,
      hitFlashTimer: 0,
      orbHitCooldown: 0,
      isBoss: true,
      color: '#dc2626',
      outlineColor: '#fbbf24',
    });

    bossAlertTimer = 2.4;
    triggerShake(7, 0.25);
    playSound('bossSpawn');
  }

  function spawnXpGem(x, y, value = 10) {
    xpGems.push({
      x,
      y,
      radius: value >= 20 ? 9 : 7,
      value,
      magnetized: false,
      color: value >= 20 ? '#34d399' : '#10b981',
      outlineColor: '#a7f3d0',
    });
  }

  function spawnMagnetPickup(x, y) {
    if (magnetPickups.length >= 5) return;
    magnetPickups.push({
      x,
      y,
      radius: 10,
    });
  }

  function spawnMedkitPickup(x, y) {
    if (medkitPickups.length >= 5) return;
    medkitPickups.push({
      x,
      y,
      radius: 11,
      healAmount: 25,
    });
  }

  function gainXp(amount) {
    player.xp += amount;

    while (player.xp >= player.xpToNextLevel) {
      player.xp -= player.xpToNextLevel;
      player.level += 1;
      player.xpToNextLevel = Math.round(player.xpToNextLevel * 1.4);
      pendingLevelUps += 1;
    }

    if (pendingLevelUps > 0 && gameState === 'PLAYING') {
      keysHeld.clear();
      playSound('levelUp');
      rollUpgradeChoices();
      gameState = 'LEVEL_UP';
    } else {
      playSound('xp');
    }
  }

  function findNearestEnemy(maxRange) {
    let nearest = null;
    let bestDistance = maxRange;

    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      const distance = Math.hypot(enemy.x - player.x, enemy.y - player.y);
      if (distance <= bestDistance) {
        bestDistance = distance;
        nearest = enemy;
      }
    }

    return nearest;
  }

  // Fires `player.bulletCount` bullets fanned evenly around the target direction.
  /** @param {{ x: number, y: number }} target */
  function fireBulletAt(target) {
    const dx = target.x - player.x;
    const dy = target.y - player.y;
    if (dx === 0 && dy === 0) return;

    const baseAngle = Math.atan2(dy, dx);
    const spreadStep = 0.16; // angle gap between extra bullets (in radians)
    const bulletSpeed = 540;

    for (let i = 0; i < player.bulletCount; i++) {
      // Center the fan around `baseAngle` (e.g. 3 bullets = -1, 0, +1 steps).
      const offsetIndex = i - (player.bulletCount - 1) / 2;
      const angle = baseAngle + offsetIndex * spreadStep;

      bullets.push({
        x: player.x,
        y: player.y,
        vx: Math.cos(angle) * bulletSpeed,
        vy: Math.sin(angle) * bulletSpeed,
        radius: 6,
        damage: player.attackDamage,
        pierceLeft: player.bulletPierce,
        hitEnemyIds: new Set(),
        color: '#facc15',
      });
    }

    playSound('shoot');
  }

  // Shared helper so both bullets and orbiting shields damage enemies identically.
  /** @param {number} enemyIndex @param {number} damage @param {number} hitX @param {number} hitY @param {string} textColor */
  function damageEnemyAt(
    enemyIndex,
    damage,
    hitX,
    hitY,
    textColor = '#fde047'
  ) {
    const enemy = enemies[enemyIndex];
    if (!enemy) return;

    enemy.hp -= damage;
    enemy.hitFlashTimer = 0.08;
    spawnDamageText(enemy.x, enemy.y - enemy.size / 2 - 4, damage, textColor);

    if (enemy.hp <= 0) {
      score += enemy.scoreValue;
      if (enemy.isBoss) {
        // Bosses burst into multiple high-value XP gems!
        for (let g = 0; g < 4; g++) {
          const offsetX = (Math.random() * 2 - 1) * 22;
          const offsetY = (Math.random() * 2 - 1) * 22;
          spawnXpGem(enemy.x + offsetX, enemy.y + offsetY, enemy.xpValue);
        }
        spawnParticles(enemy.x, enemy.y, '#fbbf24', 22, 240);
        spawnMagnetPickup(enemy.x - 18, enemy.y);
        spawnMedkitPickup(enemy.x + 18, enemy.y);
        triggerShake(10, 0.26);
      } else {
        spawnXpGem(enemy.x, enemy.y, enemy.xpValue);
        const dropRoll = Math.random();
        if (dropRoll < 0.05) {
          spawnMagnetPickup(enemy.x, enemy.y);
        } else if (dropRoll < 0.09) {
          spawnMedkitPickup(enemy.x, enemy.y);
        }
        spawnParticles(enemy.x, enemy.y, enemy.color, 10, 190);
        triggerShake(enemy.size >= 36 ? 5 : 2.5, 0.1);
      }
      playSound('kill');
      enemies.splice(enemyIndex, 1);
    } else {
      spawnParticles(hitX, hitY, '#facc15', 4, 110);
      playSound('hit');
    }
  }

  function getMoveInput() {
    let moveX = 0;
    let moveY = 0;

    if (keysHeld.has('a') || keysHeld.has('arrowleft')) moveX -= 1;
    if (keysHeld.has('d') || keysHeld.has('arrowright')) moveX += 1;
    if (keysHeld.has('w') || keysHeld.has('arrowup')) moveY -= 1;
    if (keysHeld.has('s') || keysHeld.has('arrowdown')) moveY += 1;

    if (moveX !== 0 || moveY !== 0) {
      const length = Math.hypot(moveX, moveY);
      moveX /= length;
      moveY /= length;
    }

    return { moveX, moveY };
  }

  function tryDash() {
    if (gameState !== 'PLAYING') return;
    if (player.dashCooldownTimer > 0 || player.dashTimer > 0) return;

    const { moveX, moveY } = getMoveInput();
    if (moveX !== 0 || moveY !== 0) {
      player.dashDirX = moveX;
      player.dashDirY = moveY;
    } else {
      player.dashDirX = player.lastFacingX;
      player.dashDirY = player.lastFacingY;
    }

    player.dashTimer = player.dashDuration;
    player.dashCooldownTimer = player.dashCooldown;
    player.invulnerableTimer = Math.max(
      player.invulnerableTimer,
      player.dashDuration
    );

    dashTrail.push({
      x: player.x,
      y: player.y,
      radius: player.radius,
      life: 0.22,
      maxLife: 0.22,
    });
    dashTrailTimer = 0.025;

    spawnParticles(player.x, player.y, '#7dd3fc', 10, 180);
    playSound('dash');
  }

  // --------------------------------------------------------------------------
  // KEYBOARD & MOUSE INPUT
  // --------------------------------------------------------------------------
  /** @type {Set<string>} */
  const keysHeld = new Set();

  function toggleMute() {
    isMuted = !isMuted;
    if (!isMuted) {
      ensureAudioReady();
      playSound('xp');
    }
  }

  /** @param {KeyboardEvent} event */
  function handleKeyDown(event) {
    const key = event.key.toLowerCase();

    if (
      key === 'arrowup' ||
      key === 'arrowdown' ||
      key === 'arrowleft' ||
      key === 'arrowright' ||
      key === ' '
    ) {
      event.preventDefault();
    }

    if (key === 'm') {
      toggleMute();
      return;
    }

    if (key === 'escape' || key === 'p') {
      if (gameState === 'PLAYING' || gameState === 'PAUSED') {
        togglePause();
      }
      return;
    }

    if (gameState === 'MENU') {
      if (key === 'enter' || key === ' ') {
        resetGame();
      }
      return;
    }

    if (gameState === 'PAUSED') {
      if (key === 'enter') {
        togglePause();
      }
      return;
    }

    if (gameState === 'LEVEL_UP') {
      if (key === '1') selectUpgrade(0);
      if (key === '2') selectUpgrade(1);
      if (key === '3') selectUpgrade(2);
      return;
    }

    if (
      gameState === 'GAME_OVER' &&
      (key === 'enter' || key === ' ' || key === 'r')
    ) {
      resetGame();
      return;
    }

    if (key === ' ' && !event.repeat) {
      tryDash();
      return;
    }

    keysHeld.add(key);
  }

  /** @param {KeyboardEvent} event */
  function handleKeyUp(event) {
    keysHeld.delete(event.key.toLowerCase());
  }

  function handleWindowBlur() {
    keysHeld.clear();
  }

  function isPointInRect(x, y, rect) {
    return (
      x >= rect.x &&
      x <= rect.x + rect.width &&
      y >= rect.y &&
      y <= rect.y + rect.height
    );
  }

  /** @param {MouseEvent} event */
  function handleMouseMove(event) {
    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    isHoveringMute =
      gameState !== 'MENU' && isPointInRect(mouseX, mouseY, muteButton);

    if (gameState === 'MENU') {
      isHoveringStart = isPointInRect(mouseX, mouseY, startButton);
      canvas.style.cursor = isHoveringStart ? 'pointer' : 'default';
      return;
    }

    if (gameState === 'PAUSED') {
      isHoveringResume = isPointInRect(mouseX, mouseY, resumeButton);
      isHoveringMenu = isPointInRect(mouseX, mouseY, menuButton);
      canvas.style.cursor =
        isHoveringResume || isHoveringMenu || isHoveringMute
          ? 'pointer'
          : 'default';
      return;
    }

    if (gameState === 'LEVEL_UP') {
      hoveredUpgradeIndex = -1;
      for (let i = 0; i < upgradeCardRects.length; i++) {
        if (isPointInRect(mouseX, mouseY, upgradeCardRects[i])) {
          hoveredUpgradeIndex = i;
          break;
        }
      }
      canvas.style.cursor =
        hoveredUpgradeIndex >= 0 || isHoveringMute ? 'pointer' : 'default';
      return;
    }

    if (gameState === 'GAME_OVER') {
      isHoveringRestart = isPointInRect(mouseX, mouseY, restartButton);
      isHoveringMenu = isPointInRect(mouseX, mouseY, menuButton);
      canvas.style.cursor =
        isHoveringRestart || isHoveringMenu || isHoveringMute
          ? 'pointer'
          : 'default';
      return;
    }

    isHoveringStart = false;
    isHoveringRestart = false;
    isHoveringResume = false;
    isHoveringMenu = false;
    hoveredUpgradeIndex = -1;
    canvas.style.cursor = isHoveringMute ? 'pointer' : 'default';
  }

  /** @param {MouseEvent} event */
  function handleMouseClick(event) {
    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    if (gameState !== 'MENU' && isPointInRect(mouseX, mouseY, muteButton)) {
      toggleMute();
      return;
    }

    if (gameState === 'MENU') {
      if (isPointInRect(mouseX, mouseY, startButton)) {
        resetGame();
      }
      return;
    }

    if (gameState === 'PAUSED') {
      if (isPointInRect(mouseX, mouseY, resumeButton)) {
        togglePause();
      } else if (isPointInRect(mouseX, mouseY, menuButton)) {
        returnToMainMenu();
      }
      return;
    }

    if (gameState === 'LEVEL_UP') {
      for (let i = 0; i < upgradeCardRects.length; i++) {
        if (isPointInRect(mouseX, mouseY, upgradeCardRects[i])) {
          selectUpgrade(i);
          return;
        }
      }
      return;
    }

    if (gameState === 'GAME_OVER') {
      if (isPointInRect(mouseX, mouseY, restartButton)) {
        resetGame();
      } else if (isPointInRect(mouseX, mouseY, menuButton)) {
        returnToMainMenu();
      }
    }
  }

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('blur', handleWindowBlur);
  canvas.addEventListener('mousemove', handleMouseMove);
  canvas.addEventListener('click', handleMouseClick);

  // --------------------------------------------------------------------------
  // UPDATE
  // --------------------------------------------------------------------------
  /** @param {number} dt */
  function update(dt) {
    if (shakeTimer > 0) {
      shakeTimer = Math.max(0, shakeTimer - dt);
      if (shakeTimer === 0) {
        shakeIntensity = 0;
      }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
      p.life -= dt;

      if (p.life <= 0) {
        particles.splice(i, 1);
      }
    }

    for (let i = damageTexts.length - 1; i >= 0; i--) {
      const item = damageTexts[i];
      item.y += item.vy * dt;
      item.life -= dt;

      if (item.life <= 0) {
        damageTexts.splice(i, 1);
      }
    }

    for (let i = dashTrail.length - 1; i >= 0; i--) {
      const ghost = dashTrail[i];
      ghost.life -= dt;
      if (ghost.life <= 0) {
        dashTrail.splice(i, 1);
      }
    }

    if (gameState !== 'PLAYING') {
      return;
    }

    if (hitstopTimer > 0) {
      hitstopTimer = Math.max(0, hitstopTimer - dt);
      return;
    }

    elapsedTime += dt;

    if (player.invulnerableTimer > 0) {
      player.invulnerableTimer = Math.max(0, player.invulnerableTimer - dt);
    }

    if (player.dashCooldownTimer > 0) {
      player.dashCooldownTimer = Math.max(0, player.dashCooldownTimer - dt);
    }

    // --- 1. Move the player ---
    if (player.dashTimer > 0) {
      player.dashTimer = Math.max(0, player.dashTimer - dt);
      player.x += player.dashDirX * player.dashSpeed * dt;
      player.y += player.dashDirY * player.dashSpeed * dt;

      dashTrailTimer -= dt;
      if (dashTrailTimer <= 0) {
        dashTrailTimer = 0.025;
        dashTrail.push({
          x: player.x,
          y: player.y,
          radius: player.radius,
          life: 0.22,
          maxLife: 0.22,
        });
      }
    } else {
      const { moveX, moveY } = getMoveInput();
      if (moveX !== 0 || moveY !== 0) {
        player.lastFacingX = moveX;
        player.lastFacingY = moveY;
      }
      player.x += moveX * player.speed * dt;
      player.y += moveY * player.speed * dt;
    }

    const minX = player.radius;
    const maxX = Math.max(player.radius, width - player.radius);
    const minY = player.radius;
    const maxY = Math.max(player.radius, height - player.radius);

    if (player.x < minX) player.x = minX;
    if (player.x > maxX) player.x = maxX;
    if (player.y < minY) player.y = minY;
    if (player.y > maxY) player.y = maxY;

    // Spin orbiting shield orbs smoothly around the player.
    if (player.orbCount > 0) {
      player.orbAngle += 3.2 * dt;
    }

    if (bossAlertTimer > 0) {
      bossAlertTimer = Math.max(0, bossAlertTimer - dt);
    }

    if (magnetPulseTimer > 0) {
      magnetPulseTimer = Math.max(0, magnetPulseTimer - dt);
    }

    // --- 2. Spawn enemies & periodic bosses ---
    spawnTimer += dt;
    const spawnInterval = getCurrentSpawnInterval();
    if (spawnTimer >= spawnInterval) {
      spawnTimer -= spawnInterval;
      spawnEnemy();
    }

    if (elapsedTime >= nextBossTime) {
      const bossWave = Math.floor(nextBossTime / 45);
      spawnBoss(bossWave);
      nextBossTime += 45;
    }

    // --- 3. Move enemies & check player / orbit shield collisions ---
    for (let i = enemies.length - 1; i >= 0; i--) {
      const enemy = enemies[i];

      if (enemy.hitFlashTimer > 0) {
        enemy.hitFlashTimer = Math.max(0, enemy.hitFlashTimer - dt);
      }
      if (enemy.orbHitCooldown > 0) {
        enemy.orbHitCooldown = Math.max(0, enemy.orbHitCooldown - dt);
      }

      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const distance = Math.hypot(dx, dy);

      if (distance > 1) {
        enemy.x += (dx / distance) * enemy.speed * dt;
        enemy.y += (dy / distance) * enemy.speed * dt;
      }

      // Check orbiting shield orbs against this enemy.
      if (player.orbCount > 0 && enemy.orbHitCooldown <= 0) {
        let hitByOrb = false;
        for (let k = 0; k < player.orbCount; k++) {
          const angle =
            player.orbAngle + (k * Math.PI * 2) / player.orbCount;
          const orbX = player.x + Math.cos(angle) * player.orbOrbitRadius;
          const orbY = player.y + Math.sin(angle) * player.orbOrbitRadius;
          const orbDist = Math.hypot(orbX - enemy.x, orbY - enemy.y);

          if (orbDist <= player.orbRadius + enemy.size / 2) {
            enemy.orbHitCooldown = 0.35;
            damageEnemyAt(i, 1, orbX, orbY, '#22d3ee');
            hitByOrb = true;
            break;
          }
        }
        // If the enemy died from the orb, skip player touch check below.
        if (hitByOrb && !enemies[i]) {
          continue;
        }
      }

      const touchDistance = player.radius + enemy.size / 2;
      if (distance <= touchDistance && player.invulnerableTimer <= 0) {
        player.hp = Math.max(0, player.hp - enemy.damage);
        player.invulnerableTimer = player.invulnerableDuration;

        triggerShake(9, 0.22);
        hitstopTimer = 0.04;
        spawnParticles(player.x, player.y, '#ef4444', 12, 220);

        if (player.hp <= 0) {
          updateRecords();
          playSound('gameOver');
          gameState = 'GAME_OVER';
          keysHeld.clear();
          return;
        } else {
          playSound('playerHit');
        }
      }
    }

    // --- 4. Player auto-attack ---
    player.attackTimer += dt;
    if (player.attackTimer >= player.attackCooldown) {
      const nearestEnemy = findNearestEnemy(player.attackRange);
      if (nearestEnemy) {
        fireBulletAt(nearestEnemy);
        player.attackTimer = 0;
      } else {
        player.attackTimer = player.attackCooldown;
      }
    }

    // --- 5. Move bullets & check enemy hits ---
    for (let i = bullets.length - 1; i >= 0; i--) {
      const bullet = bullets[i];
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;

      if (
        bullet.x < -30 ||
        bullet.x > width + 30 ||
        bullet.y < -30 ||
        bullet.y > height + 30
      ) {
        bullets.splice(i, 1);
        continue;
      }

      for (let j = enemies.length - 1; j >= 0; j--) {
        const enemy = enemies[j];
        if (bullet.hitEnemyIds.has(enemy.id)) {
          continue;
        }

        const hitDistance = bullet.radius + enemy.size / 2;
        const distance = Math.hypot(bullet.x - enemy.x, bullet.y - enemy.y);

        if (distance <= hitDistance) {
          bullet.hitEnemyIds.add(enemy.id);
          damageEnemyAt(j, bullet.damage, bullet.x, bullet.y, '#fde047');

          if (bullet.pierceLeft > 0) {
            bullet.pierceLeft -= 1;
          } else {
            bullets.splice(i, 1);
            break;
          }
        }
      }
    }

    // --- 6. Pull & collect Magnet Pulse pickups ---
    for (let i = magnetPickups.length - 1; i >= 0; i--) {
      const magnet = magnetPickups[i];
      const dx = player.x - magnet.x;
      const dy = player.y - magnet.y;
      const distance = Math.hypot(dx, dy);

      if (distance <= player.pickupRadius && distance > 0) {
        magnet.x += (dx / distance) * 320 * dt;
        magnet.y += (dy / distance) * 320 * dt;
      }

      if (distance <= player.radius + magnet.radius) {
        magnetPickups.splice(i, 1);
        magnetPulseTimer = 0.45;
        spawnParticles(player.x, player.y, '#38bdf8', 16, 240);
        playSound('magnet');

        for (let g = 0; g < xpGems.length; g++) {
          xpGems[g].magnetized = true;
        }
      }
    }

    // --- 7. Pull & collect Medkit pickups (only when injured) ---
    for (let i = medkitPickups.length - 1; i >= 0; i--) {
      const medkit = medkitPickups[i];
      if (player.hp >= player.maxHp) {
        continue;
      }

      const dx = player.x - medkit.x;
      const dy = player.y - medkit.y;
      const distance = Math.hypot(dx, dy);

      if (distance <= player.pickupRadius && distance > 0) {
        medkit.x += (dx / distance) * 320 * dt;
        medkit.y += (dy / distance) * 320 * dt;
      }

      if (distance <= player.radius + medkit.radius) {
        const healed = Math.min(medkit.healAmount, player.maxHp - player.hp);
        player.hp += healed;
        medkitPickups.splice(i, 1);

        spawnParticles(player.x, player.y, '#4ade80', 12, 190);
        spawnDamageText(
          player.x,
          player.y - player.radius - 10,
          `+${healed}`,
          '#4ade80'
        );
        playSound('heal');
      }
    }

    // --- 8. Pull nearby (or magnetized) XP gems toward the player & collect them ---
    for (let i = xpGems.length - 1; i >= 0; i--) {
      const gem = xpGems[i];
      const dx = player.x - gem.x;
      const dy = player.y - gem.y;
      const distance = Math.hypot(dx, dy);

      if ((gem.magnetized || distance <= player.pickupRadius) && distance > 0) {
        const pullSpeed = gem.magnetized ? 580 : 340;
        gem.x += (dx / distance) * pullSpeed * dt;
        gem.y += (dy / distance) * pullSpeed * dt;
      }

      if (distance <= player.radius + gem.radius) {
        gainXp(gem.value);
        xpGems.splice(i, 1);

        if (gameState !== 'PLAYING') {
          return;
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // DRAW
  // --------------------------------------------------------------------------
  function drawMainMenu() {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);

    ctx.beginPath();
    ctx.arc(width / 2, height / 2 - 40, 140, 0, Math.PI * 2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.14)';
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.font = '800 44px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Apex Survivor', width / 2, height / 2 - 112);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '400 16px system-ui, -apple-system, sans-serif';
    ctx.fillText(
      'Dodge the swarm, collect XP, and upgrade to survive.',
      width / 2,
      height / 2 - 64
    );

    if (bestScore > 0 || bestTime > 0) {
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '600 14px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillText(
        `Best Score ${bestScore}  ·  Best Time ${formatTime(bestTime)}`,
        width / 2,
        height / 2 - 28
      );
    }

    startButton.x = width / 2 - startButton.width / 2;
    startButton.y = height / 2 + 10;

    ctx.fillStyle = isHoveringStart ? '#0ea5e9' : '#38bdf8';
    ctx.fillRect(
      startButton.x,
      startButton.y,
      startButton.width,
      startButton.height
    );

    ctx.fillStyle = '#0f172a';
    ctx.font = '700 18px system-ui, -apple-system, sans-serif';
    ctx.fillText(
      'Start Game',
      width / 2,
      startButton.y + startButton.height / 2
    );

    ctx.fillStyle = '#64748b';
    ctx.font = '500 13px system-ui, -apple-system, sans-serif';
    ctx.fillText(
      'WASD / Arrows Move  ·  Space Dash  ·  Esc Pause  ·  1-3 Upgrade  ·  M Mute',
      width / 2,
      startButton.y + startButton.height + 34
    );
  }

  function drawHud() {
    const barX = 20;
    const barWidth = 200;

    const hpY = 20;
    const hpHeight = 20;
    const hpPercent = player.hp / player.maxHp;

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(barX, hpY, barWidth, hpHeight);

    ctx.fillStyle = hpPercent > 0.35 ? '#10b981' : '#ef4444';
    ctx.fillRect(barX, hpY, barWidth * hpPercent, hpHeight);

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#475569';
    ctx.strokeRect(barX, hpY, barWidth, hpHeight);

    ctx.fillStyle = '#f8fafc';
    ctx.font = '600 14px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      `HP ${player.hp} / ${player.maxHp}`,
      barX + barWidth + 12,
      hpY + hpHeight / 2
    );

    const xpY = 48;
    const xpHeight = 14;
    const xpPercent = Math.min(1, player.xp / player.xpToNextLevel);

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(barX, xpY, barWidth, xpHeight);

    ctx.fillStyle = '#a855f7';
    ctx.fillRect(barX, xpY, barWidth * xpPercent, xpHeight);

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#475569';
    ctx.strokeRect(barX, xpY, barWidth, xpHeight);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '600 13px system-ui, -apple-system, sans-serif';
    ctx.fillText(
      `Level ${player.level} · XP ${player.xp} / ${player.xpToNextLevel}`,
      barX + barWidth + 12,
      xpY + xpHeight / 2
    );

    const dashY = 70;
    const dashHeight = 10;
    const dashReadyRatio =
      player.dashCooldownTimer <= 0
        ? 1
        : 1 - player.dashCooldownTimer / player.dashCooldown;

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(barX, dashY, barWidth, dashHeight);

    ctx.fillStyle = dashReadyRatio >= 1 ? '#38bdf8' : '#64748b';
    ctx.fillRect(barX, dashY, barWidth * dashReadyRatio, dashHeight);

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#475569';
    ctx.strokeRect(barX, dashY, barWidth, dashHeight);

    ctx.fillStyle = dashReadyRatio >= 1 ? '#bae6fd' : '#94a3b8';
    ctx.font = '600 12px system-ui, -apple-system, sans-serif';
    ctx.fillText(
      dashReadyRatio >= 1
        ? 'Dash Ready (Space)'
        : `Dash ${player.dashCooldownTimer.toFixed(1)}s`,
      barX + barWidth + 12,
      dashY + dashHeight / 2
    );

    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 22px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(formatTime(elapsedTime), width / 2, 32);

    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 18px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`Score ${score}`, width - 20, 28);

    muteButton.x = width - 20 - muteButton.width;
    muteButton.y = 46;

    ctx.fillStyle = isHoveringMute ? '#334155' : '#1e293b';
    ctx.fillRect(
      muteButton.x,
      muteButton.y,
      muteButton.width,
      muteButton.height
    );
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = isHoveringMute ? '#64748b' : '#334155';
    ctx.strokeRect(
      muteButton.x,
      muteButton.y,
      muteButton.width,
      muteButton.height
    );

    ctx.fillStyle = isMuted ? '#94a3b8' : '#e2e8f0';
    ctx.font = '600 12px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      isMuted ? 'Sound: Off (M)' : 'Sound: On (M)',
      muteButton.x + muteButton.width / 2,
      muteButton.y + muteButton.height / 2
    );
  }

  function drawPauseMenu() {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
    ctx.fillRect(0, 0, width, height);

    const cardWidth = Math.min(360, width - 32);
    const cardHeight = 240;
    const cardX = (width - cardWidth) / 2;
    const cardY = (height - cardHeight) / 2;

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(cardX, cardY, cardWidth, cardHeight);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#334155';
    ctx.strokeRect(cardX, cardY, cardWidth, cardHeight);

    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 30px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Paused', width / 2, cardY + 50);

    resumeButton.x = width / 2 - resumeButton.width / 2;
    resumeButton.y = cardY + 94;

    ctx.fillStyle = isHoveringResume ? '#0ea5e9' : '#38bdf8';
    ctx.fillRect(
      resumeButton.x,
      resumeButton.y,
      resumeButton.width,
      resumeButton.height
    );

    ctx.fillStyle = '#0f172a';
    ctx.font = '700 16px system-ui, -apple-system, sans-serif';
    ctx.fillText(
      'Resume',
      width / 2,
      resumeButton.y + resumeButton.height / 2
    );

    menuButton.x = width / 2 - menuButton.width / 2;
    menuButton.y = cardY + 156;

    ctx.fillStyle = isHoveringMenu ? '#334155' : '#1e293b';
    ctx.fillRect(menuButton.x, menuButton.y, menuButton.width, menuButton.height);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = isHoveringMenu ? '#64748b' : '#475569';
    ctx.strokeRect(
      menuButton.x,
      menuButton.y,
      menuButton.width,
      menuButton.height
    );

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '600 15px system-ui, -apple-system, sans-serif';
    ctx.fillText('Main Menu', width / 2, menuButton.y + menuButton.height / 2);
  }

  function drawLevelUpMenu() {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#facc15';
    ctx.font = '700 30px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Level ${player.level}!`, width / 2, height / 2 - 150);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '500 16px system-ui, -apple-system, sans-serif';
    ctx.fillText(
      'Choose 1 upgrade (click a card or press 1, 2, or 3)',
      width / 2,
      height / 2 - 112
    );

    const gap = 18;
    const maxTotalWidth = Math.min(720, width - 40);
    const cardWidth = Math.floor((maxTotalWidth - gap * 2) / 3);
    const cardHeight = 165;
    const startX = (width - (cardWidth * 3 + gap * 2)) / 2;
    const cardY = height / 2 - 65;

    upgradeCardRects = [];

    for (let i = 0; i < upgradeChoices.length; i++) {
      const upgrade = upgradeChoices[i];
      const cardX = startX + i * (cardWidth + gap);
      const isHovered = hoveredUpgradeIndex === i;

      upgradeCardRects.push({
        x: cardX,
        y: cardY,
        width: cardWidth,
        height: cardHeight,
      });

      ctx.fillStyle = isHovered ? '#263348' : '#1e293b';
      ctx.fillRect(cardX, cardY, cardWidth, cardHeight);

      ctx.lineWidth = isHovered ? 3 : 2;
      ctx.strokeStyle = isHovered ? upgrade.accent : '#334155';
      ctx.strokeRect(cardX, cardY, cardWidth, cardHeight);

      const iconSize = 22;
      ctx.fillStyle = upgrade.accent;
      ctx.fillRect(
        cardX + cardWidth / 2 - iconSize / 2,
        cardY + 28,
        iconSize,
        iconSize
      );

      ctx.fillStyle = '#f8fafc';
      ctx.font = '700 18px system-ui, -apple-system, sans-serif';
      ctx.fillText(upgrade.title, cardX + cardWidth / 2, cardY + 76);

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '400 14px system-ui, -apple-system, sans-serif';
      ctx.fillText(upgrade.description, cardX + cardWidth / 2, cardY + 106);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 12px system-ui, -apple-system, sans-serif';
      ctx.fillText(`Press ${i + 1}`, cardX + cardWidth / 2, cardY + 140);
    }
  }

  function drawGameOverScreen() {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
    ctx.fillRect(0, 0, width, height);

    const cardWidth = Math.min(400, width - 32);
    const cardHeight = 310;
    const cardX = (width - cardWidth) / 2;
    const cardY = (height - cardHeight) / 2;

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(cardX, cardY, cardWidth, cardHeight);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#334155';
    ctx.strokeRect(cardX, cardY, cardWidth, cardHeight);

    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 32px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Game Over', width / 2, cardY + 48);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '600 16px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(
      `Time ${formatTime(elapsedTime)}  ·  Score ${score}`,
      width / 2,
      cardY + 98
    );

    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 14px system-ui, -apple-system, sans-serif';
    ctx.fillText(
      `Level ${player.level}  ·  Best Score ${bestScore}`,
      width / 2,
      cardY + 132
    );

    restartButton.x = width / 2 - restartButton.width / 2;
    restartButton.y = cardY + 174;

    ctx.fillStyle = isHoveringRestart ? '#0ea5e9' : '#38bdf8';
    ctx.fillRect(
      restartButton.x,
      restartButton.y,
      restartButton.width,
      restartButton.height
    );

    ctx.fillStyle = '#0f172a';
    ctx.font = '700 16px system-ui, -apple-system, sans-serif';
    ctx.fillText(
      'Restart',
      width / 2,
      restartButton.y + restartButton.height / 2
    );

    menuButton.x = width / 2 - menuButton.width / 2;
    menuButton.y = cardY + 236;

    ctx.fillStyle = isHoveringMenu ? '#334155' : '#1e293b';
    ctx.fillRect(menuButton.x, menuButton.y, menuButton.width, menuButton.height);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = isHoveringMenu ? '#64748b' : '#475569';
    ctx.strokeRect(
      menuButton.x,
      menuButton.y,
      menuButton.width,
      menuButton.height
    );

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '600 15px system-ui, -apple-system, sans-serif';
    ctx.fillText('Main Menu', width / 2, menuButton.y + menuButton.height / 2);
  }

  function drawArenaGrid() {
    const gridSize = 64;

    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.07)';

    for (let x = 0; x <= width; x += gridSize) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
    }

    for (let y = 0; y <= height; y += gridSize) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
    }

    ctx.stroke();
  }

  function draw() {
    if (gameState === 'MENU') {
      drawMainMenu();
      return;
    }

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    if (shakeTimer > 0 && shakeIntensity > 0) {
      const offsetX = (Math.random() * 2 - 1) * shakeIntensity;
      const offsetY = (Math.random() * 2 - 1) * shakeIntensity;
      ctx.translate(offsetX, offsetY);
    }

    drawArenaGrid();

    ctx.beginPath();
    ctx.arc(player.x, player.y, player.attackRange, 0, Math.PI * 2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.16)';
    ctx.stroke();

    for (let i = 0; i < xpGems.length; i++) {
      const gem = xpGems[i];
      ctx.beginPath();
      ctx.arc(gem.x, gem.y, gem.radius, 0, Math.PI * 2);
      ctx.fillStyle = gem.color;
      ctx.fill();

      ctx.lineWidth = 2;
      ctx.strokeStyle = gem.outlineColor;
      ctx.stroke();
    }

    // Draw rare Magnet Pulse pickups as bright cyan diamonds.
    for (let i = 0; i < magnetPickups.length; i++) {
      const magnet = magnetPickups[i];
      const r = magnet.radius;
      ctx.beginPath();
      ctx.moveTo(magnet.x, magnet.y - r);
      ctx.lineTo(magnet.x + r, magnet.y);
      ctx.lineTo(magnet.x, magnet.y + r);
      ctx.lineTo(magnet.x - r, magnet.y);
      ctx.closePath();
      ctx.fillStyle = '#38bdf8';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#f8fafc';
      ctx.stroke();
    }

    // Draw rare Medkit pickups as green squares with a crisp white "+" cross.
    for (let i = 0; i < medkitPickups.length; i++) {
      const medkit = medkitPickups[i];
      const half = medkit.radius;

      ctx.fillStyle = '#16a34a';
      ctx.fillRect(medkit.x - half, medkit.y - half, half * 2, half * 2);

      ctx.lineWidth = 2;
      ctx.strokeStyle = '#dcfce7';
      ctx.strokeRect(medkit.x - half, medkit.y - half, half * 2, half * 2);

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(medkit.x - 2, medkit.y - 6, 4, 12);
      ctx.fillRect(medkit.x - 6, medkit.y - 2, 12, 4);
    }

    if (magnetPulseTimer > 0) {
      const progress = 1 - magnetPulseTimer / 0.45;
      const pulseRadius = player.radius + progress * 260;
      ctx.beginPath();
      ctx.arc(player.x, player.y, pulseRadius, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = `rgba(56, 189, 248, ${1 - progress})`;
      ctx.stroke();
    }

    for (let i = 0; i < bullets.length; i++) {
      const bullet = bullets[i];
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
      ctx.fillStyle = bullet.color;
      ctx.fill();

      if (bullet.pierceLeft > 0) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#fb923c';
        ctx.stroke();
      }
    }

    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      const half = enemy.size / 2;
      const isEnemyFlashing = enemy.hitFlashTimer > 0;

      ctx.fillStyle = isEnemyFlashing ? '#ffffff' : enemy.color;
      ctx.fillRect(enemy.x - half, enemy.y - half, enemy.size, enemy.size);

      ctx.lineWidth = enemy.isBoss ? 4 : 2;
      ctx.strokeStyle = enemy.outlineColor;
      ctx.strokeRect(enemy.x - half, enemy.y - half, enemy.size, enemy.size);

      // Draw a mini health bar above bosses and any damaged enemy.
      if (enemy.isBoss || enemy.hp < enemy.maxHp) {
        const barWidth = Math.max(28, enemy.size);
        const barHeight = enemy.isBoss ? 6 : 4;
        const barX = enemy.x - barWidth / 2;
        const barY = enemy.y - half - (enemy.isBoss ? 14 : 10);
        const hpRatio = Math.max(0, enemy.hp / enemy.maxHp);

        ctx.fillStyle = '#0f172a';
        ctx.fillRect(barX - 1, barY - 1, barWidth + 2, barHeight + 2);

        ctx.fillStyle = enemy.isBoss ? '#fbbf24' : '#ef4444';
        ctx.fillRect(barX, barY, barWidth * hpRatio, barHeight);
      }
    }

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    // Draw floating damage numbers rising above hit enemies.
    ctx.font = '700 13px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < damageTexts.length; i++) {
      const item = damageTexts[i];
      ctx.globalAlpha = Math.max(0, item.life / item.maxLife);
      ctx.fillStyle = item.color;
      ctx.fillText(item.text, item.x, item.y);
    }
    ctx.globalAlpha = 1;

    // Draw orbiting shield orbs circling around the player.
    if (player.orbCount > 0) {
      for (let k = 0; k < player.orbCount; k++) {
        const angle = player.orbAngle + (k * Math.PI * 2) / player.orbCount;
        const orbX = player.x + Math.cos(angle) * player.orbOrbitRadius;
        const orbY = player.y + Math.sin(angle) * player.orbOrbitRadius;

        ctx.beginPath();
        ctx.arc(orbX, orbY, player.orbRadius, 0, Math.PI * 2);
        ctx.fillStyle = '#22d3ee';
        ctx.fill();

        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ecfeff';
        ctx.stroke();
      }
    }

    // Draw fading cyan afterimage circles behind the player's dash path.
    for (let i = 0; i < dashTrail.length; i++) {
      const ghost = dashTrail[i];
      const progress = Math.max(0, ghost.life / ghost.maxLife);
      ctx.globalAlpha = 0.45 * progress;
      ctx.beginPath();
      ctx.arc(ghost.x, ghost.y, ghost.radius * (0.75 + 0.25 * progress), 0, Math.PI * 2);
      ctx.fillStyle = '#7dd3fc';
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (player.dashTimer > 0) {
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.radius + 7, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(125, 211, 252, 0.85)';
      ctx.stroke();
    }

    const isFlashing =
      player.dashTimer <= 0 &&
      player.invulnerableTimer > 0 &&
      Math.floor(player.invulnerableTimer * 16) % 2 === 0;

    ctx.beginPath();
    ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
    ctx.fillStyle =
      player.dashTimer > 0 ? '#bae6fd' : isFlashing ? '#ffffff' : player.color;
    ctx.fill();

    ctx.lineWidth = 3;
    ctx.strokeStyle = player.outlineColor;
    ctx.stroke();

    ctx.restore();

    drawHud();

    if (bossAlertTimer > 0 && gameState === 'PLAYING') {
      const alpha = Math.min(1, bossAlertTimer / 0.6);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#fbbf24';
      ctx.font = '800 18px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('BOSS INCOMING!', width / 2, 66);
      ctx.restore();
    }

    if (gameState === 'PAUSED') {
      drawPauseMenu();
    } else if (gameState === 'LEVEL_UP') {
      drawLevelUpMenu();
    } else if (gameState === 'GAME_OVER') {
      drawGameOverScreen();
    }
  }

  // --------------------------------------------------------------------------
  // GAME LOOP
  // --------------------------------------------------------------------------
  let lastTimestamp = performance.now();
  let animationFrameId = 0;

  /** @param {number} timestamp */
  function gameLoop(timestamp) {
    const rawDt = (timestamp - lastTimestamp) / 1000;
    lastTimestamp = timestamp;
    const dt = Math.min(rawDt, 0.05);

    update(dt);
    draw();

    animationFrameId = window.requestAnimationFrame(gameLoop);
  }

  animationFrameId = window.requestAnimationFrame(gameLoop);

  return function stopGame() {
    window.cancelAnimationFrame(animationFrameId);
    window.removeEventListener('resize', resizeCanvas);
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    window.removeEventListener('blur', handleWindowBlur);
    canvas.removeEventListener('mousemove', handleMouseMove);
    canvas.removeEventListener('click', handleMouseClick);

    if (audioCtx) {
      try {
        audioCtx.close();
      } catch {
        // Ignore cleanup errors if context is already closed.
      }
      audioCtx = null;
    }
  };
}
