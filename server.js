import express from "express";
import cors from "cors";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Chess } from "chess.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
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
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

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
    {
      name: "ChessGame MCP",
      version: "2.0.0"
    },
    {
      instructions:
        "ChessGame is an interactive chess MCP App. Use show_board when the user wants to start or view a game. " +
        "Use play_move for legal chess moves and return the updated position. The UI is the visual board. " +
        "The server state returned by each tool is authoritative. Keep using the returned FEN for subsequent moves. " +
        "The human is White unless the conversation explicitly says otherwise."
    }
  );

  registerAppTool(
    server,
    "show_board",
    {
      title: "Show Chess Board",
      description: "Use this when the user wants to start a chess game or see the current chess board.",
      inputSchema: {},
      _meta: { ui: { resourceUri: RESOURCE_URI } }
    },
    async () => result(state(new Chess()))
  );

  registerAppTool(
    server,
    "get_position",
    {
      title: "Get Position",
      description: "Get the authoritative chess position, FEN, PGN, turn, check and game status.",
      inputSchema: { fen: { type: "string", description: "Optional FEN position." } },
      _meta: { ui: { resourceUri: RESOURCE_URI } }
    },
    async ({ fen }) => {
      try {
        return result(state(gameFromFen(fen)));
      } catch {
        throw new Error("Invalid FEN");
      }
    }
  );

  registerAppTool(
    server,
    "legal_moves",
    {
      title: "Legal Moves",
      description: "Return legal chess moves for the supplied FEN, optionally limited to one square.",
      inputSchema: {
        fen: { type: "string", description: "Chess FEN." },
        square: { type: "string", description: "Optional source square such as e2." }
      }
    },
    async ({ fen, square }) => {
      try {
        const game = gameFromFen(fen);
        const moves = game.moves(
          square ? { square, verbose: true } : { verbose: true }
        );
        return result({ moves });
      } catch {
        throw new Error("Invalid FEN or square");
      }
    }
  );

  registerAppTool(
    server,
    "play_move",
    {
      title: "Play Move",
      description:
        "Use this to play a legal chess move. Requires the current FEN and source/destination squares. " +
        "The tool returns the complete authoritative position after the move.",
      inputSchema: {
        fen: { type: "string", description: "Current authoritative FEN." },
        from: { type: "string", description: "Source square, e.g. e2." },
        to: { type: "string", description: "Destination square, e.g. e4." },
        promotion: { type: "string", description: "Promotion piece: q, r, b or n.", default: "q" }
      },
      _meta: { ui: { resourceUri: RESOURCE_URI } }
    },
    async ({ fen, from, to, promotion }) => {
      try {
        const game = gameFromFen(fen);
        const move = game.move({
          from,
          to,
          promotion: promotion || "q"
        });
        if (!move) throw new Error("Illegal move");
        return result({ move, ...state(game) });
      } catch (error) {
        throw new Error(error?.message || "Illegal move");
      }
    }
  );

  registerAppTool(
    server,
    "reset_game",
    {
      title: "New Game",
      description: "Reset the chess game to the standard starting position.",
      inputSchema: {},
      _meta: { ui: { resourceUri: RESOURCE_URI } }
    },
    async () => result(state(new Chess()))
  );

  registerAppResource(
    server,
    "ChessGame Board",
    RESOURCE_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      _meta: {
        ui: {
          prefersBorder: true
        }
      }
    },
    async () => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "mcp-app.html"),
        "utf8"
      );
      return {
        contents: [
          {
            uri: RESOURCE_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: html
          }
        ]
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

app.all("/mcp", async (req, res) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined
  });

  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null
      });
    }
  }
});

app.get("/api/mcp", (_req, res) => {
  res.json({
    name: "ChessGame MCP",
    version: "2.0.0",
    mcpEndpoint: "/mcp",
    appResource: RESOURCE_URI,
    tools: ["show_board", "get_position", "legal_moves", "play_move", "reset_game"]
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ChessGame MCP App listening on 0.0.0.0:${PORT}/mcp`);
});
