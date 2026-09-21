const board=document.getElementById("board"),turn=document.getElementById("turn"),historyEl=document.getElementById("history"),status=document.getElementById("status"),fenEl=document.getElementById("fen"),mcpOut=document.getElementById("mcpOut"),sync=document.getElementById("sync");
const files="abcdefgh",types=["p","n","b","r","q","k"],icons={w:["♙","♘","♗","♖","♕","♔"],b:["♟","♞","♝","♜","♛","♚"]};
let state={fen:"8/8/8/8/8/8/8/8 w - - 0 1",pgn:"",history:[],turn:"white",check:false,checkmate:false,draw:false,gameOver:false},selected=null,lastMove=null,legal=[];

function parseFen(fen){
  const rows=fen.split(" ")[0].split("/"),out=[];
  for(const row of rows){const cells=[];for(const ch of row){if(/\d/.test(ch))for(let i=0;i<Number(ch);i++)cells.push(null);else cells.push({color:ch===ch.toUpperCase()?"w":"b",type:ch.toLowerCase()})}out.push(cells)}
  return out;
}
function pieceAt(sq){
  const b=parseFen(state.fen),x=files.indexOf(sq[0]),y=8-Number(sq[1]);
  return x>=0&&y>=0&&b[y]&&b[y][x]?b[y][x]:null;
}
function render(){
  const b=parseFen(state.fen);board.innerHTML="";
  for(let r=0;r<8;r++)for(let c=0;c<8;c++){
    const sq=files[c]+(8-r),cell=document.createElement("div");
    cell.className="sq "+((r+c)%2?"dark":"light");
    if(lastMove&&(lastMove.from===sq||lastMove.to===sq))cell.classList.add("last");
    if(selected===sq)cell.classList.add("selected");
    const lm=legal.find(m=>m.to===sq);
    if(lm){cell.classList.add("legal");if(b[r][c])cell.classList.add("capture")}
    const p=b[r][c];
    if(p){const s=document.createElement("span");s.className="piece";s.textContent=icons[p.color][types.indexOf(p.type)];cell.appendChild(s)}
    cell.onclick=()=>clickSquare(sq);board.appendChild(cell)
  }
  turn.textContent=state.turn.toUpperCase()+" TO MOVE";fenEl.textContent=state.fen;
  historyEl.innerHTML="";
  state.history.forEach((m,i)=>{if(i%2===0){const li=document.createElement("li");li.textContent=m;historyEl.appendChild(li)}else if(historyEl.lastElementChild)historyEl.lastElementChild.textContent+="   "+m});
  status.textContent=state.checkmate?"CHECKMATE":state.draw?"DRAW":state.check?"CHECK":state.gameOver?"GAME OVER":"";
}
async function call(name,args={}){
  sync.innerHTML='<span class="dot"></span> Server syncing…';
  const routes={
    get_position:"/api/chess/position",
    legal_moves:"/api/chess/legal",
    play_move:"/api/chess/move",
    reset_game:"/api/chess/reset"
  };
  try{
    const endpoint=routes[name];
    if(!endpoint)throw Error("Unknown chess action");
    const r=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(args)});
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw Error(data.error||("HTTP "+r.status));
    mcpOut.textContent=JSON.stringify(data,null,2);
    sync.innerHTML='<span class="dot"></span> Server connected';return data
  }catch(e){sync.innerHTML='<span class="dot"></span> Connection error';mcpOut.textContent=e.message;throw e}
}
async function syncPosition(){const data=await call("get_position",{fen:state.fen});state=data;render()}
async function showLegal(sq){try{const data=await call("legal_moves",{fen:state.fen,square:sq});legal=data.moves||[];render()}catch{legal=[];render()}}
async function clickSquare(sq){
  if(state.gameOver)return;
  const p=pieceAt(sq);
  if(!selected){
    if(p&&p.color===(state.turn==="white"?"w":"b")){selected=sq;await showLegal(sq)}return
  }
  const move=legal.find(m=>m.to===sq);
  if(move){
    try{const data=await call("play_move",{fen:state.fen,from:selected,to:sq,promotion:"q"});lastMove=data.move;state=data;selected=null;legal=[];render()}
    catch(e){status.textContent=e.message}
  }else if(p&&p.color===(state.turn==="white"?"w":"b")){selected=sq;await showLegal(sq)}
  else{selected=null;legal=[];render()}
}
document.getElementById("undo").onclick=()=>{status.textContent="Undo sera activé avec l'historique serveur.";};
document.getElementById("reset").onclick=async()=>{const data=await call("reset_game",{});state=data;selected=null;legal=[];lastMove=null;render()};
document.getElementById("copyFen").onclick=()=>navigator.clipboard?.writeText(state.fen);
document.getElementById("mcpPosition").onclick=()=>call("get_position",{fen:state.fen});
document.getElementById("mcpMoves").onclick=()=>call("legal_moves",{fen:state.fen});
document.getElementById("mcpStatus").onclick=()=>call("get_position",{fen:state.fen});
render();syncPosition().catch(()=>{status.textContent="Impossible de synchroniser la position MCP";render()});