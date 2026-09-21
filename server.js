import express from "express";
import cors from "cors";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Chess } from "chess.js";
import { z } from "zod";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE
} from "@modelcontextprotocol/ext-apps/server";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 10000);
const DIST_DIR = path.join(__dirname, "dist");
const RESOURCE_URI = "ui://chessgame/board-v2.html";

function gameFromFen(fen) {
  return fen ? new Chess(fen) : new Chess();
}

function state(game) {
  return {
    fen: game.fen(),
    pgn: game.pgn(),
    turn: game.turn() === "w" ? "white" : "black",
    check: game.in_check(),
    checkmate: game.in_checkmate(),
    stalemate: game.in_stalemate(),
    draw: game.in_draw(),
    gameOver: game.game_over(),
    history: game.history()
  };
}

function result(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data
  };
}

function createServer() {
  const server = new McpServer(
    { name: "ChessGame MCP", version: "2.0.1" },
    {
      instructions:
        "ChessGame is an interactive chess MCP App. Use show_board when the user wants to start or view a game. " +
        "Use play_move for legal chess moves and return the updated position. The UI is the visual board. " +
        "The server state returned by each tool is authoritative. Keep using the returned FEN for subsequent moves. " +
        "The human is White unless the conversation explicitly says otherwise."
    }
  );

  registerAppTool(server, "show_board", {
    title: "Show Chess Board",
    description: "Show the interactive chess board.",
    inputSchema: z.object({}),
    _meta: { ui: { resourceUri: RESOURCE_URI } }
  }, async () => result(state(new Chess())));

  registerAppTool(server, "get_position", {
    title: "Get Position",
    description: "Get the authoritative chess position and game status.",
    inputSchema: z.object({
      fen: z.string().optional()
    }),
    _meta: { ui: { resourceUri: RESOURCE_URI } }
  }, async ({ fen }) => {
    try {
      return result(state(gameFromFen(fen)));
    } catch {
      throw new Error("Invalid FEN");
    }
  });

  registerAppTool(server, "legal_moves", {
    title: "Legal Moves",
    description: "Return legal chess moves for a FEN, optionally limited to one square.",
    inputSchema: z.object({
      fen: z.string(),
      square: z.string().optional()
    }),
    _meta: { ui: { resourceUri: RESOURCE_URI } }
  }, async ({ fen, square }) => {
    try {
      const game = gameFromFen(fen);
      const moves = game.moves(
        square ? { square, verbose: true } : { verbose: true }
      );
      return result({ moves });
    } catch {
      throw new Error("Invalid FEN or square");
    }
  });

  registerAppTool(server, "play_move", {
    title: "Play Move",
    description:
      "Play a legal chess move using the current authoritative FEN and source/destination squares.",
    inputSchema: z.object({
      fen: z.string(),
      from: z.string(),
      to: z.string(),
      promotion: z.enum(["q", "r", "b", "n"]).default("q")
    }),
    _meta: { ui: { resourceUri: RESOURCE_URI } }
  }, async ({ fen, from, to, promotion }) => {
    try {
      const game = gameFromFen(fen);
      const move = game.move({ from, to, promotion: promotion || "q" });
      if (!move) throw new Error("Illegal move");
      return result({ move, ...state(game) });
    } catch (error) {
      throw new Error(error?.message || "Illegal move");
    }
  });

  registerAppTool(server, "reset_game", {
    title: "New Game",
    description: "Reset the chess game to the standard starting position.",
    inputSchema: z.object({}),
    _meta: { ui: { resourceUri: RESOURCE_URI } }
  }, async () => result(state(new Chess())));

  registerAppResource(
    server,
    "ChessGame Board",
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE, _meta: { ui: { prefersBorder: true } } },
    async () => {
      const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf8");
      return {
        contents: [{
          uri: RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: html,
          _meta: { ui: { prefersBorder: true } }
        }]
      };
    }
  );

  return server;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/", async (_req, res) => {
  try {
    const html = await fs.readFile(path.join(__dirname, "index.html"), "utf8");
    res.type("html").send(html);
  } catch {
    res.status(404).send("ChessGame UI unavailable");
  }
});

app.use(express.static(__dirname));

const mcpHandler = createMcpHandler(createServer);
const mcpNodeHandler = toNodeHandler(mcpHandler);

app.all("/mcp", (req, res) => {
  void mcpNodeHandler(req, res, req.body);
});

app.post("/api/chess/position", (req, res) => {
  try {
    res.json(state(gameFromFen(req.body?.fen)));
  } catch {
    res.status(400).json({ error: "Invalid FEN" });
  }
});

app.post("/api/chess/legal", (req, res) => {
  try {
    const game = gameFromFen(req.body?.fen);
    const square = req.body?.square;
    const moves = game.moves(square ? { square, verbose: true } : { verbose: true });
    res.json({ moves });
  } catch {
    res.status(400).json({ error: "Invalid FEN or square" });
  }
});

app.post("/api/chess/move", (req, res) => {
  try {
    const { fen, from, to, promotion = "q" } = req.body || {};
    const game = gameFromFen(fen);
    const move = game.move({ from, to, promotion });
    if (!move) return res.status(400).json({ error: "Illegal move" });
    res.json({ move, ...state(game) });
  } catch (error) {
    res.status(400).json({ error: error?.message || "Illegal move" });
  }
});

app.post("/api/chess/reset", (_req, res) => {
  res.json(state(new Chess()));
});


app.get("/api/mcp", (_req, res) => {
  res.json({
    name: "ChessGame MCP",
    version: "2.0.1",
    mcpEndpoint: "/mcp",
    appResource: RESOURCE_URI,
    tools: ["show_board", "get_position", "legal_moves", "play_move", "reset_game"]
  });
});

app.all("/api/mcp", (req, res) => {\n  void mcpNodeHandler(req, res, req.body);\n});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ChessGame MCP App listening on 0.0.0.0:${PORT}/mcp`);
});
