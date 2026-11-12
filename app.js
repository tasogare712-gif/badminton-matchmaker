const STORAGE_KEY = 'badminton-matchmaker-v1';
const defaultNames = ['佐藤','鈴木','高橋','田中','伊藤','渡辺','山本','中村'];
const initialState = { players: defaultNames.map((name) => ({ id: crypto.randomUUID(), name })), courts: 2, round: 0, matches: [] };
let state = loadState();
const $ = (selector) => document.querySelector(selector);
function loadState() {
  try { const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); if (saved && Array.isArray(saved.players)) return { ...initialState, ...saved }; } catch {}
  return structuredClone(initialState);
}
function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function escapeHTML(value) { return value.replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function showNotice(message, title = 'お知らせ') { $('#dialog-title').textContent = title; $('#dialog-message').textContent = message; $('#notice-dialog').showModal(); }
function renderCourts() { $('#court-picker').innerHTML = [1,2,3,4].map((n) => `<button type="button" class="court-option ${state.courts === n ? 'selected' : ''}" aria-pressed="${state.courts === n}" data-courts="${n}">${n}面<span>${n === 1 ? 'ゆったり' : n === 4 ? 'フル稼働' : '同時進行'}</span></button>`).join(''); }
function renderPlayers() {
  $('#profile-list').innerHTML = state.players.length ? state.players.map((p, index) => `<div class="profile-row"><span class="avatar" aria-label="参加者番号 ${index + 1}">${index + 1}</span><span class="profile-name">${escapeHTML(p.name)}</span><button class="remove-player" data-remove="${p.id}" aria-label="${escapeHTML(p.name)}を削除" type="button">×</button></div>`).join('') : '<div class="empty-state">参加者を追加してください</div>';
  $('#player-count').textContent = `${state.players.length}人登録中`;
  $('#start-button').disabled = state.players.length < 4;
  $('#start-button').textContent = state.players.length < 4 ? `あと${4-state.players.length}人追加してください` : '🏸　対戦表を作成';
}
function openSetup() { $('#matches-view').classList.add('hidden'); $('#setup-view').classList.remove('hidden'); $('.nav-item[data-view="matches"]').classList.remove('active'); $('.nav-item[data-view="players"]').classList.add('active'); window.scrollTo({top:0,behavior:'smooth'}); }
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
  $('#round-number').textContent=String(state.round); $('#summary-courts').textContent=`${state.courts}面`; $('#summary-players').textContent=`${state.players.length}人`;
  const data=state.matches[state.round-1]; if(!data){$('#match-list').innerHTML='<div class="empty-state">対戦表を作成すると、ここに試合が表示されます。</div>';$('#round-message').textContent='参加者とコート数を設定して対戦表を作成しましょう。';return;}
  const names=new Map(state.players.map((p)=>[p.id,p.name])); const name=(id)=>escapeHTML(names.get(id)||'退会済み');
  $('#round-message').textContent=`第${state.round}ラウンド｜${data.courts.length}試合`;
  $('#match-list').innerHTML=data.courts.map((m)=>`<article class="match-card"><div class="match-card-head"><span class="court-name">コート ${m.court}</span><span class="match-tag">ダブルス</span></div><div class="versus-layout"><div class="team">${m.team1.map((id)=>`<span class="player-chip">${name(id)}</span>`).join('')}</div><span class="versus">VS</span><div class="team">${m.team2.map((id)=>`<span class="player-chip">${name(id)}</span>`).join('')}</div></div></article>`).join('') + (data.rest.length?`<div class="rest-card"><div class="rest-title">⏸ 今回のお休み · ${data.rest.length}人</div><div class="rest-names">${data.rest.map((id)=>`<span class="rest-chip">${name(id)}</span>`).join('')}</div></div>`:'');
}
$('#court-picker').addEventListener('click',(event)=>{const button=event.target.closest('[data-courts]');if(!button)return;state.courts=Number(button.dataset.courts);save();renderCourts();});
$('#add-form').addEventListener('submit',(event)=>{event.preventDefault();const input=$('#new-player');const name=input.value.trim();if(!name)return;if(state.players.some((p)=>p.name.toLocaleLowerCase()===name.toLocaleLowerCase())){showNotice('同じ名前の参加者が登録されています。');return;}state.players.push({id:crypto.randomUUID(),name});input.value='';save();renderPlayers();});
$('#profile-list').addEventListener('click',(event)=>{const button=event.target.closest('[data-remove]');if(!button)return;state.players=state.players.filter((p)=>p.id!==button.dataset.remove);save();renderPlayers();});
$('#clear-players').addEventListener('click',()=>{if(!state.players.length)return;state.players=[];state.matches=[];state.round=0;save();renderPlayers();});
$('#start-button').addEventListener('click',()=>{state.matches=[];state.round=0;makeRound();});
$('#next-round').addEventListener('click',()=>{if(state.matches.length<=state.round)makeRound();else{state.round+=1;save();renderMatches();window.scrollTo({top:0,behavior:'smooth'});}});
$('#edit-setup').addEventListener('click',openSetup);
document.querySelectorAll('.nav-item').forEach((button)=>button.addEventListener('click',()=>{if(button.dataset.view==='matches')openMatches();else if(button.dataset.view==='players')openSetup();else{const ok=confirm('参加者と対戦履歴をリセットしますか？');if(ok){state={...structuredClone(initialState),players:[]};save();renderPlayers();renderCourts();openSetup();showNotice('練習会をリセットしました。','リセット完了');}}}));
renderCourts();renderPlayers();renderMatches();if(state.round>0)openMatches();

