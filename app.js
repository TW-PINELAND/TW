'use strict';
const INITIAL_BALANCE = 100000;
const config = window.CARD_CONFIG || {};
const configured = Boolean(config.supabaseUrl && config.publishableKey && config.boardKey);
let records = [], cardNumbers = ['', '', ''], selectedCard = null, loaded = false, busy = false, refreshing = false, toastTimer, pending = null;
const $ = selector => document.querySelector(selector);
const money = value => value.toLocaleString('ko-KR');
const cardName = index => `카드 ${String(index + 1).padStart(2, '0')}`;
const balance = index => INITIAL_BALANCE - records.filter(r => r.card === index).reduce((sum, r) => sum + r.amount, 0);
function notify(message) {
  $('#toast').textContent = message; $('#toast').classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4000);
}
async function rpc(name, params = {}) {
  const response = await fetch(`${config.supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
    method:'POST', headers:{'Content-Type':'application/json', apikey:config.publishableKey},
    body:JSON.stringify({p_key:config.boardKey, ...params}), signal:AbortSignal.timeout(15000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'CONNECTION_FAILED');
  if (!Array.isArray(data)) throw new Error('INVALID_RESPONSE');
  return data;
}
function errorMessage(error) {
  if (error.message.includes('INSUFFICIENT_BALANCE')) return '잔액이 부족해요. 다른 사람이 입력한 최신 내역을 확인해 주세요.';
  if (error.message.includes('INVALID_CARD_NUMBER')) return '카드번호 끝 4자리를 숫자로 입력해 주세요.';
  if (error.message.includes('BOARD_NOT_FOUND')) return '기록장 연결 정보가 맞지 않아요. config.js의 boardKey를 확인해 주세요.';
  return '연결하지 못했어요. 인터넷과 저장소 설정을 확인한 뒤 다시 시도해 주세요.';
}
function enteredAmount() { const raw = $('#amount').value.replaceAll(',', ''); return /^\d+$/.test(raw) ? Number(raw) : 0; }
function updateEstimate() {
  if (selectedCard === null) return;
  $('#available').textContent = loaded ? `${money(balance(selectedCard))}원` : '연결 대기 중';
  $('#after-balance').textContent = loaded ? `${money(balance(selectedCard) - enteredAmount())}원` : '연결 대기 중';
}
function render() {
  $('#total').innerHTML = loaded ? `${money([0,1,2].reduce((sum, i) => sum + balance(i), 0))}<span>원</span>` : '—<span>원</span>';
  document.querySelectorAll('[data-card]').forEach((button, i) => {
    button.setAttribute('aria-selected', String(selectedCard === i)); button.tabIndex = selectedCard === null || selectedCard === i ? 0 : -1;
    $(`[data-balance="${i}"]`).innerHTML = loaded ? `${money(balance(i))}<small>원</small>` : '—<small>원</small>';
    $(`[data-card-number="${i}"]`).textContent = loaded ? (cardNumbers[i] ? `끝자리 •••• ${cardNumbers[i]}` : '끝 4자리 미등록') : '번호 연결 대기';
    $(`[data-spent="${i}"]`).textContent = loaded ? `사용 ${money(INITIAL_BALANCE - balance(i))}원` : '연결 대기 중';
    $(`[data-meter="${i}"]`).style.width = `${loaded ? balance(i) / INITIAL_BALANCE * 100 : 0}%`;
  });
  $('#welcome').hidden = selectedCard !== null; $('#history').hidden = selectedCard === null;
  if (selectedCard === null) return;
  $('#history').setAttribute('aria-labelledby', `tab-${selectedCard}`); $('#history-card').textContent = `CARD ${String(selectedCard + 1).padStart(2, '0')}${cardNumbers[selectedCard] ? ` · •••• ${cardNumbers[selectedCard]}` : ''}`;
  $('#edit-card-number').textContent = cardNumbers[selectedCard] ? '카드번호 변경' : '카드번호 등록';
  const entries = records.filter(r => r.card === selectedCard).sort((a,b) => b.date.localeCompare(a.date));
  $('#count').textContent = loaded ? `${entries.length}건` : ''; $('#entries').replaceChildren();
  if (!entries.length) {
    const empty = document.createElement('p'); empty.className = 'empty';
    empty.textContent = loaded ? '아직 사용내역이 없어요. 첫 사용 금액을 기록해 보세요.' : '공유 저장소를 연결하면 사용내역이 표시됩니다.'; $('#entries').append(empty);
  }
  entries.forEach(record => {
    const row = document.createElement('div'); row.className = 'entry';
    const icon = document.createElement('span'); icon.className = 'entry-icon'; icon.textContent = '↗'; icon.setAttribute('aria-hidden','true');
    const info = document.createElement('div'); info.className = 'entry-info';
    const memo = document.createElement('strong'); memo.textContent = record.memo || '카드 사용';
    const date = document.createElement('time'); date.dateTime = record.date; date.textContent = new Date(record.date).toLocaleString('ko-KR', {year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}); info.append(memo,date);
    const amount = document.createElement('span'); amount.className = 'entry-amount'; amount.textContent = `−${money(record.amount)}원`;
    const remove = document.createElement('button'); remove.className = 'delete-entry'; remove.textContent = '삭제'; remove.disabled = busy;
    remove.setAttribute('aria-label', `${record.memo || '카드 사용'} ${money(record.amount)}원 내역 삭제`);
    remove.addEventListener('click', async () => {
      if (busy || refreshing || !confirm(`${money(record.amount)}원 사용내역을 삭제할까요? 모든 사람의 화면에서 삭제되고 잔액이 복구됩니다.`)) return;
      busy = true; render();
      try { records = await rpc('card_delete', {p_id:record.id}); notify('사용내역을 삭제하고 잔액을 복구했어요.'); }
      catch (error) { notify(errorMessage(error)); }
      finally { busy = false; render(); }
    });
    row.append(icon,info,amount,remove); $('#entries').append(row);
  }); updateEstimate();
}
async function refresh() {
  if (!configured || busy || refreshing) return;
  refreshing = true;
  try {
    const [nextRecords, nextCardNumbers] = await Promise.all([rpc('card_read'), rpc('card_numbers_read')]);
    if (nextCardNumbers.length !== 3 || !nextCardNumbers.every(value => typeof value === 'string' && (/^\d{4}$/.test(value) || value === ''))) throw new Error('INVALID_RESPONSE');
    records = nextRecords; cardNumbers = nextCardNumbers; loaded = true; render();
    $('#storage-note').textContent = '공동 기록장 · 다른 사람의 입력도 5초마다 자동으로 반영됩니다.';
  }
  catch (error) { $('#storage-note').textContent = `${errorMessage(error)}${loaded ? ' 마지막으로 불러온 내역을 표시 중입니다.' : ''}`; }
  finally { refreshing = false; }
}
function openEntry(index) {
  selectedCard = index; render(); $('#entry-form').reset(); pending = null; $('#dialog-card').textContent = cardName(index);
  $('#form-error').textContent = configured ? '' : '공동 기록을 시작하려면 공유 저장소 연결이 필요합니다.';
  updateEstimate(); $('#entry-dialog').showModal(); $('#amount').focus();
}
function openNumberDialog() {
  if (selectedCard === null) return;
  $('#number-form').reset(); $('#number-dialog-card').textContent = cardName(selectedCard);
  $('#card-number-input').value = cardNumbers[selectedCard] || ''; $('#number-error').textContent = '';
  $('#number-dialog').showModal(); $('#card-number-input').focus();
}
document.querySelectorAll('[data-card]').forEach((button,i) => {
  button.addEventListener('click', () => openEntry(i));
  button.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault(); selectedCard = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (i + (event.key === 'ArrowRight' ? 1 : 2)) % 3; render(); $(`#tab-${selectedCard}`).focus();
  });
});
$('#add-entry').addEventListener('click', () => openEntry(selectedCard));
$('#edit-card-number').addEventListener('click', openNumberDialog);
$('#close-dialog').addEventListener('click', () => { if (!busy) $('#entry-dialog').close(); });
$('#entry-dialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
$('#entry-dialog').addEventListener('close', () => { if (selectedCard !== null) $(`#tab-${selectedCard}`).focus(); });
$('#close-number-dialog').addEventListener('click', () => { if (!busy) $('#number-dialog').close(); });
$('#number-dialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
$('#number-dialog').addEventListener('close', () => { if (selectedCard !== null) $('#edit-card-number').focus(); });
$('#card-number-input').addEventListener('input', event => { event.target.value = event.target.value.replace(/\D/g, '').slice(0, 4); $('#number-error').textContent = ''; });
$('#amount').addEventListener('input', () => { updateEstimate(); if (configured) $('#form-error').textContent = ''; });
document.querySelectorAll('[data-add]').forEach(button => button.addEventListener('click', () => { $('#amount').value = money(enteredAmount() + Number(button.dataset.add)); updateEstimate(); $('#amount').focus(); }));
$('#clear-amount').addEventListener('click', () => { $('#amount').value = ''; updateEstimate(); $('#amount').focus(); });
$('#entry-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  if (!configured || !loaded) { $('#form-error').textContent = '공유 저장소에 연결된 후 기록할 수 있어요.'; return; }
  if (refreshing) { $('#form-error').textContent = '최신 내역을 불러오는 중입니다. 잠시 후 다시 눌러 주세요.'; return; }
  const amount = enteredAmount(), memo = $('#memo').value.trim();
  if (!Number.isSafeInteger(amount) || amount <= 0) { $('#form-error').textContent = '1원 이상의 금액을 숫자로 입력해 주세요.'; $('#amount').focus(); return; }
  const fingerprint = JSON.stringify([selectedCard,amount,memo]), isRetry = pending?.fingerprint === fingerprint;
  if (!isRetry && amount > balance(selectedCard)) { $('#form-error').textContent = `남은 금액 ${money(balance(selectedCard))}원보다 많이 입력할 수 없어요.`; $('#amount').focus(); return; }
  // 같은 요청을 재전송해도 서버에서 중복 차감을 방지합니다.
  if (!isRetry) pending = {fingerprint, id:crypto.randomUUID()};
  busy = true; $('#form-error').textContent = '';
  const controls = [...$('#entry-form').querySelectorAll('button,input')]; controls.forEach(c => c.disabled = true); $('.submit').textContent = '기록하는 중…';
  try { records = await rpc('card_add', {p_id:pending.id,p_card:selectedCard,p_amount:amount,p_memo:memo}); pending = null; render(); $('#entry-dialog').close(); notify(`${cardName(selectedCard)} · ${money(amount)}원을 기록했어요.`); }
  catch (error) { $('#form-error').textContent = errorMessage(error); }
  finally { busy = false; controls.forEach(c => c.disabled = false); $('.submit').textContent = '사용 금액 기록하기'; render(); }
});
$('#number-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  if (!configured || !loaded) { $('#number-error').textContent = '공유 저장소에 연결된 후 저장할 수 있어요.'; return; }
  const number = $('#card-number-input').value.trim();
  if (!/^\d{4}$/.test(number)) { $('#number-error').textContent = '카드번호 끝 4자리를 숫자로 입력해 주세요.'; $('#card-number-input').focus(); return; }
  busy = true; const controls = [...$('#number-form').querySelectorAll('button,input')]; controls.forEach(control => control.disabled = true);
  $('#number-form .submit').textContent = '저장하는 중…';
  try { cardNumbers = await rpc('card_number_update', {p_card:selectedCard,p_number:number}); render(); $('#number-dialog').close(); notify(`${cardName(selectedCard)} 번호를 저장했어요.`); }
  catch (error) { $('#number-error').textContent = errorMessage(error); }
  finally { busy = false; controls.forEach(control => control.disabled = false); $('#number-form .submit').textContent = '카드번호 저장하기'; render(); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
window.addEventListener('online', refresh);
render();
if (configured) refresh(); else $('#storage-note').textContent = '공유 저장소 연결 준비 중 · 연결을 완료하면 모두가 같은 사용내역과 잔액을 확인하고 입력할 수 있습니다.';
setInterval(() => { if (!document.hidden) refresh(); }, 5000);
