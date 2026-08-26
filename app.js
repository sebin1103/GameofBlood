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
const state = { size:2, teams:{red:{name:'레드 팀',players:['레드 1','레드 2']},yellow:{name:'옐로 팀',players:['옐로 1','옐로 2']}}, placement:{phase:1,opponentSlots:[],ownSlot:[]}, cars:[], activeTeam:'red', activePlayer:{red:0,yellow:0}, remaining:{red:[],yellow:[]}, turnsTaken:{red:[],yellow:[]}, score:{red:0,yellow:0}, lastMoved:null, selected:null, moves:0, timeouts:{red:true,yellow:true}, timeoutActive:null, completedOrder:[], winner:null, winReason:null, round:1, seated:{red:null,yellow:null}, timer:null, turnStartedAt:0, gameOver:false, roomLobby:null };
let dragState = null;
let timeoutTicker = null;
let spectatorTimer = null;
const TIMEOUT_SECONDS = 60;
let ignoreClickUntil = 0;
const storedClientId=sessionStorage.getItem('hell-commute-client')||crypto.randomUUID();sessionStorage.setItem('hell-commute-client',storedClientId);
const network = { roomCode:null, isHost:false, identity:{team:'red',player:0}, clientId:storedClientId, lastUpdated:0, polling:null, applying:false, publishChain:Promise.resolve() };

function setRoomStatus(text){ const label=$('#room-status'); if(label)label.textContent=text; }
function isMyTurn(){ return !network.roomCode || (network.identity.team===state.activeTeam&&network.identity.player===state.activePlayer[state.activeTeam]); }
function defaultName(team,index){ return `${team==='red'?'레드':'옐로'} ${index+1}`; }
function playerName(team,index){ return state.roomLobby?.claims?.[`${team}-${index}`]?.name || state.teams[team].players[index] || defaultName(team,index); }
function lobbySlots(){ return ['red','yellow'].flatMap((team)=>state.teams[team].players.map((name,index)=>({key:`${team}-${index}`,team,index,name}))); }
function allSeatsFilled(){ return lobbySlots().every((slot)=>state.roomLobby?.claims?.[slot.key]); }
function myClaim(){
  const claims=state.roomLobby?.claims||{};
  const seat=Object.entries(claims).find(([,claim])=>claim?.clientId===network.clientId);
  if(seat)return {where:seat[0],name:seat[1].name};
  const benched=(state.roomLobby?.bench||[]).find((person)=>person.clientId===network.clientId);
  if(benched)return {where:'bench',name:benched.name};
  return null;
}
function renderRoomLobby(){
  if(!network.roomCode||!state.roomLobby)return;
  $('#waiting-room-code').textContent=network.roomCode;
  const claims=state.roomLobby.claims, bench=state.roomLobby.bench||[], mine=myClaim();
  if(mine&&$('#nickname-input')&&!$('#nickname-input').value.trim())$('#nickname-input').value=mine.name;
  $('#seat-list').innerHTML=['red','yellow'].map((team)=>`<section class="seat-team ${team==='red'?'red-seat-team':'yellow-seat-team'}"><strong>${state.teams[team].name}</strong>${Array.from({length:state.size},(_,index)=>{
    const key=`${team}-${index}`,claim=claims[key],isMine=claim?.clientId===network.clientId,taken=!!claim&&!isMine;
    const label=claim?(isMine?`${claim.name} · 내 자리`:claim.name):(mine?'여기로 이동':'빈 자리 · 여기로 참가');
    return `<button class="seat-button ${claim?'taken':''} ${isMine?'mine':''} ${!claim?'available':''}" data-seat="${key}" ${taken?'disabled':''}><b>PLAYER ${index+1}</b><span>${label}</span></button>`;
  }).join('')}</section>`).join('');
  $$('.seat-button[data-seat]').forEach((button)=>button.addEventListener('click',()=>claimSeat(button.dataset.seat)));
  $('#bench-list').innerHTML=bench.length?bench.map((person)=>`<span class="bench-chip ${person.clientId===network.clientId?'mine':''}">${person.name}${person.clientId===network.clientId?' · 나':''}</span>`).join(''):'<span class="bench-empty">비어 있음</span>';
  const onBench=mine?.where==='bench';
  $('#go-bench').disabled=!mine||onBench;
  $('#go-bench').textContent=onBench?'대기석에 있습니다':'대기석으로 이동';
  const ready=allSeatsFilled(); const start=$('#start-online-game');
  start.disabled=!network.isHost||!ready;
  start.textContent=ready?(network.isHost?'게임 준비 시작 →':'방장이 게임을 시작합니다'):'모두 입장하면 게임 준비 시작 →';
  $('#seat-help').textContent=ready?'모든 자리가 찼습니다.':onBench?'대기석입니다. 빈 자리를 누르면 참가합니다.':mine?'빈 자리를 누르면 그 자리로 옮겨집니다.':'닉네임을 입력하고 자리를 선택하세요.';
}
function showRoomLobby(){ showScreen('lobby-screen'); renderRoomLobby(); openModal('room-lobby-modal'); }
function showSetupWaiting(){
  showScreen('lobby-screen'); $('#waiting-room-code').textContent=network.roomCode;
  $('#seat-list').innerHTML='<section class="seat-team red-seat-team"><strong>게임 준비 중</strong><p class="seat-help">방장이 시작 위치를 준비하고 있습니다.<br />게임판은 자신의 차례가 될 때만 표시됩니다.</p></section>';
  $('#seat-help').textContent='준비가 끝나면 각 플레이어에게 순서대로 화면이 전달됩니다.';
  $('#start-online-game').disabled=true; $('#start-online-game').textContent='게임 준비 중…'; openModal('room-lobby-modal');
}
async function claimSeat(slot){
  if(!network.roomCode||!state.roomLobby||state.roomLobby.started)return;
  const mine=myClaim();
  const typed=($('#nickname-input')?.value||'').trim().slice(0,12)||mine?.name||'';
  if(!typed){ $('#seat-help').textContent='먼저 닉네임을 입력한 뒤 자리를 선택하세요.'; $('#nickname-input')?.focus(); return; }
  const response=await fetch(`/api/rooms/${network.roomCode}/claim`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slot,clientId:network.clientId,name:typed})});
  if(!response.ok){ $('#seat-help').textContent=slot==='bench'?'대기석으로 이동하지 못했습니다.':'이미 다른 플레이어가 참가한 자리입니다.'; return; }
  const result=await response.json();
  if(slot==='bench'){ network.identity={team:null,player:null}; }
  else { const detail=lobbySlots().find((item)=>item.key===slot); network.identity={team:detail.team,player:detail.index}; }
  network.lastUpdated=result.updatedAt; applyGame(result.state); renderRoomLobby();
}
function exportGame(){ const { timer, ...safeState }=state; return { state:safeState, layout:{startSlots,structures,neutralStarts} }; }
function applyGame(payload){
  if(!payload?.state)return; const incoming=payload.state;
  if(incoming.roomLobby?.claims){ const mine=Object.entries(incoming.roomLobby.claims).find(([,claim])=>claim?.clientId===network.clientId); if(mine){ const [team,index]=mine[0].split('-'); network.identity={team,player:Number(index)}; } }
  const iAmActive=network.roomCode&&network.identity.team===incoming.activeTeam&&network.identity.player===incoming.activePlayer?.[incoming.activeTeam];
  if(iAmActive&&state.timer&&state.turnStartedAt&&$('#game-screen').classList.contains('active')&&!incoming.timeoutActive&&!incoming.gameOver)return;
  clearInterval(state.timer); Object.assign(state,incoming,{timer:null});
  startSlots=payload.layout.startSlots; structures=payload.layout.structures; neutralStarts=payload.layout.neutralStarts;
  network.applying=true; routeScreens(); network.applying=false;
}
function routeScreens(){
  if(state.roomLobby&&!state.roomLobby.started){ showRoomLobby(); return; }
  closeModal($('#room-lobby-modal'));
  if(!state.cars.length){ showScreen('setup-screen'); renderSetupBoard(); return; }
  if(state.gameOver){ showScreen('game-screen'); renderGame(); renderWinner(); return; }
  closeModal($('#winner-modal'));
  if(state.timeoutActive){ renderTimeoutView(); return; }
  clearInterval(timeoutTicker); closeModal($('#timeout-modal'));
  if(isBoardWatcher()){ showSpectator(); return; }
  showHandoff();
}
function isBoardWatcher(){
  if(!network.roomCode||state.gameOver||state.timeoutActive||!state.cars.length)return false;
  const opponent=otherTeam(state.activeTeam);
  return network.identity.team===opponent&&network.identity.player===state.activePlayer[opponent];
}
function showSpectator(){
  clearInterval(state.timer); state.timer=null; state.selected=null;
  showScreen('game-screen'); $('#game-screen').classList.add('watching'); renderGame();
  $('#selected-car-text').textContent='상대 플레이어의 턴 — 관전 중';
  $('#move-notice').textContent=state.lastMoved?'직전에 움직인 자동차에 고깔이 표시됩니다.':'아직 움직인 자동차가 없습니다.';
  clearInterval(spectatorTimer);
  spectatorTimer=setInterval(()=>{
    if(!isBoardWatcher()){ clearInterval(spectatorTimer); return; }
    const team=state.activeTeam,index=state.activePlayer[team];
    updateTimerUI(state.turnStartedAt?state.remaining[team][index]-(Date.now()-state.turnStartedAt)/1000:state.remaining[team][index]);
  },250);
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
  try{const response=await fetch('/api/rooms',{method:'POST'});const data=await response.json();network.roomCode=data.code;network.isHost=true;network.lastUpdated=0;state.roomLobby={started:false,bench:[],claims:Object.fromEntries(lobbySlots().map((slot)=>[slot.key,null]))};setRoomStatus(`방 코드 ${data.code}`);history.replaceState(null,'',`?room=${data.code}`);startPolling();publishGame();showRoomLobby();return true;}catch{setRoomStatus('서버 연결 실패');return false;}
}
async function joinRoom(){
  const code=$('#join-room-code').value.trim().toUpperCase();if(!code)return;
  network.roomCode=code;network.isHost=false;setRoomStatus(`방 접속 ${code}`);history.replaceState(null,'',`?room=${code}`);await pullGame();startPolling();
}
function startPolling(){clearInterval(network.polling);network.polling=setInterval(pullGame,700);}

function showScreen(id){ $$('.screen').forEach((screen)=>screen.classList.toggle('active',screen.id===id)); }
function openModal(id){ if(id==='guide-modal'){const note=$('#guide-turn-note'); if(note)note.style.display=(state.turnStartedAt&&$('#game-screen').classList.contains('active'))?'':'none';} $(`#${id}`).classList.add('open'); }
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

function syncPlayerSlots(){ ['red','yellow'].forEach((team)=>{ state.teams[team].players=Array.from({length:state.size},(_,i)=>defaultName(team,i)); }); }
function renderNameFields(){ ['red','yellow'].forEach((team)=>{ $(`#${team}-name-fields`).innerHTML=Array.from({length:state.size},(_,i)=>`<div class="slot-preview">PLAYER ${i+1}</div>`).join(''); }); }
function renderLobby(){ $('#match-label').textContent=`${state.size} : ${state.size} 팀전`; $('#lobby-red-name').textContent=state.teams.red.name; $('#lobby-yellow-name').textContent=state.teams.yellow.name; $('#red-count').textContent=`${state.size}명`; $('#yellow-count').textContent=`${state.size}명`; }
function renderNeutralPreview(root){ neutralStarts.forEach((car)=>root.insertAdjacentHTML('beforeend',`<i class="tile neutral preview ${car.orientation==='h'?'horizontal':'vertical'}" style="${cellStyle(car.pos,car.orientation,car.length)}"><i class="car-window"></i><i class="car-light"></i></i>`)); }
function renderStaticStructures(root){ structures.forEach((p)=>root.insertAdjacentHTML('beforeend',`<i class="structure" style="${cellStyle(p)}"></i>`)); }

function renderSetupBoard(){
  const board=$('#setup-board'); board.innerHTML=''; renderStaticStructures(board); renderNeutralPreview(board);
  const phase1=state.placement.phase===1, mayPlace=canPlaceNow(), chosen=state.placement.opponentSlots.concat(state.placement.ownSlot);
  startSlots.forEach((slot,index)=>{ const red=chosen.includes(index); board.insertAdjacentHTML('beforeend',`<button class="cell-marker ${slot.orientation==='v'?'vertical':''} ${red?'selected-red':''}" style="${cellStyle(slot.pos,slot.orientation,2)}" data-slot="${index}" ${mayPlace?'':'disabled'}>${red?'R':'＋'}</button>`); });
  $$('.cell-marker').forEach((node)=>node.addEventListener('click',()=>chooseSlot(Number(node.dataset.slot))));
  const selected=phase1?state.placement.opponentSlots.length:state.placement.ownSlot.length, actor=phase1?'yellow':'red';
  $('#setup-step-count').textContent=`STEP ${phase1?1:2} / 2`;
  $('#setup-tag').textContent=phase1?`${state.teams.yellow.name} · 후공 팀`:`${state.teams.red.name} · 선공 팀`;
  $('#setup-tag').style.borderColor=colorFor(actor); $('#setup-tag').style.color=colorFor(actor);
  $('#setup-title').innerHTML=phase1?`상대 팀의<br />자동차 3대를<br /><em>배치하세요.</em>`:`마지막 내 팀<br />자동차 위치를<br /><em>선택하세요.</em>`;
  $('#setup-title em').style.color=colorFor(actor);
  $('#setup-copy').textContent=mayPlace?(phase1?`중앙의 8개 시작 위치 중 ${state.teams.red.name} 자동차가 놓일 세 곳을 선택합니다.`:`${state.teams.red.name} 자동차가 놓일 마지막 한 곳을 선택합니다. 나머지 네 곳에는 ${state.teams.yellow.name} 자동차가 배치됩니다.`):`${state.teams[actor].name}의 1번 플레이어가 배치하는 중입니다. 잠시 기다려 주세요.`;
  $('#placement-number').textContent=selected; $('#placement-number').style.color=colorFor(actor);
  $('.placement-count small').textContent=`/ ${phase1?3:1} 선택`;
  $('#placement-next').disabled=!mayPlace||selected!==(phase1?3:1);
  $('#placement-next').innerHTML=phase1?'다음 단계 <span>→</span>':'게임 시작 <span>→</span>';
}
function placementActor(){ return state.placement.phase===1?{team:'yellow',player:0}:{team:'red',player:0}; }
function canPlaceNow(){ if(!network.roomCode)return true; const actor=placementActor(); return network.identity.team===actor.team&&network.identity.player===actor.player; }
function chooseSlot(index){
  if(!canPlaceNow())return;
  const target=state.placement.phase===1?state.placement.opponentSlots:state.placement.ownSlot;
  if(target.includes(index))target.splice(target.indexOf(index),1);
  else if(!state.placement.opponentSlots.includes(index)&&!state.placement.ownSlot.includes(index)&&target.length<(state.placement.phase===1?3:1))target.push(index);
  renderSetupBoard(); publishGame();
}
function setupCars(){
  const redSlots=state.placement.opponentSlots.concat(state.placement.ownSlot); const yellowSlots=startSlots.map((_,i)=>i).filter((i)=>!redSlots.includes(i));
  state.cars=[...redSlots.map((slot,i)=>({id:`red-${i+1}`,team:'red',pos:[...startSlots[slot].pos],orientation:startSlots[slot].orientation,length:2,label:`R${i+1}`})),...yellowSlots.map((slot,i)=>({id:`yellow-${i+1}`,team:'yellow',pos:[...startSlots[slot].pos],orientation:startSlots[slot].orientation,length:2,label:`Y${i+1}`})),...neutralStarts.map((car,i)=>({id:`neutral-${i+1}`,team:'neutral',pos:[...car.pos],orientation:car.orientation,length:car.length,label:`N${i+1}`}))];
  state.remaining={red:Array(state.size).fill(60),yellow:Array(state.size).fill(60)}; state.turnsTaken={red:Array(state.size).fill(false),yellow:Array(state.size).fill(false)}; state.activeTeam='red'; state.activePlayer={red:0,yellow:0}; state.score={red:0,yellow:0}; state.lastMoved=null; state.selected=null; state.moves=0; state.timeouts={red:true,yellow:true}; state.timeoutActive=null; state.completedOrder=[]; state.winner=null; state.winReason=null; state.round=1; state.seated={red:null,yellow:null}; state.gameOver=false;
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
function renderRoster(team){ const index=state.activePlayer[team]; $(`#${team}-roster`).innerHTML=Array.from({length:state.size},(_,i)=>playerName(team,i)).map((name,i)=>`<div class="roster-player ${state.activeTeam===team&&index===i?`active-${team}`:''}"><b>${String(i+1).padStart(2,'0')}</b><span>${name}</span><i>${state.remaining[team]?timeText(state.remaining[team][i]):'01:00'}</i></div>`).join(''); }
function renderScore(team){ $(`#${team}-score`).textContent=`${state.score[team]} / 3`; $(`#${team}-escaped`).innerHTML=Array.from({length:3},(_,i)=>`<i class="${i<state.score[team]?'on':''}"></i>`).join(''); }
function renderGame(){
  $('#red-team-title').textContent=state.teams.red.name; $('#yellow-team-title').textContent=state.teams.yellow.name; const team=state.teams[state.activeTeam],player=playerName(state.activeTeam,state.activePlayer[state.activeTeam]);
  $('#active-team-name').textContent=team.name; $('#active-team-name').style.color=colorFor(state.activeTeam); $('#active-player-name').textContent=player; $('#active-turn-badge i').style.background=colorFor(state.activeTeam); $('#active-turn-badge i').style.boxShadow=`0 0 10px ${colorFor(state.activeTeam)}`;
  renderRoster('red');renderRoster('yellow');renderScore('red');renderScore('yellow');renderBoard($('#game-board'),isMyTurn()&&!state.gameOver);$$('[data-direction]').forEach((button)=>{button.disabled=!isMyTurn()||state.gameOver;}); $('#selected-car-text').textContent=state.selected?`${state.cars.find((c)=>c.id===state.selected).label} 자동차 선택됨 · 방향을 고르세요`:'움직일 자동차를 선택하세요'; $('#last-move').textContent=`직전 이동 차량: ${state.lastMoved?(state.cars.find((c)=>c.id===state.lastMoved)?.label||'탈출 차량'):'없음'}`;
  ['red','yellow'].forEach((teamName)=>{const b=$(`#${teamName}-timeout`);b.disabled=!state.timeouts[teamName]||teamName!==state.activeTeam;$(`#${teamName}-timeout-state`).textContent=state.timeouts[teamName]?'1 / 1':'0 / 1';}); updateTimerUI();
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
  if(!isMyTurn()||state.gameOver||state.timeoutActive)return;
  if(!teamCanMove(car)){$('#move-notice').textContent='상대 팀의 자동차는 움직일 수 없습니다.';return;}
  if(car.id===state.lastMoved){$('#move-notice').textContent='직전에 이동한 자동차는 움직일 수 없습니다.';return;}
  const delta={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]}[direction];if(!delta)return;
  if((car.orientation==='h'&&delta[1])||(car.orientation==='v'&&delta[0])){$('#move-notice').textContent=`${car.label} 자동차는 ${car.orientation==='h'?'좌우':'상하'}로만 이동할 수 있습니다.`;return;}
  const used=occupied(car.id);let [x,y]=car.pos,moved=false;
  while(true){const nx=x+delta[0],ny=y+delta[1],candidate=carCells(car,[nx,ny]);if(candidate.some((cell)=>{const [cx,cy]=cell.split(',').map(Number);return cx<0||cy<0||cx>=BOARD_SIZE||cy>=BOARD_SIZE||used.has(cell);}))break;x=nx;y=ny;moved=true;}
  if(!moved){$('#move-notice').textContent='그 방향으로는 움직일 수 없습니다.';return;}
  car.pos=[x,y];state.moves+=1;state.lastMoved=car.id;state.selected=null;
  const escaped=car.team===state.activeTeam&&(car.orientation==='h'?(x===0||x+car.length-1===BOARD_SIZE-1):(y===0||y+car.length-1===BOARD_SIZE-1));
  if(escaped){state.cars=state.cars.filter((item)=>item.id!==car.id);state.score[car.team]+=1;if(state.score[car.team]>=3&&!state.completedOrder.includes(car.team))state.completedOrder.push(car.team);$('#move-notice').textContent=`${car.label} 자동차가 탈출했습니다!`;}
  else $('#move-notice').textContent=`${car.label} 자동차가 막힐 때까지 이동했습니다.`;
  passTurn(false);
}
function consumeCurrentTime(){if(!state.turnStartedAt)return;const elapsed=(Date.now()-state.turnStartedAt)/1000,team=state.activeTeam,index=state.activePlayer[team];state.remaining[team][index]=Math.max(0,state.remaining[team][index]-elapsed);state.turnStartedAt=0;}
function otherTeam(team){ return team==='red'?'yellow':'red'; }
function refillClocks(){ state.remaining={red:Array(state.size).fill(60),yellow:Array(state.size).fill(60)}; state.activePlayer={red:0,yellow:0}; state.seated={red:null,yellow:null}; state.round=(state.round||1)+1; }
function teamHasTime(team){ return state.remaining[team].some((value)=>value>0); }
function advanceSeat(team){ for(let step=1;step<=state.size;step+=1){ const seat=(state.activePlayer[team]+step)%state.size; if(state.remaining[team][seat]>0){ if(state.activePlayer[team]!==seat)state.seated[team]=null; state.activePlayer[team]=seat; return true; } } return false; }
function seatWithTime(team){ return state.remaining[team][state.activePlayer[team]]>0||advanceSeat(team); }
function allRequiredTurnsDone(){ return ['red','yellow'].every((team)=>state.turnsTaken[team].every((taken,index)=>taken||state.remaining[team][index]<=0)); }
function checkVictory(){ if(state.gameOver)return true; if(!state.completedOrder.length||!allRequiredTurnsDone())return false; finishGame(state.completedOrder[0],false); return true; }
function passTurn(expired){
  consumeCurrentTime(); clearInterval(state.timer); state.timer=null; state.selected=null;
  const current=state.activeTeam, opponent=otherTeam(current);
  if(expired)advanceSeat(current); else seatWithTime(current);
  if(checkVictory())return;
  if(teamHasTime(opponent)){ seatWithTime(opponent); state.activeTeam=opponent; }
  else if(!teamHasTime(current)){ refillClocks(); state.activeTeam=opponent; }
  showHandoff(); publishGame();
}
function renderMatchup(){
  ['red','yellow'].forEach((team)=>{
    $(`#matchup-${team}`).textContent=playerName(team,state.activePlayer[team]);
    $(`#matchup-${team}-team`).textContent=state.teams[team].name;
  });
}
function showHandoff(){
  if(isBoardWatcher()){showSpectator();return;}
  if(isMyTurn()&&!state.gameOver&&!state.timeoutActive&&state.cars.length&&state.seated?.[state.activeTeam]===state.activePlayer[state.activeTeam]){
    setTimeout(()=>{ if(isMyTurn()&&!state.timer&&!state.gameOver&&!state.timeoutActive)enterTurn(); },0);
    return;
  }clearInterval(spectatorTimer);$('#game-screen').classList.remove('watching');const team=state.teams[state.activeTeam],index=state.activePlayer[state.activeTeam],mine=isMyTurn();if(mine){$('#handoff-team').textContent=team.name;$('#handoff-team').style.color=colorFor(state.activeTeam);$('#handoff-player').textContent=playerName(state.activeTeam,index);$('#handoff-suffix').innerHTML='만<br />자동차를 움직일 수 있습니다.';}else{$('#handoff-team').textContent='지금은';$('#handoff-team').style.color='var(--paper)';$('#handoff-player').textContent=`${playerName('red',state.activePlayer.red)} · ${playerName('yellow',state.activePlayer.yellow)}`;$('#handoff-suffix').innerHTML='만<br />화면을 볼 수 있습니다.';}$('#handoff-time').textContent=timeText(state.remaining[state.activeTeam][index]);renderMatchup();(()=>{const seat=myClaim();const el=$('#handoff-seat');if(!el)return;if(!seat){el.textContent='이 브라우저는 참가한 자리가 없습니다 · 관전만 가능';el.style.color='#c4762f';return;}if(seat.where==='bench'){el.textContent=`${seat.name} · 대기석`;el.style.color='#c4762f';return;}const [seatTeam,seatIndex]=seat.where.split('-');el.textContent=`내 자리: ${state.teams[seatTeam].name} ${Number(seatIndex)+1}번 (${seat.name})`;el.style.color='';})();$('#handoff-copy').innerHTML=(mine?'대기 중인 팀원은 화면을 보거나 소통할 수 없습니다.<br />준비되면 혼자서 시작하세요.':'지금은 두 사람이 1대1로 진행 중입니다.<br />내 차례가 오면 이 화면에서 게임판이 열립니다.')+(state.round>1?`<br /><b>라운드 ${state.round} · 양 팀 제한 시간이 1분씩 리셋되었습니다.</b>`:'');$('#enter-turn').disabled=!mine;$('#enter-turn').textContent=mine?'내 턴 시작 →':'다른 플레이어 진행 중';showScreen('handoff-screen');}
function enterTurn(){
  if(state.timer)return;
  clearInterval(spectatorTimer); $('#game-screen').classList.remove('watching');
  if(!isMyTurn()||state.gameOver||state.timeoutActive)return;
  const team=state.activeTeam,index=state.activePlayer[team];
  if(!state.seated)state.seated={red:null,yellow:null};
  state.seated[team]=index;
  state.turnsTaken[team][index]=true; state.turnStartedAt=Date.now();
  showScreen('game-screen'); renderGame(); publishGame(); clearInterval(state.timer);
  state.timer=setInterval(()=>{
    if(!state.turnStartedAt)return;
    const elapsed=(Date.now()-state.turnStartedAt)/1000,remaining=state.remaining[team][index]-elapsed;
    updateTimerUI(remaining);
    if(remaining<=0){ state.remaining[team][index]=0; state.turnStartedAt=0; clearInterval(state.timer); state.timer=null; $('#move-notice').textContent='제한 시간이 끝나 턴이 넘어갑니다.'; passTurn(true); }
  },120);
}
function updateTimerUI(value){const time=value??state.remaining[state.activeTeam]?.[state.activePlayer[state.activeTeam]]??60;$('#player-clock').textContent=timeText(time);$('#timer-fill').style.width=`${Math.max(0,time)/60*100}%`;$('#timer-fill').style.background=colorFor(state.activeTeam);}
function myTeam(){ return network.roomCode?network.identity.team:state.activeTeam; }
function callTimeout(team){
  if(!state.timeouts[team]||state.gameOver||state.timeoutActive)return;
  if(team!==state.activeTeam||!isMyTurn()){ $('#move-notice').textContent='타임아웃은 자기 팀 차례에, 자기 팀만 요청할 수 있습니다.'; return; }
  consumeCurrentTime(); clearInterval(state.timer); state.timer=null;
  state.timeouts[team]=false; state.timeoutActive={team,endsAt:Date.now()+TIMEOUT_SECONDS*1000}; renderGame();
  publishGame(); renderTimeoutView();
}
function renderTimeoutView(){
  const info=state.timeoutActive; if(!info)return;
  const mine=!network.roomCode||myTeam()===info.team, owner=isMyTurn();
  $('#timeout-team-name').textContent=state.teams[info.team].name; $('#timeout-team-name').style.color=colorFor(info.team);
  $('#timeout-copy').textContent=mine?'지금은 모든 팀원이 게임판을 보고 자유롭게 소통할 수 있습니다.':'상대 팀이 작전 회의 중입니다. 회의가 끝날 때까지 기다려 주세요.';
  $('#timeout-board').style.display=mine?'':'none';
  if(mine)renderBoard($('#timeout-board'),false); else $('#timeout-board').innerHTML='';
  $('#end-timeout').style.display=owner?'':'none';
  closeModal($('#guide-modal')); openModal('timeout-modal');
  clearInterval(timeoutTicker);
  timeoutTicker=setInterval(()=>{
    if(!state.timeoutActive){ clearInterval(timeoutTicker); return; }
    const left=(state.timeoutActive.endsAt-Date.now())/1000;
    $('#timeout-clock').textContent=timeText(Math.max(0,left));
    if(left<=0){ clearInterval(timeoutTicker); if(owner)endTimeout(); }
  },200);
}
function endTimeout(){ clearInterval(timeoutTicker); state.timeoutActive=null; closeModal($('#timeout-modal')); publishGame(); showHandoff(); }
function finishGame(team,byTime){
  consumeCurrentTime(); clearInterval(state.timer); state.timer=null; clearInterval(timeoutTicker);
  state.gameOver=true; state.winner=team||null; state.winReason=byTime?'time':'escape'; state.timeoutActive=null;
  closeModal($('#timeout-modal')); renderWinner(); publishGame();
}
function renderWinner(){
  const team=state.winner;
  if(team){
    $('#winner-name').textContent=state.teams[team].name; $('#winner-name').style.color=colorFor(team); $('#winner-suffix').textContent='승리!';
    $('#winner-copy').textContent=state.winReason==='time'?`양 팀의 제한 시간이 모두 끝났고, 자동차를 더 많이 탈출시킨 ${state.teams[team].name}이(가) 승리했습니다.`:`${state.teams[team].name}이(가) 자동차 세 대를 가장 먼저 게임판 밖으로 탈출시켰습니다.`;
  } else {
    $('#winner-name').textContent='무승부'; $('#winner-name').style.color='currentColor'; $('#winner-suffix').textContent='입니다.';
    $('#winner-copy').textContent=`양 팀의 제한 시간이 모두 끝났고 탈출시킨 자동차 수가 ${state.score.red}대로 같습니다.`;
  }
  closeModal($('#guide-modal')); $('#winner-moves').textContent=String(state.moves).padStart(2,'0'); openModal('winner-modal');
}
async function beginSetup(){
  if(network.roomCode&&!network.isHost)return;
  if(!network.roomCode&&!(await createRoom()))return;
  if(!state.roomLobby){state.roomLobby={started:false,bench:[],claims:Object.fromEntries(lobbySlots().map((slot)=>[slot.key,null]))};publishGame();showRoomLobby();return;}
  if(!state.roomLobby.started){if(!allSeatsFilled()){renderRoomLobby();return;}state.roomLobby.started=true;closeModal($('#room-lobby-modal'));}
  generateNewBoard();state.placement={phase:1,opponentSlots:[],ownSlot:[]};state.cars=[];state.gameOver=false;state.winner=null;state.winReason=null;state.timeoutActive=null;state.completedOrder=[];state.round=1;state.lastMoved=null;state.selected=null;closeModal($('#winner-modal'));showScreen('setup-screen');renderSetupBoard();publishGame();
}

$('#open-setup').addEventListener('click',()=>openModal('settings-modal'));$$('[data-open-modal]').forEach((button)=>button.addEventListener('click',()=>openModal(button.dataset.openModal)));$$('.modal-close,[data-close-modal]').forEach((button)=>button.addEventListener('click',()=>closeModal(button)));$$('.modal-backdrop').forEach((modal)=>modal.addEventListener('click',(event)=>{if(event.target===modal&&!['winner-modal','timeout-modal'].includes(modal.id))modal.classList.remove('open');}));
$$('[data-size]').forEach((button)=>button.addEventListener('click',()=>{state.size=Number(button.dataset.size);$$('.size-switch button').forEach((b)=>b.classList.toggle('selected',b===button));syncPlayerSlots();renderNameFields();}));
$('#save-settings').addEventListener('click',()=>{['red','yellow'].forEach((team)=>{state.teams[team].name=$(`#${team}-name-input`).value.trim()||(team==='red'?'레드 팀':'옐로 팀');state.teams[team].players=Array.from({length:state.size},(_,i)=>defaultName(team,i));});renderLobby();closeModal($('#settings-modal'));publishGame();});
$('#create-room').addEventListener('click',createRoom);$('#join-room').addEventListener('click',joinRoom);$('#start-online-game').addEventListener('click',beginSetup);$('#go-bench').addEventListener('click',()=>claimSeat('bench'));$('#leave-room').addEventListener('click',()=>{clearInterval(network.polling);network.roomCode=null;network.isHost=false;state.roomLobby=null;closeModal($('#room-lobby-modal'));setRoomStatus('로컬 게임');history.replaceState(null,'',location.pathname);});
$('#begin-placement').addEventListener('click',beginSetup);$('#cancel-setup').addEventListener('click',()=>showScreen('lobby-screen'));$('#placement-next').addEventListener('click',()=>{if(!canPlaceNow())return;if(state.placement.phase===1){state.placement.phase=2;renderSetupBoard();}else{setupCars();showHandoff();}publishGame();});
$('#enter-turn').addEventListener('click',enterTurn);$('#handoff-lobby').addEventListener('click',()=>{clearInterval(state.timer);showScreen('lobby-screen');});$('#leave-game').addEventListener('click',()=>{clearInterval(state.timer);showScreen('lobby-screen');});
$$('[data-direction]').forEach((button)=>button.addEventListener('click',()=>{const car=state.cars.find((item)=>item.id===state.selected);if(!car){$('#move-notice').textContent='먼저 움직일 자동차를 선택하세요.';return;}slideCar(car,button.dataset.direction);}));
window.addEventListener('keydown',(event)=>{const map={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right'};if(map[event.key]&&$('#game-screen').classList.contains('active')){event.preventDefault();const car=state.cars.find((item)=>item.id===state.selected);if(car)slideCar(car,map[event.key]);}});
$('#red-timeout').addEventListener('click',()=>callTimeout('red'));$('#yellow-timeout').addEventListener('click',()=>callTimeout('yellow'));$('#end-timeout').addEventListener('click',endTimeout);$('#new-game').addEventListener('click',()=>{closeModal($('#winner-modal'));beginSetup();});$('#winner-lobby').addEventListener('click',()=>{closeModal($('#winner-modal'));showScreen('lobby-screen');});
const roomFromUrl=new URLSearchParams(location.search).get('room');if(roomFromUrl){$('#join-room-code').value=roomFromUrl;joinRoom();}renderNameFields();renderLobby();
