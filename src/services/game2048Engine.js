// Shared authoritative rules for live moves and audit replay.
export const GAME2048_ENGINE_VERSION = "durov-1024-10pct-cooldown6-v1";
const GRID_SIZE = 4;
const DUROV_CHANCE = 0.10;
const DUROV_MIN_TILE = 1024;
const DUROV_COOLDOWN_MOVES = 6;

function splitmix64(x) {
  let z = (x + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn;
  return (z ^ (z >> 31n)) & 0xffffffffffffffffn;
}

function rand01From64(u64) {
  const v = Number((u64 >> 11n) & ((1n << 53n) - 1n));
  return v / 9007199254740992;
}

function makeRng(seedStr, startIndex = 0) {
  const seed = BigInt(seedStr || "0");
  let idx = BigInt(startIndex || 0);

  return {
    next01() {
      const u = splitmix64((seed + idx) & 0xffffffffffffffffn);
      idx += 1n;
      return rand01From64(u);
    },
    getIndex() {
      return Number(idx);
    },
  };
}

function emptyGrid() {
  return Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0));
}

function cloneGrid(g) {
  return g.map((row) => row.slice());
}

function gridsEqual(a, b) {
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (a[r][c] !== b[r][c]) return false;
    }
  }
  return true;
}

function getEmptyCells(grid) {
  const cells = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (!grid[r][c]) cells.push([r, c]);
    }
  }
  return cells;
}

function spawnTile(grid, rng) {
  const empties = getEmptyCells(grid);
  if (empties.length === 0) return null;

  const pick = Math.floor(rng.next01() * empties.length);
  const [r, c] = empties[pick];

  const v = rng.next01() < 0.9 ? 2 : 4;
  grid[r][c] = v;

  return { r, c, v };
}

function slideAndMergeLine(line) {
  const filtered = line.filter((x) => x !== 0);
  const out = [];
  let score = 0;

  for (let i = 0; i < filtered.length; i++) {
    if (i + 1 < filtered.length && filtered[i] === filtered[i + 1]) {
      const merged = filtered[i] * 2;
      out.push(merged);
      score += merged;
      i += 1;
    } else {
      out.push(filtered[i]);
    }
  }

  while (out.length < GRID_SIZE) out.push(0);
  return { line: out, score };
}

function applyMove(grid, dir) {
  const g = cloneGrid(grid);
  let gained = 0;

  const readLine = (i) => {
    if (dir === "left") return [g[i][0], g[i][1], g[i][2], g[i][3]];
    if (dir === "right") return [g[i][3], g[i][2], g[i][1], g[i][0]];
    if (dir === "up") return [g[0][i], g[1][i], g[2][i], g[3][i]];
    if (dir === "down") return [g[3][i], g[2][i], g[1][i], g[0][i]];
    return null;
  };

  const writeLine = (i, line) => {
    if (dir === "left") {
      g[i][0] = line[0];
      g[i][1] = line[1];
      g[i][2] = line[2];
      g[i][3] = line[3];
      return;
    }
    if (dir === "right") {
      g[i][3] = line[0];
      g[i][2] = line[1];
      g[i][1] = line[2];
      g[i][0] = line[3];
      return;
    }
    if (dir === "up") {
      g[0][i] = line[0];
      g[1][i] = line[1];
      g[2][i] = line[2];
      g[3][i] = line[3];
      return;
    }
    if (dir === "down") {
      g[3][i] = line[0];
      g[2][i] = line[1];
      g[1][i] = line[2];
      g[0][i] = line[3];
      return;
    }
  };

  for (let i = 0; i < GRID_SIZE; i++) {
    const line = readLine(i);
    const { line: merged, score } = slideAndMergeLine(line);
    gained += score;
    writeLine(i, merged);
  }

  return { grid: g, gained, moved: !gridsEqual(grid, g) };
}

function canMove(grid) {
  if (getEmptyCells(grid).length > 0) return true;

  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const v = grid[r][c];
      if (r + 1 < GRID_SIZE && grid[r + 1][c] === v) return true;
      if (c + 1 < GRID_SIZE && grid[r][c + 1] === v) return true;
    }
  }
  return false;
}

export function normalizeState(state) {
  const grid = state?.grid;
  if (!Array.isArray(grid) || grid.length !== GRID_SIZE) return null;
  for (const row of grid) {
    if (!Array.isArray(row) || row.length !== GRID_SIZE) return null;
    for (const v of row) {
      if (typeof v !== "number") return null;
    }
  }
  return { ...state, grid };
}

export function initStateForNewRun(seedStr) {
  const grid = emptyGrid();
  const rng = makeRng(seedStr, 0);
  spawnTile(grid, rng);
  spawnTile(grid, rng);
  return {
    state: { grid, durov: { cooldown: 0 } },
    rng_index: rng.getIndex(),
  };
}

function pickNonEmptyCells(grid) {
  const cells = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (grid[r][c] !== 0) cells.push([r, c]);
    }
  }
  return cells;
}

function durovSwap(grid, rng) {
  const filled = pickNonEmptyCells(grid);
  if (filled.length < 2) return null;

  const i1 = Math.floor(rng.next01() * filled.length);
  let i2 = Math.floor(rng.next01() * (filled.length - 1));
  if (i2 >= i1) i2 += 1;

  const [r1, c1] = filled[i1];
  const [r2, c2] = filled[i2];

  const a = grid[r1][c1];
  const b = grid[r2][c2];
  grid[r1][c1] = b;
  grid[r2][c2] = a;

  return {
    type: "durov_swap",
    from: { r: r1, c: c1, v: a },
    to: { r: r2, c: c2, v: b },
  };
}

export function calculateMove(run, dir) {
  if (!["up", "down", "left", "right"].includes(dir)) throw new Error("Invalid direction");
  const st = normalizeState(run.state);
  if (!st) throw new Error("Invalid saved state");
  const rngIndex = Number(run.rng_index ?? 0);
  const moves = Number(run.moves ?? 0);
  const score = Number(run.current_score ?? 0);
  const { grid: movedGrid, gained, moved } = applyMove(st.grid, dir);
  if (!moved) return { moved: false, gained: 0, state: st, rng_index: rngIndex, moves, current_score: score, status: run.status };
  const rng = makeRng(run.seed, rngIndex);
  const afterGrid = cloneGrid(movedGrid);
  const spawn = spawnTile(afterGrid, rng);


  let durov_event = null;

  const prevDurov = st.durov && typeof st.durov === "object" ? st.durov : { cooldown: 0 };
  let durovCooldown = Number(prevDurov.cooldown ?? 0);
  if (!Number.isFinite(durovCooldown) || durovCooldown < 0) durovCooldown = 0;

  // Skip six complete successful moves after an intervention.
  if (durovCooldown > 0) {
    durovCooldown -= 1;
  } else if (afterGrid.some(row => row.some(value => value >= DUROV_MIN_TILE))) {
    if (rng.next01() < DUROV_CHANCE) {
      durov_event = durovSwap(afterGrid, rng);
      if (durov_event) durovCooldown = DUROV_COOLDOWN_MOVES;
    }
  }

  const nextScore = score + gained;
  const nextMoves = moves + 1;
  const nextRngIndex = rng.getIndex();

  const nextState = {
    ...st,
    grid: afterGrid,
    durov: { cooldown: durovCooldown },
  };

  const stillCanMove = canMove(afterGrid);
  const nextStatus = stillCanMove ? "active" : "finished";
  return { moved: true, gained, spawn, durov_event, state: nextState, rng_index: nextRngIndex, moves: nextMoves, current_score: nextScore, status: nextStatus };
}
