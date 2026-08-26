const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const BOARD_SIZE = 14;
const defaultStartSlots = [
  // All eight 2-cell team-car slots sit entirely inside the 6 × 6 centre area: x/y 4–9.
  { pos:[4,4], orientation:'h' }, { pos:[7,4], orientation:'h' },
  { pos:[4,6], orientation:'v' }, { pos:[6,5], orientation:'v' },
  { pos:[8,5], orientation:'v' }, { pos:[9,7], orientation:'v' },
  { pos:[5,8], orientation:'h' }, { pos:[7,9], orientation:'h' },
];
let startSlots = defaultStartSlots.map((slot) => ({ ...slot, pos:[...slot.pos] }));
let structures = [];
let neutralStarts = [
  { pos:[1,2], orientation:'h', length:2 }, { pos:[7,2], orientation:'h', length:3 },
  { pos:[12,2], orientation:'v', length:2 }, { pos:[1,4], orientation:'v', length:2 },
  { pos:[3,2], orientation:'h', length:2 }, { pos:[10,4], orientation:'v', length:2 },
  { pos:[1,7], orientation:'h', length:3 }, { pos:[11,7], orientation:'v', length:2 },
  { pos:[1,10], orientation:'h', length:3 }, { pos:[11,10], orientation:'v', length:2 },
  { pos:[1,12], orientation:'h', length:3 }, { pos:[10,12], orientation:'h', length:3 },
  { pos:[0,0], orientation:'h', length:3 }, { pos:[4,0], orientation:'h', length:2 },
  { pos:[7,0], orientation:'h', length:3 }, { pos:[11,0], orientation:'h', length:3 },
  { pos:[0,2], orientation:'v', length:2 }, { pos:[10,2], orientation:'h', length:2 },
  { pos:[5,3], orientation:'h', length:3 }, { pos:[11,4], orientation:'h', length:3 },
  { pos:[2,6], orientation:'h', length:2 }, { pos:[11,5], orientation:'h', length:3 },
  { pos:[0,6], orientation:'v', length:2 }, { pos:[13,7], orientation:'v', length:2 },
  { pos:[0,8], orientation:'h', length:3 }, { pos:[12,9], orientation:'v', length:2 },
  { pos:[5,10], orientation:'h', length:3 }, { pos:[3,11], orientation:'h', length:3 },
  { pos:[7,11], orientation:'h', length:3 }, { pos:[13,11], orientation:'v', length:3 },
  { pos:[0,13], orientation:'h', length:3 }, { pos:[4,13], orientation:'h', length:3 },
  { pos:[7,13], orientation:'h', length:3 },
];
const state = { size:2, teams:{red:{name:'레드 팀',players:['레드 1','레드 2']},yellow:{name:'옐로 팀',players:['옐로 1','옐로 2']}}, placement:{phase:1,redSlots:[],yellowSlots:[]}, cars:[], activeTeam:'red', activePlayer:{red:0,yellow:0}, remaining:{red:[],yellow:[]}, turnsTaken:{red:[],yellow:[]}, score:{red:0,yellow:0}, lastMoved:null, selected:null, moves:0, timeouts:{red:true,yellow:true}, timer:null, turnStartedAt:0, gameOver:false };
let dragState = null;
let ignoreClickUntil = 0;
const network = { roomCode:null, isHost:false, identity:{team:'red',player:0}, lastUpdated:0, polling:null, applying:false, publishChain:Promise.resolve() };

function setRoomStatus(text){ const label=$('#room-status'); if(label)label.textContent=text; }
function isMyTurn(){ return !network.roomCode || (network.identity.team===state.activeTeam&&network.identity.player===state.activePlayer[state.activeTeam]); }
function exportGame(){ const { timer, ...safeState }=state; return { state:safeState, layout:{startSlots,structures,neutralStarts} }; }
function applyGame(payload){
  if(!payload?.state)return; clearInterval(state.timer); Object.assign(state,payload.state,{timer:null});
  startSlots=payload.layout.startSlots; structures=payload.layout.structures; neutralStarts=payload.layout.neutralStarts; network.applying=true;
  if(state.cars.length){ showHandoff(); } else { showScreen('setup-screen'); renderSetupBoard(); }
  network.applying=false;
}
function publishGame(){
  if(!network.roomCode||network.applying)return Promise.resolve();
  const snapshot=exportGame();
  network.publishChain=network.publishChain.catch(()=>{}).then(async()=>{
    const response=await fetch(`/api/rooms/${network.roomCode}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:snapshot})});
    if(response.ok){ const result=await response.json(); network.lastUpdated=result.updatedAt; }
  });
  return network.publishChain;
}
async function pullGame(){
  if(!network.roomCode)return;
  try{ const response=await fetch(`/api/rooms/${network.roomCode}`); if(!response.ok)return; const room=await response.json(); if(room.updatedAt>network.lastUpdated&&room.state){network.lastUpdated=room.updatedAt;applyGame(room.state);} }catch{}
}
async function createRoom(){
  try{const response=await fetch('/api/rooms',{method:'POST'});const data=await response.json();network.roomCode=data.code;network.isHost=true;network.lastUpdated=0;setRoomStatus(`방 코드 ${data.code}`);history.replaceState(null,'',`?room=${data.code}`);startPolling();return true;}catch{setRoomStatus('서버 연결 실패');return false;}
}
async function joinRoom(){
  const code=$('#join-room-code').value.trim().toUpperCase();if(!code)return;
  network.roomCode=code;network.isHost=false;setRoomStatus(`방 접속 ${code}`);history.replaceState(null,'',`?room=${code}`);await pullGame();startPolling();
}
function startPolling(){clearInterval(network.polling);network.polling=setInterval(pullGame,700);}

function showScreen(id){ $$('.screen').forEach((screen)=>screen.classList.toggle('active',screen.id===id)); }
function openModal(id){ $(`#${id}`).classList.add('open'); }
function closeModal(el){ el.closest('.modal-backdrop').classList.remove('open'); }
function colorFor(team){ return team==='red'?'var(--red)':'var(--yellow)'; }
function timeText(seconds){ const safe=Math.max(0,Math.ceil(seconds)); return `${String(Math.floor(safe/60)).padStart(2,'0')}:${String(safe%60).padStart(2,'0')}`; }
function cellStyle([x,y], orientation='h', length=1){ return `--col:${x+1};--row:${y+1};--span-x:${orientation==='h'?length:1};--span-y:${orientation==='v'?length:1};`; }
function isCentreCell(x,y){ return x>=4&&x<=9&&y>=4&&y<=9; }
function shuffled(items){ return [...items].sort(()=>Math.random()-.5); }
function generateTeamSlots(){
  const candidates=[];
  for(let y=4;y<=9;y+=1) for(let x=4;x<=8;x+=1) candidates.push({pos:[x,y],orientation:'h'});
  for(let y=4;y<=8;y+=1) for(let x=4;x<=9;x+=1) candidates.push({pos:[x,y],orientation:'v'});
  for(let attempt=0;attempt<300;attempt+=1){
    const occupied=new Set(), selected=[];
    for(const slot of shuffled(candidates)){
      const cells=Array.from({length:2},(_,i)=>`${slot.pos[0]+(slot.orientation==='h'?i:0)},${slot.pos[1]+(slot.orientation==='v'?i:0)}`);
      if(cells.some((cell)=>occupied.has(cell)))continue;
      selected.push({pos:[...slot.pos],orientation:slot.orientation}); cells.forEach((cell)=>occupied.add(cell));
      if(selected.length===8)return selected;
    }
  }
  return defaultStartSlots.map((slot)=>({ ...slot,pos:[...slot.pos] }));
}
function generateStructures(){
  const cells=[]; for(let y=0;y<BOARD_SIZE;y+=1) for(let x=0;x<BOARD_SIZE;x+=1) if(!isCentreCell(x,y))cells.push([x,y]);
  return shuffled(cells).slice(0,4);
}
function generateNeutralStarts(){
  const used=new Set(structures.map(([x,y])=>`${x},${y}`)); const cars=[];
  for(let attempts=0;cars.length<33&&attempts<8000;attempts+=1){
    const orientation=Math.random()<.53?'h':'v'; const length=Math.random()<.55?2:3;
    const x=Math.floor(Math.random()*(orientation==='h'?BOARD_SIZE-length+1:BOARD_SIZE));
    const y=Math.floor(Math.random()*(orientation==='v'?BOARD_SIZE-length+1:BOARD_SIZE));
    const cells=Array.from({length},(_,i)=>[x+(orientation==='h'?i:0),y+(orientation==='v'?i:0)]);
    if(cells.some(([cx,cy])=>isCentreCell(cx,cy)||used.has(`${cx},${cy}`)))continue;
    cells.forEach(([cx,cy])=>used.add(`${cx},${cy}`)); cars.push({pos:[x,y],orientation,length});
  }
  return cars;
}
function generateNewBoard(){ startSlots=generateTeamSlots(); structures=generateStructures(); neutralStarts=generateNeutralStarts(); }

function renderNameFields(){ ['red','yellow'].forEach((team)=>{ $(`#${team}-name-fields`).innerHTML=Array.from({length:state.size},(_,i)=>`<input maxlength="12" value="${state.teams[team].players[i]||`${team==='red'?'레드':'옐로'} ${i+1}`}" aria-label="${team} 팀 플레이어 ${i+1}" />`).join(''); }); }
function renderLobby(){ $('#match-label').textContent=`${state.size} : ${state.size} 팀전`; $('#lobby-red-name').textContent=state.teams.red.name; $('#lobby-yellow-name').textContent=state.teams.yellow.name; $('#red-count').textContent=`${state.size}명`; $('#yellow-count').textContent=`${state.size}명`; }
function renderStaticStructures(root){ structures.forEach((p)=>root.insertAdjacentHTML('beforeend',`<i class="structure" style="${cellStyle(p)}"></i>`)); }

function renderSetupBoard(){
  const board=$('#setup-board'); board.innerHTML=''; renderStaticStructures(board);
  startSlots.forEach((slot,index)=>{ const red=state.placement.redSlots.includes(index),yellow=state.placement.yellowSlots.includes(index); board.insertAdjacentHTML('beforeend',`<button class="cell-marker ${slot.orientation==='v'?'vertical':''} ${red?'selected-red':''} ${yellow?'selected-yellow':''}" style="${cellStyle(slot.pos,slot.orientation,2)}" data-slot="${index}">${red?'R':yellow?'Y':'＋'}</button>`); });
  $$('.cell-marker').forEach((node)=>node.addEventListener('click',()=>chooseSlot(Number(node.dataset.slot))));
  const phase1=state.placement.phase===1; const selected=phase1?state.placement.redSlots.length:state.placement.yellowSlots.length;
  $('#setup-step-count').textContent=`STEP ${phase1?1:2} / 2`; $('#setup-tag').textContent=phase1?`${state.teams.yellow.name} · 후공 팀`:`${state.teams.red.name} · 선공 팀`; $('#setup-tag').style.borderColor=phase1?'var(--yellow)':'var(--red)'; $('#setup-tag').style.color=phase1?'var(--yellow)':'var(--red)';
  $('#setup-title').innerHTML=phase1?`상대 팀의<br />자동차 3대를<br /><em>배치하세요.</em>`:`마지막 내 팀<br />자동차 위치를<br /><em>선택하세요.</em>`; $('#setup-title em').style.color=phase1?'var(--yellow)':'var(--red)';
  $('#setup-copy').textContent=phase1?`중앙의 8개 시작 위치 중 ${state.teams.red.name} 자동차가 놓일 세 곳을 선택합니다.`:`${state.teams.red.name} 자동차가 놓일 마지막 한 곳을 선택합니다. 나머지 네 곳에는 ${state.teams.yellow.name} 자동차가 배치됩니다.`;
  $('#placement-number').textContent=selected; $('#placement-number').style.color=phase1?'var(--yellow)':'var(--red)'; $('.placement-count small').textContent=`/ ${phase1 ? 3 : 1} 선택`; $('#placement-next').disabled=selected!==(phase1?3:1); $('#placement-next').innerHTML=phase1?'다음 단계 <span>→</span>':'게임 시작 <span>→</span>';
}
function chooseSlot(index){ if(network.roomCode&&!network.isHost)return; const target=state.placement.phase===1?state.placement.redSlots:state.placement.yellowSlots; if(target.includes(index))target.splice(target.indexOf(index),1); else if(!state.placement.redSlots.includes(index)&&!state.placement.yellowSlots.includes(index)&&target.length<(state.placement.phase===1?3:1))target.push(index); renderSetupBoard();publishGame(); }
function setupCars(){
  const redSlots=state.placement.redSlots.concat(state.placement.yellowSlots); const yellowSlots=startSlots.map((_,i)=>i).filter((i)=>!redSlots.includes(i));
  state.cars=[...redSlots.map((slot,i)=>({id:`red-${i+1}`,team:'red',pos:[...startSlots[slot].pos],orientation:startSlots[slot].orientation,length:2,label:`R${i+1}`})),...yellowSlots.map((slot,i)=>({id:`yellow-${i+1}`,team:'yellow',pos:[...startSlots[slot].pos],orientation:startSlots[slot].orientation,length:2,label:`Y${i+1}`})),...neutralStarts.map((car,i)=>({id:`neutral-${i+1}`,team:'neutral',pos:[...car.pos],orientation:car.orientation,length:car.length,label:`N${i+1}`}))];
  state.remaining={red:Array(state.size).fill(60),yellow:Array(state.size).fill(60)}; state.turnsTaken={red:Array(state.size).fill(false),yellow:Array(state.size).fill(false)}; state.activeTeam='red'; state.activePlayer={red:0,yellow:0}; state.score={red:0,yellow:0}; state.lastMoved=null; state.selected=null; state.moves=0; state.timeouts={red:true,yellow:true}; state.gameOver=false;
}

function teamCanMove(car){ return car.team===state.activeTeam||car.team==='neutral'; }
function renderCars(root,interactive=false){
  state.cars.forEach((car)=>{ const locked=car.id===state.lastMoved,classes=`tile ${car.team} ${car.orientation==='h'?'horizontal':'vertical'} ${state.selected===car.id?'selected':''} ${locked?'last-moved':''}`,disabled=!interactive||!teamCanMove(car)||locked; root.insertAdjacentHTML('beforeend',`<button class="${classes}" style="${cellStyle(car.pos,car.orientation,car.length)}" data-car="${car.id}" ${disabled?'disabled':''} aria-label="${car.label} 자동차"><i class="car-window"></i><i class="car-light"></i>${locked?'<i class="cone"></i>':''}</button>`); });
  if(interactive)$$('.tile[data-car]').forEach((node)=>{
    node.addEventListener('click',()=>{ if (!dragState && Date.now() > ignoreClickUntil) { state.selected=node.dataset.car; renderGame(); } });
    node.addEventListener('pointerdown',(event)=>beginCarDrag(event,node.dataset.car));
  });
}
function renderBoard(root,interactive=false){ root.innerHTML=''; renderStaticStructures(root); renderCars(root,interactive); }
function renderRoster(team){ const index=state.activePlayer[team]; $(`#${team}-roster`).innerHTML=state.teams[team].players.map((name,i)=>`<div class="roster-player ${state.activeTeam===team&&index===i?`active-${team}`:''}"><b>${String(i+1).padStart(2,'0')}</b><span>${name}</span><i>${state.remaining[team]?timeText(state.remaining[team][i]):'01:00'}</i></div>`).join(''); }
function renderScore(team){ $(`#${team}-score`).textContent=`${state.score[team]} / 3`; $(`#${team}-escaped`).innerHTML=Array.from({length:3},(_,i)=>`<i class="${i<state.score[team]?'on':''}"></i>`).join(''); }
function renderGame(){
  $('#red-team-title').textContent=state.teams.red.name; $('#yellow-team-title').textContent=state.teams.yellow.name; const team=state.teams[state.activeTeam],player=team.players[state.activePlayer[state.activeTeam]];
  $('#active-team-name').textContent=team.name; $('#active-team-name').style.color=colorFor(state.activeTeam); $('#active-player-name').textContent=player; $('#active-turn-badge i').style.background=colorFor(state.activeTeam); $('#active-turn-badge i').style.boxShadow=`0 0 10px ${colorFor(state.activeTeam)}`;
  renderRoster('red');renderRoster('yellow');renderScore('red');renderScore('yellow');renderBoard($('#game-board'),true); $('#selected-car-text').textContent=state.selected?`${state.cars.find((c)=>c.id===state.selected).label} 자동차 선택됨 · 방향을 고르세요`:'움직일 자동차를 선택하세요'; $('#last-move').textContent=`직전 이동 차량: ${state.lastMoved?(state.cars.find((c)=>c.id===state.lastMoved)?.label||'탈출 차량'):'없음'}`;
  ['red','yellow'].forEach((teamName)=>{const b=$(`#${teamName}-timeout`);b.disabled=!state.timeouts[teamName];$(`#${teamName}-timeout-state`).textContent=state.timeouts[teamName]?'1 / 1':'0 / 1';}); updateTimerUI();
}

function carCells(car, [x,y]=car.pos){ return Array.from({length:car.length},(_,i)=>`${x+(car.orientation==='h'?i:0)},${y+(car.orientation==='v'?i:0)}`); }
function occupied(excludeId){ const cells=new Set(structures.map(([x,y])=>`${x},${y}`));state.cars.filter((c)=>c.id!==excludeId).forEach((c)=>carCells(c).forEach((cell)=>cells.add(cell)));return cells; }
function beginCarDrag(event, id){
  const car=state.cars.find((item)=>item.id===id); if(!car||!teamCanMove(car)||car.id===state.lastMoved)return;
  event.preventDefault(); dragState={id,orientation:car.orientation,startX:event.clientX,startY:event.clientY,node:event.currentTarget}; event.currentTarget.classList.add('selected','dragging'); event.currentTarget.setPointerCapture?.(event.pointerId);
  window.addEventListener('pointermove',updateCarDrag);
  window.addEventListener('pointerup',endCarDrag,{once:true});
}
function updateCarDrag(event){
  if(!dragState)return;
  const distance=dragState.orientation==='h'?event.clientX-dragState.startX:event.clientY-dragState.startY;
  dragState.node.style.transform=dragState.orientation==='h'?`translateX(${distance}px)`:`translateY(${distance}px)`;
}
function endCarDrag(event){
  if(!dragState)return; const drag=dragState; dragState=null; window.removeEventListener('pointermove',updateCarDrag); drag.node.style.transform=''; drag.node.classList.remove('dragging'); const distance=drag.orientation==='h'?event.clientX-drag.startX:event.clientY-drag.startY;
  const car=state.cars.find((item)=>item.id===drag.id); const board=$('#game-board'); const threshold=board.getBoundingClientRect().width/BOARD_SIZE*.3;
  if(Math.abs(distance)<threshold){ state.selected=drag.id; renderGame(); return; }
  ignoreClickUntil=Date.now()+250;
  const direction=drag.orientation==='h'?(distance>0?'right':'left'):(distance>0?'down':'up'); slideCar(car,direction);
}
function slideCar(car,direction){
  if(!isMyTurn())return;
  const delta={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]}[direction];if(!delta)return;
  if((car.orientation==='h'&&delta[1])||(car.orientation==='v'&&delta[0])){$('#move-notice').textContent=`${car.label} 자동차는 ${car.orientation==='h'?'좌우':'상하'}로만 이동할 수 있습니다.`;return;}
  const used=occupied(car.id);let [x,y]=car.pos,moved=false;
  while(true){const nx=x+delta[0],ny=y+delta[1],candidate=carCells(car,[nx,ny]);if(candidate.some((cell)=>{const [cx,cy]=cell.split(',').map(Number);return cx<0||cy<0||cx>=BOARD_SIZE||cy>=BOARD_SIZE||used.has(cell);}))break;x=nx;y=ny;moved=true;}
  if(!moved){$('#move-notice').textContent='그 방향으로는 움직일 수 없습니다.';return;}
  car.pos=[x,y];state.moves+=1;state.lastMoved=car.id;state.selected=null;const escaped=car.team===state.activeTeam&&(x===0||y===0||x+(car.orientation==='h'?car.length-1:0)===BOARD_SIZE-1||y+(car.orientation==='v'?car.length-1:0)===BOARD_SIZE-1);
  if(escaped){state.cars=state.cars.filter((item)=>item.id!==car.id);state.score[car.team]+=1;$('#move-notice').textContent=`${car.label} 자동차가 탈출했습니다!`;}else $('#move-notice').textContent=`${car.label} 자동차가 막힐 때까지 이동했습니다.`;
  if(state.score[car.team]>=3&&allPlayersHaveTurned()){finishGame(car.team);return;}switchToOpponent();
}
function allPlayersHaveTurned(){return ['red','yellow'].every((team)=>state.turnsTaken[team].every(Boolean));}
function consumeCurrentTime(){if(!state.turnStartedAt)return;const elapsed=(Date.now()-state.turnStartedAt)/1000,team=state.activeTeam,index=state.activePlayer[team];state.remaining[team][index]=Math.max(0,state.remaining[team][index]-elapsed);state.turnStartedAt=0;}
function switchToOpponent(){consumeCurrentTime();clearInterval(state.timer);state.activeTeam=state.activeTeam==='red'?'yellow':'red';while(state.remaining[state.activeTeam][state.activePlayer[state.activeTeam]]<=0)state.activePlayer[state.activeTeam]=(state.activePlayer[state.activeTeam]+1)%state.size;showHandoff();publishGame();}
function showHandoff(){const team=state.teams[state.activeTeam],index=state.activePlayer[state.activeTeam],mine=isMyTurn();$('#handoff-team').textContent=team.name;$('#handoff-team').style.color=colorFor(state.activeTeam);$('#handoff-player').textContent=team.players[index];$('#handoff-time').textContent=timeText(state.remaining[state.activeTeam][index]);$('#handoff-copy').innerHTML=mine?'다른 플레이어는 화면을 보거나 소통할 수 없습니다.<br />준비되면 혼자서 시작하세요.':'현재 차례인 플레이어의 컴퓨터에서만 게임판이 열립니다.<br />이 화면에서 대기하세요.';$('#enter-turn').disabled=!mine;$('#enter-turn').textContent=mine?'내 턴 시작 →':'다른 플레이어 진행 중';showScreen('handoff-screen');}
function enterTurn(){if(!isMyTurn())return;const team=state.activeTeam,index=state.activePlayer[team];state.turnsTaken[team][index]=true;state.turnStartedAt=Date.now();showScreen('game-screen');renderGame();publishGame();clearInterval(state.timer);state.timer=setInterval(()=>{const elapsed=(Date.now()-state.turnStartedAt)/1000,remaining=state.remaining[team][index]-elapsed;updateTimerUI(remaining);if(remaining<=0){state.remaining[team][index]=0;state.turnStartedAt=0;clearInterval(state.timer);state.activePlayer[team]=(index+1)%state.size;state.activeTeam=team==='red'?'yellow':'red';showHandoff();publishGame();}},120);}
function updateTimerUI(value){const time=value??state.remaining[state.activeTeam]?.[state.activePlayer[state.activeTeam]]??60;$('#player-clock').textContent=timeText(time);$('#timer-fill').style.width=`${Math.max(0,time)/60*100}%`;$('#timer-fill').style.background=colorFor(state.activeTeam);}
function callTimeout(team){if(!state.timeouts[team]||state.gameOver||!isMyTurn())return;consumeCurrentTime();clearInterval(state.timer);state.timeouts[team]=false;$('#timeout-team-name').textContent=state.teams[team].name;$('#timeout-team-name').style.color=colorFor(team);renderBoard($('#timeout-board'),false);openModal('timeout-modal');publishGame();}
function endTimeout(){closeModal($('#timeout-modal'));showHandoff();publishGame();}
function finishGame(team){consumeCurrentTime();clearInterval(state.timer);state.gameOver=true;$('#winner-name').textContent=state.teams[team].name;$('#winner-name').style.color=colorFor(team);$('#winner-copy').textContent=`${state.teams[team].name}이(가) 자동차 세 대를 가장 먼저 게임판 밖으로 탈출시켰습니다.`;$('#winner-moves').textContent=String(state.moves).padStart(2,'0');openModal('winner-modal');publishGame();}
async function beginSetup(){if(network.roomCode&&!network.isHost)return;if(!network.roomCode&&!(await createRoom()))return;generateNewBoard();state.placement={phase:1,redSlots:[],yellowSlots:[]};showScreen('setup-screen');renderSetupBoard();publishGame();}

$('#open-setup').addEventListener('click',()=>openModal('settings-modal'));$$('.modal-close,[data-close-modal]').forEach((button)=>button.addEventListener('click',()=>closeModal(button)));$$('.modal-backdrop').forEach((modal)=>modal.addEventListener('click',(event)=>{if(event.target===modal&&!['winner-modal','timeout-modal'].includes(modal.id))modal.classList.remove('open');}));
$$('[data-size]').forEach((button)=>button.addEventListener('click',()=>{state.size=Number(button.dataset.size);$$('.size-switch button').forEach((b)=>b.classList.toggle('selected',b===button));renderNameFields();}));
$('#save-settings').addEventListener('click',()=>{['red','yellow'].forEach((team)=>{state.teams[team].name=$(`#${team}-name-input`).value.trim()||(team==='red'?'레드 팀':'옐로 팀');state.teams[team].players=$$(`#${team}-name-fields input`).map((input,i)=>input.value.trim()||`${team==='red'?'레드':'옐로'} ${i+1}`);});renderLobby();closeModal($('#settings-modal'));publishGame();});
$('#create-room').addEventListener('click',createRoom);$('#join-room').addEventListener('click',joinRoom);$('#my-team').addEventListener('change',(event)=>{network.identity.team=event.target.value;});$('#my-player').addEventListener('change',(event)=>{network.identity.player=Number(event.target.value);});
$('#begin-placement').addEventListener('click',beginSetup);$('#cancel-setup').addEventListener('click',()=>showScreen('lobby-screen'));$('#placement-next').addEventListener('click',()=>{if(network.roomCode&&!network.isHost)return;if(state.placement.phase===1){state.placement.phase=2;renderSetupBoard();}else{setupCars();showHandoff();}publishGame();});
$('#enter-turn').addEventListener('click',enterTurn);$('#handoff-lobby').addEventListener('click',()=>{clearInterval(state.timer);showScreen('lobby-screen');});$('#leave-game').addEventListener('click',()=>{clearInterval(state.timer);showScreen('lobby-screen');});
$$('[data-direction]').forEach((button)=>button.addEventListener('click',()=>{const car=state.cars.find((item)=>item.id===state.selected);if(!car){$('#move-notice').textContent='먼저 움직일 자동차를 선택하세요.';return;}slideCar(car,button.dataset.direction);}));
window.addEventListener('keydown',(event)=>{const map={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right'};if(map[event.key]&&$('#game-screen').classList.contains('active')){event.preventDefault();const car=state.cars.find((item)=>item.id===state.selected);if(car)slideCar(car,map[event.key]);}});
$('#red-timeout').addEventListener('click',()=>callTimeout('red'));$('#yellow-timeout').addEventListener('click',()=>callTimeout('yellow'));$('#end-timeout').addEventListener('click',endTimeout);$('#new-game').addEventListener('click',()=>{closeModal($('#winner-modal'));beginSetup();});$('#winner-lobby').addEventListener('click',()=>{closeModal($('#winner-modal'));showScreen('lobby-screen');});
const roomFromUrl=new URLSearchParams(location.search).get('room');if(roomFromUrl){$('#join-room-code').value=roomFromUrl;joinRoom();}renderNameFields();renderLobby();
