import { App } from "@modelcontextprotocol/ext-apps";
import { applyDocumentTheme, applyHostStyleVariables, applyHostFonts } from "@modelcontextprotocol/ext-apps";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const files = "abcdefgh";
const types = ["p", "n", "b", "r", "q", "k"];
const icons = {
  w: ["♙", "♘", "♗", "♖", "♕", "♔"],
  b: ["♟", "♞", "♝", "♜", "♛", "♚"]
};

let state = {
  fen: START_FEN,
  pgn: "",
  history: [],
  turn: "white",
  check: false,
  checkmate: false,
  stalemate: false,
  draw: false,
  gameOver: false
};
let selected = null;
let legal = [];
let busy = false;

document.body.innerHTML = `
  <main class="shell">
    <header class="top">
      <div>
        <div class="eyebrow">CHESSGAME · MCP APP</div>
        <h1>Chess vs ChatGPT</h1>
        <p>Joue visuellement. Le serveur MCP valide chaque coup.</p>
      </div>
      <div id="turn" class="turn">WHITE</div>
    </header>
    <section class="game">
      <div class="board-card">
        <div id="board" class="board" aria-label="Chess board"></div>
        <div class="bottom">
          <span id="status">White to move</span>
          <button id="fullscreen">⛶</button>
          <button id="reset">New game</button>
        </div>
      </div>
      <aside class="side">
        <div class="card">
          <div class="label">MOVE HISTORY</div>
          <ol id="history"></ol>
        </div>
        <div class="card">
          <div class="label">POSITION</div>
          <code id="fen"></code>
        </div>
      </aside>
    </section>
  </main>
`;

const style = document.createElement("style");
style.textContent = `
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:linear-gradient(145deg,#08090b,#15181b);color:#f5f6f2;font-family:Inter,ui-sans-serif,system-ui,sans-serif}
button{font:inherit}
.shell{width:min(100%,920px);margin:auto;padding:18px}
.top{display:flex;justify-content:space-between;gap:20px;align-items:flex-end;margin-bottom:16px}
.eyebrow{font-size:11px;letter-spacing:.2em;color:#b9f36b;font-weight:800}
h1{font-size:clamp(24px,5vw,42px);line-height:1;margin:6px 0}
p{margin:0;color:#9da29f;font-size:13px}
.turn{border:1px solid #34383b;border-radius:999px;padding:9px 12px;font-size:11px;font-weight:800;letter-spacing:.12em}
.game{display:grid;grid-template-columns:minmax(280px,1fr) 220px;gap:14px}
.board-card,.card{background:#0f1114;border:1px solid #292d31;border-radius:16px;box-shadow:0 18px 55px rgba(0,0,0,.3)}
.board-card{padding:10px}
.board{display:grid;grid-template-columns:repeat(8,1fr);aspect-ratio:1;border-radius:11px;overflow:hidden}
.sq{display:grid;place-items:center;position:relative;cursor:pointer;user-select:none;font-size:clamp(25px,7vw,68px)}
.light{background:#e7e4dc}.dark{background:#5f6664}
.piece{filter:drop-shadow(0 2px 1px rgba(0,0,0,.7))}
.selected{outline:4px solid #b9f36b;outline-offset:-4px}
.legal:after{content:"";width:18%;aspect-ratio:1;border-radius:50%;background:#b9f36b}
.capture:after{content:"";position:absolute;inset:7%;border:4px solid #b9f36b;border-radius:50%}
.last{box-shadow:inset 0 0 0 999px rgba(185,243,107,.2)}
.bottom{display:flex;align-items:center;gap:8px;padding:10px 2px 2px}
#status{margin-right:auto;color:#b9f36b;font-size:13px}
button{background:#1b1e21;border:1px solid #34383b;color:#f5f6f2;border-radius:9px;padding:8px 11px;cursor:pointer}
button:hover{border-color:#b9f36b}
.side{display:flex;flex-direction:column;gap:14px}
.card{padding:14px}
.label{font-size:10px;letter-spacing:.16em;color:#8d9490;font-weight:800;margin-bottom:9px}
ol{margin:0;padding-left:22px;max-height:230px;overflow:auto;color:#d0d4d1;font-size:13px}
code{display:block;color:#aeb6b1;font-size:10px;line-height:1.5;word-break:break-all}
@media(max-width:720px){.game{grid-template-columns:1fr}.side{display:grid;grid-template-columns:1fr 1fr}.top{align-items:flex-start}.turn{margin-top:3px}}
`;
document.head.appendChild(style);

const app = new App({ name: "ChessGame UI", version: "2.0.0" });

function parseFen(fen) {
  const rows = fen.split(" ")[0].split("/");
  return rows.map(row => {
    const cells = [];
    for (const ch of row) {
      if (/\\d/.test(ch)) for (let i = 0; i < Number(ch); i++) cells.push(null);
      else cells.push({ color: ch === ch.toUpperCase() ? "w" : "b", type: ch.toLowerCase() });
    }
    return cells;
  });
}

function pieceAt(square) {
  const board = parseFen(state.fen);
  const x = files.indexOf(square[0]);
  const y = 8 - Number(square[1]);
  return board[y]?.[x] ?? null;
}

function render() {
  const board = parseFen(state.fen);
  const el = document.getElementById("board");
  el.innerHTML = "";
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const square = files[c] + (8 - r);
      const cell = document.createElement("div");
      cell.className = "sq " + ((r + c) % 2 ? "dark" : "light");
      if (selected === square) cell.classList.add("selected");
      const lm = legal.find(m => m.to === square);
      if (lm) {
        cell.classList.add("legal");
        if (board[r][c]) cell.classList.add("capture");
      }
      const p = board[r][c];
      if (p) {
        const span = document.createElement("span");
        span.className = "piece";
        span.textContent = icons[p.color][types.indexOf(p.type)];
        cell.appendChild(span);
      }
      cell.addEventListener("click", () => clickSquare(square));
      el.appendChild(cell);
    }
  }

  document.getElementById("turn").textContent = state.turn.toUpperCase();
  document.getElementById("fen").textContent = state.fen;
  const history = document.getElementById("history");
  history.innerHTML = "";
  state.history.forEach((move, i) => {
    if (i % 2 === 0) {
      const li = document.createElement("li");
      li.textContent = move;
      history.appendChild(li);
    } else if (history.lastElementChild) {
      history.lastElementChild.textContent += "  " + move;
    }
  });

  document.getElementById("status").textContent =
    state.checkmate ? "CHECKMATE" :
    state.draw ? "DRAW" :
    state.check ? "CHECK" :
    state.gameOver ? "GAME OVER" :
    (state.turn === "white" ? "WHITE TO MOVE" : "BLACK TO MOVE");
}

function applyResult(result) {
  const data = result?.structuredContent ?? parseTextResult(result);
  if (data?.fen) {
    state = data;
    selected = null;
    legal = [];
    render();
    window.openai?.setWidgetState?.({ fen: state.fen, history: state.history });
  }
}

function parseTextResult(result) {
  const text = result?.content?.find(c => c.type === "text")?.text;
  try { return JSON.parse(text); } catch { return null; }
}

app.ontoolresult = applyResult;

app.onhostcontextchanged = (ctx) => {
  if (ctx?.theme) applyDocumentTheme(ctx.theme);
  if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx?.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
};

async function getLegal(square) {
  const result = await app.callServerTool({
    name: "legal_moves",
    arguments: { fen: state.fen, square }
  });
  const data = result?.structuredContent ?? parseTextResult(result);
  legal = data?.moves ?? [];
  render();
}

async function play(from, to) {
  if (busy) return;
  busy = true;
  try {
    const result = await app.callServerTool({
      name: "play_move",
      arguments: { fen: state.fen, from, to, promotion: "q" }
    });
    applyResult(result);

    // A widget click is a real turn: ask the host/model to continue immediately.
    // This removes the need for the player to type "ok" / "joue" after every move.
    const data = result?.structuredContent ?? parseTextResult(result);
    if (data?.fen && data.turn === "black" && !data.gameOver) {
      const moveText = data.move?.san || `${from}-${to}`;
      if (window.openai?.sendFollowUpMessage) {
        await window.openai.sendFollowUpMessage({
          prompt: `The human just played ${moveText}. It is now Black's turn. Continue the chess game immediately: choose one legal Black move using play_move with the latest FEN from the tool result. Do not ask the human to confirm or say ok. After your move, let the board update.`,
          scrollToBottom: false
        });
      }
    }
  } catch (error) {
    document.getElementById("status").textContent = error?.message || "Illegal move";
  } finally {
    busy = false;
  }
}

async function clickSquare(square) {
  if (busy || state.gameOver) return;
  const piece = pieceAt(square);

  if (!selected) {
    if (piece && piece.color === (state.turn === "white" ? "w" : "b")) {
      selected = square;
      await getLegal(square);
    }
    return;
  }

  const move = legal.find(m => m.to === square);
  if (move) {
    await play(selected, square);
  } else if (piece && piece.color === (state.turn === "white" ? "w" : "b")) {
    selected = square;
    await getLegal(square);
  } else {
    selected = null;
    legal = [];
    render();
  }
}

document.getElementById("reset").addEventListener("click", async () => {
  if (busy) return;
  busy = true;
  try {
    const result = await app.callServerTool({ name: "reset_game", arguments: {} });
    applyResult(result);
  } finally {
    busy = false;
  }
});

document.getElementById("fullscreen").addEventListener("click", async () => {
  if (window.openai?.requestDisplayMode) {
    await window.openai.requestDisplayMode({ mode: "fullscreen" });
  } else if (app.requestDisplayMode) {
    await app.requestDisplayMode({ mode: "fullscreen" });
  }
});

const saved = window.openai?.widgetState;
if (saved?.fen) state = { ...state, ...saved };

render();
app.connect().catch(error => {
  document.getElementById("status").textContent = "MCP App connection error";
  console.error(error);
});
