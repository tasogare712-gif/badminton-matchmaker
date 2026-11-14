const STORAGE_KEY = 'badminton-matchmaker-v1';
const MODE_KEY = 'badminton-matchmaker-mode-v1';
const defaultNames = ['佐藤','鈴木','高橋','田中','伊藤','渡辺','山本','中村'];
const initialState = { players: defaultNames.map((name) => ({ id: crypto.randomUUID(), name })), courts: 2, round: 0, matches: [] };
let state = loadState();
let appMode = localStorage.getItem(MODE_KEY) || 'offline';
let roomSocket = null;
let roomCode = null;
let roomPlayerId = null;
let selectedPlayerForSwap = null;
const $ = (selector) => document.querySelector(selector);
function loadState() {
  try { const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); if (saved && Array.isArray(saved.players)) return { ...initialState, ...saved }; } catch {}
  return structuredClone(initialState);
}
function save() {
  if (appMode === 'offline') localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  else sendRoom({ type: 'state-update', state: { courts: state.courts, round: state.round, matches: state.matches } });
}
function renderMode() {
  $('#offline-mode').classList.toggle('selected', appMode === 'offline');
  $('#online-mode').classList.toggle('selected', appMode === 'online');
  $('#mode-status').textContent = appMode === 'offline' ? '臨時名簿と対戦履歴はこの端末のブラウザに保存されます。' : '名前を入力して部屋を作成、または部屋コードで参加します。';
  $('#room-panel').classList.toggle('hidden', appMode !== 'online');
  $('#practice-config').classList.toggle('hidden', appMode === 'online' && !roomSocket);
  $('#add-form').classList.toggle('hidden', appMode === 'online');
  $('#participant-help').textContent = appMode === 'online' ? '部屋に入ったメンバーが自動で追加されます' : '4人以上で対戦表を作成できます';
  $('#active-room').classList.toggle('hidden', !roomSocket);
  if (roomCode) $('#active-room-code').textContent = roomCode;
}
function sendRoom(message) {
  if (!roomSocket || roomSocket.readyState !== WebSocket.OPEN) return false;
  roomSocket.send(JSON.stringify(message));
  return true;
}
function connectRoom(action, name, code = '') {
  if (!window.ROOM_SERVER_URL) { showNotice('部屋サーバーの設定がありません。時間をおいて再度お試しください。'); return; }
  if (!name.trim()) { $('#room-player-name').focus(); showNotice('お名前を入力してください。'); return; }
  if (roomSocket) roomSocket.close();
  $('#room-status').textContent = '部屋に接続しています…';
  const socket = new WebSocket(window.ROOM_SERVER_URL);
  roomSocket = socket;
  let heartbeat;
  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: action, name: name.trim(), code: code.trim().toUpperCase() }));
    heartbeat = setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'heartbeat' })); }, 60000);
  });
  socket.addEventListener('message', (event) => {
    let message; try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'error') { $('#room-status').textContent = message.message; socket.close(); return; }
    if (message.type === 'room') {
      roomCode = message.code; roomPlayerId = message.playerId;
      state = { ...state, ...message.state, players: message.players };
      $('#room-status').textContent = `${state.players.length}人がこの部屋に参加しています。`;
      $('#room-code').value = roomCode; renderMode(); renderPlayers(); renderCourts(); renderMatches();
      return;
    }
    if (message.type === 'room-update' && message.code === roomCode) {
      state = { ...state, ...message.state, players: message.players };
      $('#room-status').textContent = `${state.players.length}人がこの部屋に参加しています。`;
      renderPlayers(); renderCourts(); renderMatches();
    }
  });
  socket.addEventListener('close', () => {
    clearInterval(heartbeat);
    if (roomSocket !== socket) return;
    roomSocket = null; roomPlayerId = null; roomCode = null;
    renderMode();
    if (appMode === 'online') $('#room-status').textContent = '接続が終了しました。部屋コードを入力して再参加してください。';
  });
  socket.addEventListener('error', () => { $('#room-status').textContent = '部屋サーバーに接続できません。起動中の場合は少し待ってから再試行してください。'; });
}
function setMode(mode) {
  if (appMode === mode) return;
  if (roomSocket) { roomSocket.close(); roomSocket = null; }
  roomCode = null; roomPlayerId = null;
  appMode = mode; localStorage.setItem(MODE_KEY, mode); renderMode();
  state.matches = []; state.round = 0; selectedPlayerForSwap = null;
  if (mode === 'offline') { state = loadState(); renderPlayers(); renderCourts(); renderMatches(); }
  else { state = { ...state, players: [], round: 0, matches: [] }; renderPlayers(); renderCourts(); renderMatches(); }
}
function escapeHTML(value) { return value.replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function showNotice(message, title = 'お知らせ') { $('#dialog-title').textContent = title; $('#dialog-message').textContent = message; $('#notice-dialog').showModal(); }
function renderCourts() { $('#court-picker').innerHTML = [1,2,3,4].map((n) => `<button type="button" class="court-option ${state.courts === n ? 'selected' : ''}" aria-pressed="${state.courts === n}" data-courts="${n}">${n}面<span>${n === 1 ? 'ゆったり' : n === 4 ? 'フル稼働' : '同時進行'}</span></button>`).join(''); }
function renderPlayers() {
  $('#profile-list').innerHTML = state.players.length ? state.players.map((p, index) => `<div class="profile-row"><span class="avatar" aria-label="参加者番号 ${index + 1}">${index + 1}</span><span class="profile-name">${escapeHTML(p.name)}</span><button class="remove-player" data-remove="${p.id}" aria-label="${escapeHTML(p.name)}を削除" type="button">×</button></div>`).join('') : '<div class="empty-state">参加者を追加してください</div>';
  $('#player-count').textContent = `${state.players.length}人登録中`;
  $('#start-button').disabled = state.players.length < 4;
  $('#start-button').textContent = state.players.length < 4 ? `あと${4-state.players.length}人追加してください` : '🏸　対戦表を作成';
}
function openSetup() { selectedPlayerForSwap = null; $('#matches-view').classList.add('hidden'); $('#setup-view').classList.remove('hidden'); $('.nav-item[data-view="matches"]').classList.remove('active'); $('.nav-item[data-view="players"]').classList.add('active'); window.scrollTo({top:0,behavior:'smooth'}); }
function openMatches() { $('#setup-view').classList.add('hidden'); $('#matches-view').classList.remove('hidden'); $('.nav-item[data-view="players"]').classList.remove('active'); $('.nav-item[data-view="settings"]').classList.remove('active'); $('.nav-item[data-view="matches"]').classList.add('active'); renderMatches(); window.scrollTo({top:0,behavior:'smooth'}); }
function makeRound() {
  if (state.players.length < 4) { showNotice('対戦表を作るには参加者が4人以上必要です。'); return; }
  const playerIds = state.players.map((p) => p.id); const rounds = [];
  const totalRounds = Math.max(12, state.players.length * 3);
  for (let r=0;r<totalRounds;r++) {
    const used = new Set(); const teams = []; const courts=[];
    const rotate = (r * Math.max(1, state.courts * 2)) % playerIds.length;
    const order = [...playerIds.slice(rotate), ...playerIds.slice(0,rotate)];
    for (let c=0;c<state.courts;c++) {
      const available = order.filter((id)=>!used.has(id)); if (available.length<4) break;
      let best=null; let bestScore=Infinity;
      for(let a=0;a<available.length;a++) for(let b=a+1;b<available.length;b++) for(let x=0;x<available.length;x++) for(let y=x+1;y<available.length;y++) {
        const t1=[available[a],available[b]], t2=[available[x],available[y]];
        if(t1.some((id)=>t2.includes(id))) continue;
        const prior=state.matches.flatMap((m)=>m.courts||[]).concat(rounds.flatMap((m)=>m.courts||[]));
        const pairCount=(arr, pair)=>arr.reduce((sum,m)=>sum+(m.team1?.every((id)=>pair.includes(id))&&m.team1.length===2&&m.team1.some((id)=>pair[0]===id)+m.team1.some((id)=>pair[1]===id)===2?1:0)+(m.team2?.length===2&&pair.every((id)=>m.team2.includes(id))?1:0),0);
        const opponentCount=(arr, pair)=>arr.reduce((sum,m)=>sum+((m.team1||[]).some((id)=>pair[0]===id)&&(m.team2||[]).some((id)=>pair[1]===id)||(m.team1||[]).some((id)=>pair[1]===id)&&(m.team2||[]).some((id)=>pair[0]===id)?1:0),0);
        const score=pairCount(prior,t1)*6+pairCount(prior,t2)*6+opponentCount(prior,[t1[0],t2[0]])*2+opponentCount(prior,[t1[0],t2[1]])*2+opponentCount(prior,[t1[1],t2[0]])*2+opponentCount(prior,[t1[1],t2[1]])*2+Math.random()*.05;
        if(score<bestScore){bestScore=score;best=[t1,t2];}
      }
      if(!best) break; best.flat().forEach((id)=>used.add(id)); teams.push({court:c+1,team1:best[0],team2:best[1]});
    }
    rounds.push({courts:teams,rest:playerIds.filter((id)=>!used.has(id))});
  }
  const current=state.round; state.matches.push(...rounds); state.round=current; state.round+=1; save(); openMatches();
}
function renderMatches() {
  $('#round-number').textContent = String(state.round);
  $('#summary-courts').textContent = `${state.courts}面`;
  $('#summary-players').textContent = `${state.players.length}人`;
  const data = state.matches[state.round - 1];
  if (!data) {
    $('#match-list').innerHTML = '<div class="empty-state">対戦表を作成すると、ここに試合が表示されます。</div>';
    $('#round-message').textContent = '参加者とコート数を設定して対戦表を作成しましょう。';
    return;
  }
  const names = new Map(state.players.map((p) => [p.id, p.name]));
  const name = (id) => escapeHTML(names.get(id) || '退会済み');
  $('#round-message').setAttribute('aria-live', 'polite');
  $('#round-message').textContent = `第${state.round}ラウンド｜${data.courts.length}試合｜選手を2人タップして入れ替え（休憩者との交換もできます）`;
  const playerButton = (id, matchIndex) => {
    const selected = selectedPlayerForSwap?.playerId === id;
    return `<button class="player-chip${selected ? ' selected' : ''}" type="button" data-location="court" data-player-id="${id}" data-match-index="${matchIndex}" aria-pressed="${selected}" aria-label="${name(id)}${selected ? '、選択中' : '、タップして選択'}" style="border:0;background:${selected ? '#dff4ff' : 'transparent'};border-radius:8px;padding:4px;width:100%;font:inherit;text-align:center;cursor:pointer">${name(id)}</button>`;
  };
  const restButton = (id) => {
    const selected = selectedPlayerForSwap?.playerId === id;
    return `<button class="rest-chip rest-player${selected ? ' selected' : ''}" type="button" data-location="rest" data-player-id="${id}" aria-pressed="${selected}" aria-label="${name(id)}${selected ? '、選択中' : '、タップして選択'}" style="border:0;background:${selected ? '#dff4ff' : ''};font:inherit;cursor:pointer">${name(id)}</button>`;
  };
  $('#match-list').innerHTML = data.courts.map((m, matchIndex) =>
    `<article class="match-card"><div class="match-card-head"><span class="court-name">コート ${m.court}</span><span class="match-tag">ダブルス</span></div><div class="versus-layout"><div class="team">${m.team1.map((id) => playerButton(id, matchIndex)).join('')}</div><span class="versus">VS</span><div class="team">${m.team2.map((id) => playerButton(id, matchIndex)).join('')}</div></div></article>`
  ).join('') + (data.rest.length ? `<div class="rest-card"><div class="rest-title">⏸ 今回のお休み · ${data.rest.length}人</div><div class="rest-names">${data.rest.map((id) => restButton(id)).join('')}</div></div>` : '');
}
$('#match-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-player-id][data-location]');
  if (!button) return;
  const picked = {
    playerId: button.dataset.playerId,
    locationType: button.dataset.location,
    matchIndex: button.dataset.location === 'court' ? Number(button.dataset.matchIndex) : null
  };
  const round = state.matches[state.round - 1];
  if (!round) return;

  const playerName = (id) => state.players.find((p) => p.id === id)?.name || '選手';
  if (!selectedPlayerForSwap) {
    selectedPlayerForSwap = picked;
    renderMatches();
    $('#round-message').textContent = `${playerName(picked.playerId)}を選択しました。入れ替える相手を選んでください。`;
    return;
  }
  if (selectedPlayerForSwap.playerId === picked.playerId) {
    selectedPlayerForSwap = null;
    renderMatches();
    return;
  }
  if (selectedPlayerForSwap.locationType === 'rest' && picked.locationType === 'rest') {
    selectedPlayerForSwap = picked;
    renderMatches();
    $('#round-message').textContent = `${playerName(picked.playerId)}を選択しました。コート上の相手を選んでください。`;
    return;
  }

  const firstName = playerName(selectedPlayerForSwap.playerId);
  const secondName = playerName(picked.playerId);
  if (selectedPlayerForSwap.locationType === 'rest' || picked.locationType === 'rest') {
    const restingId = selectedPlayerForSwap.locationType === 'rest' ? selectedPlayerForSwap.playerId : picked.playerId;
    const courtPlayer = selectedPlayerForSwap.locationType === 'court' ? selectedPlayerForSwap : picked;
    const match = round.courts[courtPlayer.matchIndex];
    const locate = (playerId) => {
      for (const team of ['team1', 'team2']) {
        const index = match?.[team].indexOf(playerId) ?? -1;
        if (index !== -1) return { team, index };
      }
      return null;
    };
    const restIndex = round.rest.indexOf(restingId);
    const courtPosition = locate(courtPlayer.playerId);
    if (restIndex === -1 || !courtPosition) {
      selectedPlayerForSwap = null;
      renderMatches();
      return;
    }
    match[courtPosition.team][courtPosition.index] = restingId;
    round.rest[restIndex] = courtPlayer.playerId;
  } else {
    if (selectedPlayerForSwap.matchIndex !== picked.matchIndex) {
      selectedPlayerForSwap = picked;
      renderMatches();
      $('#round-message').textContent = `同じ試合の選手か休憩中の人を選択してください。`;
      return;
    }
    const match = round.courts[picked.matchIndex];
    const locate = (playerId) => {
      for (const team of ['team1', 'team2']) {
        const index = match[team].indexOf(playerId);
        if (index !== -1) return { team, index };
      }
      return null;
    };
    const first = locate(selectedPlayerForSwap.playerId);
    const second = locate(picked.playerId);
    if (!first || !second) {
      selectedPlayerForSwap = null;
      renderMatches();
      return;
    }
    [match[first.team][first.index], match[second.team][second.index]] =
      [match[second.team][second.index], match[first.team][first.index]];
  }

  selectedPlayerForSwap = null;
  save();
  renderMatches();
  $('#round-message').textContent = `${firstName}さんと${secondName}さんを入れ替えました。`;
});
$('#court-picker').addEventListener('click',(event)=>{const button=event.target.closest('[data-courts]');if(!button)return;state.courts=Number(button.dataset.courts);save();renderCourts();});
$('#add-form').addEventListener('submit',(event)=>{event.preventDefault();const input=$('#new-player');const name=input.value.trim();if(!name)return;if(state.players.some((p)=>p.name.toLocaleLowerCase()===name.toLocaleLowerCase())){showNotice('同じ名前の参加者が登録されています。');return;}state.players.push({id:crypto.randomUUID(),name});input.value='';save();renderPlayers();});
$('#profile-list').addEventListener('click',(event)=>{const button=event.target.closest('[data-remove]');if(!button)return;if(appMode==='online'){sendRoom({type:'remove-player',playerId:button.dataset.remove});return;}state.players=state.players.filter((p)=>p.id!==button.dataset.remove);save();renderPlayers();});
$('#clear-players').addEventListener('click',()=>{if(!state.players.length)return;if(appMode==='online'){sendRoom({type:'clear-players'});return;}state.players=[];state.matches=[];state.round=0;save();renderPlayers();});
$('#start-button').addEventListener('click',()=>{selectedPlayerForSwap=null;state.matches=[];state.round=0;makeRound();});
$('#next-round').addEventListener('click',()=>{selectedPlayerForSwap=null;if(state.matches.length<=state.round)makeRound();else{state.round+=1;save();renderMatches();window.scrollTo({top:0,behavior:'smooth'});}});
$('#edit-setup').addEventListener('click',openSetup);
document.querySelectorAll('.nav-item').forEach((button)=>button.addEventListener('click',()=>{if(button.dataset.view==='matches')openMatches();else if(button.dataset.view==='players')openSetup();else{const ok=confirm('参加者と対戦履歴をリセットしますか？');if(ok){state={...structuredClone(initialState),players:[]};save();renderPlayers();renderCourts();openSetup();showNotice('練習会をリセットしました。','リセット完了');}}}));
$('#offline-mode').addEventListener('click',()=>setMode('offline'));
$('#online-mode').addEventListener('click',()=>setMode('online'));
$('#create-room').addEventListener('click',()=>connectRoom('create-room',$('#room-player-name').value));
$('#join-room').addEventListener('click',()=>connectRoom('join-room',$('#room-player-name').value,$('#room-code').value));
$('#room-code').addEventListener('input',(event)=>{event.target.value=event.target.value.replace(/[^a-z0-9]/gi,'').toUpperCase().slice(0,6);});
$('#leave-room').addEventListener('click',()=>{if(roomSocket){roomSocket.close();roomSocket=null;}roomPlayerId=null;roomCode=null;renderMode();$('#room-status').textContent='部屋から退出しました。';});
$('#copy-room-code').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(roomCode);$('#room-status').textContent='部屋コードをコピーしました。';}catch{$('#room-status').textContent=`部屋コード「${roomCode}」を共有してください。`;}});
renderMode();renderCourts();renderPlayers();renderMatches();if(state.round>0&&appMode==='offline')openMatches();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./service-worker.js').catch(()=>{});


