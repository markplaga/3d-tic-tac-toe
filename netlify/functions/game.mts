import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { randomBytes } from "node:crypto";

type SymbolMark = "X" | "O";
type Player = { name: string; token: string; joined: boolean };
type GameState = {
  room: string;
  board: Array<SymbolMark | null>;
  currentPlayer: SymbolMark;
  roundStarter: SymbolMark;
  nextStarter: SymbolMark;
  gameOver: boolean;
  winner: SymbolMark | "draw" | null;
  winningLine: number[];
  score: Record<SymbolMark, number>;
  players: Record<SymbolMark, Player>;
  version: number;
  updatedAt: string;
};

const store = () => getStore({ name: "tic-tac-toe-games", consistency: "strong" });
const other = (p: SymbolMark): SymbolMark => (p === "X" ? "O" : "X");
const indexOf = (x: number, y: number, z: number) => z * 9 + y * 3 + x;

function winningLines(): number[][] {
  const lines: number[][] = [];
  const seen = new Set<string>();
  const directions: number[][] = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    if (!dx && !dy && !dz) continue;
    const first = [dx, dy, dz].find(v => v !== 0)!;
    if (first < 0) continue;
    directions.push([dx, dy, dz]);
  }
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) {
    for (const [dx, dy, dz] of directions) {
      const line: number[] = [];
      for (let step = 0; step < 3; step++) {
        const nx = x + dx * step, ny = y + dy * step, nz = z + dz * step;
        if (nx < 0 || nx > 2 || ny < 0 || ny > 2 || nz < 0 || nz > 2) { line.length = 0; break; }
        line.push(indexOf(nx, ny, nz));
      }
      if (line.length === 3) {
        const key = [...line].sort((a, b) => a - b).join("-");
        if (!seen.has(key)) { seen.add(key); lines.push(line); }
      }
    }
  }
  return lines;
}
const WINS = winningLines();

function code(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(randomBytes(6), b => alphabet[b % alphabet.length]).join("");
}
function token(): string { return randomBytes(24).toString("base64url"); }
function cleanName(value: unknown, fallback: string): string {
  const name = String(value ?? "").trim().replace(/[<>]/g, "").slice(0, 24);
  return name || fallback;
}
function publicState(game: GameState, suppliedToken?: string) {
  let symbol: SymbolMark | null = null;
  if (suppliedToken === game.players.X.token) symbol = "X";
  if (suppliedToken === game.players.O.token) symbol = "O";
  return {
    room: game.room, board: game.board, currentPlayer: game.currentPlayer,
    roundStarter: game.roundStarter, nextStarter: game.nextStarter,
    gameOver: game.gameOver, winner: game.winner, winningLine: game.winningLine,
    score: game.score,
    players: { X: { name: game.players.X.name, joined: true }, O: { name: game.players.O.name, joined: game.players.O.joined } },
    version: game.version, updatedAt: game.updatedAt, yourSymbol: symbol
  };
}
function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
async function load(room: string): Promise<GameState | null> {
  return await store().get(`room/${room}`, { type: "json" }) as GameState | null;
}
async function save(game: GameState) {
  game.version += 1;
  game.updatedAt = new Date().toISOString();
  await store().setJSON(`room/${game.room}`, game);
}

export default async (req: Request, context: Context) => {
  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const room = (url.searchParams.get("room") || "").toUpperCase();
      const suppliedToken = url.searchParams.get("token") || undefined;
      const game = await load(room);
      return game ? json(publicState(game, suppliedToken)) : json({ error: "Room not found." }, 404);
    }
    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
    const body = await req.json() as Record<string, unknown>;
    const action = String(body.action || "");

    if (action === "create") {
      let room = code();
      while (await load(room)) room = code();
      const hostToken = token();
      const game: GameState = {
        room, board: Array(27).fill(null), currentPlayer: "X", roundStarter: "X", nextStarter: "X",
        gameOver: false, winner: null, winningLine: [], score: { X: 0, O: 0 },
        players: {
          X: { name: cleanName(body.name, "Player 1"), token: hostToken, joined: true },
          O: { name: "Waiting for player…", token: "", joined: false }
        },
        version: 0, updatedAt: new Date().toISOString()
      };
      await save(game);
      return json({ token: hostToken, symbol: "X", state: publicState(game, hostToken) }, 201);
    }

    const room = String(body.room || "").trim().toUpperCase();
    const game = await load(room);
    if (!game) return json({ error: "Room not found." }, 404);

    if (action === "join") {
      if (game.players.O.joined) return json({ error: "This room already has two players." }, 409);
      const guestToken = token();
      game.players.O = { name: cleanName(body.name, "Player 2"), token: guestToken, joined: true };
      await save(game);
      return json({ token: guestToken, symbol: "O", state: publicState(game, guestToken) });
    }

    const suppliedToken = String(body.token || "");
    const symbol: SymbolMark | null = suppliedToken === game.players.X.token ? "X" : suppliedToken === game.players.O.token ? "O" : null;
    if (!symbol) return json({ error: "You are not a player in this room." }, 403);

    if (action === "move") {
      const index = Number(body.index);
      if (!game.players.O.joined) return json({ error: "Waiting for the other player." }, 409);
      if (game.gameOver) return json({ error: "This round is over." }, 409);
      if (game.currentPlayer !== symbol) return json({ error: "It is not your turn." }, 409);
      if (!Number.isInteger(index) || index < 0 || index > 26 || game.board[index]) return json({ error: "That space is unavailable." }, 409);
      game.board[index] = symbol;
      const line = WINS.find(candidate => candidate.every(i => game.board[i] === symbol));
      if (line) {
        game.gameOver = true; game.winner = symbol; game.winningLine = line; game.score[symbol] += 1; game.nextStarter = other(symbol);
      } else if (game.board.every(Boolean)) {
        game.gameOver = true; game.winner = "draw"; game.nextStarter = other(game.roundStarter);
      } else game.currentPlayer = other(symbol);
      await save(game);
      return json(publicState(game, suppliedToken));
    }

    if (action === "newRound") {
      if (!game.gameOver && game.board.some(Boolean)) return json({ error: "Finish the current round first." }, 409);
      game.board = Array(27).fill(null); game.gameOver = false; game.winner = null; game.winningLine = [];
      game.roundStarter = game.nextStarter; game.currentPlayer = game.roundStarter;
      await save(game);
      return json(publicState(game, suppliedToken));
    }

    if (action === "resetMatch") {
      game.score = { X: 0, O: 0 }; game.nextStarter = "X"; game.roundStarter = "X"; game.currentPlayer = "X";
      game.board = Array(27).fill(null); game.gameOver = false; game.winner = null; game.winningLine = [];
      await save(game);
      return json(publicState(game, suppliedToken));
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: "The game server had a problem. Please try again." }, 500);
  }
};

export const config: Config = { path: "/api/game" };
