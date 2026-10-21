'use strict';
const $ = s => document.querySelector(s);
const PAGE_SIZE = 12;
const state = {mode:'item',kind:'item',page:0,total:0,selected:null,rows:[],local:null,version:0,detailVersion:0,metadata:{}};
const modes={item:['전체 아이템 검색','아이템을 검색하고 능력치와 획득 정보를 확인하세요.'],equipment:['장비 검색','착용 부위와 요구 레벨로 장비를 찾아보세요.'],monster:['몬스터 검색','몬스터 이미지, 출현 장소와 드롭 아이템을 확인하세요.'],drops:['아이템 드롭처 찾기','직접 드롭 정보가 등록된 아이템과 몬스터를 찾아보세요.'],recipes:['조합 아이템','제작 가능한 아이템의 재료, 비용과 성공률을 확인하세요.'],draws:['뽑기 아이템','뽑기 상자의 보상 아이템과 설정 확률을 확인하세요.']};
const preview = location.hostname === '127.0.0.1' && new URLSearchParams(location.search).get('preview') === '1';
const categories = ['장비','소비·사용','상태·이벤트','제작·보상','화폐'];
const esc = x => String(x ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = n => Number(n).toLocaleString('ko-KR');
const rate = n => Number(n).toLocaleString('ko-KR',{maximumFractionDigits:8})+'%';
const normalize = s => s.replace(/\s/g,'');
function image(path) {
  return path && /^assets\/[A-Za-z0-9_./-]+\.png$/.test(path) && !path.includes('..') ? `<img loading="lazy" src="${esc(path)}" alt="">` : '<span aria-hidden="true">✧</span>';
}
function level(e){return e.level == null ? '레벨 정보 없음' : `Lv. ${e.level}${e.data?.max_level > e.level ? '–'+e.data.max_level : ''}`;}
async function request(params, count=false) {
  const response = await fetch(`${PINE_CONFIG.url}/rest/v1/pine_entries?${params}`, {headers:{apikey:PINE_CONFIG.key,...(count?{Prefer:'count=exact'}:{})},signal:AbortSignal.timeout(15000)});
  if(!response.ok){const error=new Error('데이터를 불러오지 못했습니다.');error.status=response.status;throw error;}
  return {rows:await response.json(),total:Number(response.headers.get('content-range')?.split('/')[1] || 0)};
}
async function search() {
  const version=++state.version;
  const query=normalize($('#search').value.trim()),cat=$('#category').value,max=$('#level').value,min=$('#minlevel').value,sub=$('#subcategory').value;
  const flag={recipes:'has_recipe',drops:'has_drop',draws:'has_draw'}[state.mode];
  $('#count').textContent='검색 중…'; $('#list').setAttribute('aria-busy','true'); $('#prev').disabled=true;$('#next').disabled=true;
  try {
    let rows,total;
    if(preview){
      if(!state.local){const r=await fetch('/__preview/entries.json');if(!r.ok)throw new Error('preview');state.local=await r.json();}
      const all=state.local.filter(e=>e.kind===state.kind && (!flag||e.data[flag]) && (state.mode!=='equipment'||e.category==='장비') && (!query||e.search_name.includes(query)) && (!cat||e.category===cat) && (!sub||e.data.subcategory===sub) && (!min||(e.level!=null&&e.level>=Number(min))) && (!max || (e.level!=null&&e.level<=Number(max)))).sort((a,b)=>a.name.localeCompare(b.name,'ko')||a.id.localeCompare(b.id));
      total=all.length;rows=all.slice(state.page*PAGE_SIZE,(state.page+1)*PAGE_SIZE);
    } else {
      const p=new URLSearchParams({select:'kind,id,name,category,level,data',kind:'eq.'+state.kind,order:'name.asc,id.asc',offset:state.page*PAGE_SIZE,limit:PAGE_SIZE});
      if(query)p.set('search_name','ilike.*'+query.replace(/[\\%_*]/g,'\\$&')+'*');
      if(cat)p.set('category','eq.'+cat);
      if(state.mode==='equipment')p.set('category','eq.장비');
      if(sub)p.set('data->>subcategory','eq.'+sub);
      if(flag)p.set('data->>'+flag,'eq.true');
      if(min)p.append('level','gte.'+Number(min));if(max)p.append('level','lte.'+Number(max));
      const result=await request(p,true);rows=result.rows;total=result.total;
    }
    if(version!==state.version)return;
    state.rows=rows;state.total=total;
    $('#connection').textContent=preview?'미리보기 · 로컬 원본 데이터로 표시 중입니다. Supabase 등록 후 공개 버전에서 사용할 수 있습니다.':'';
    $('#count').textContent=`검색 결과 ${num(total)}건`;
    $('#list').innerHTML=rows.length?rows.map((e,n)=>`<button class="row ${state.selected===e.kind+':'+e.id?'selected':''}" data-row="${n}"><span class="icon">${image(e.data.image)}</span><span class="text"><b>${esc(e.name)}</b><small>${esc(e.data.subcategory||e.category)} · ${esc(level(e))}</small></span><span class="arrow" aria-hidden="true">›</span></button>`).join(''):'<div class="errorbox">검색 결과가 없습니다.<br>이름 일부를 입력하거나 분류와 레벨 조건을 초기화해 보세요.</div>';
    $('#page').textContent=`${state.page+1} / ${Math.max(1,Math.ceil(total/PAGE_SIZE))}`;
    $('#prev').disabled=state.page===0;$('#next').disabled=(state.page+1)*PAGE_SIZE>=total;
  } catch(error){
    if(version!==state.version)return;
    $('#count').textContent='데이터 연결 확인 필요';
    const message=error.status===404?'Supabase에 도감 데이터가 아직 등록되지 않았습니다. 함께 제공된 안내서에 따라 SQL 파일을 순서대로 실행해 주세요.':error.status===401||error.status===403?'Supabase 연결 키 또는 읽기 권한을 확인해 주세요.':'연결이 지연되거나 서버에 접근할 수 없습니다. 인터넷 연결과 Supabase 프로젝트 상태를 확인해 주세요.';
    $('#list').innerHTML=`<div class="errorbox">${message}<p><button id="retry">다시 연결</button></p></div>`;
    $('#retry').onclick=search;
  } finally {if(version===state.version)$('#list').removeAttribute('aria-busy');}
}
function related(kind,id,name,label,path){return `<div class="linkrow"><span class="icon">${image(path)}</span>${id!=null?`<button data-kind="${kind}" data-id="${esc(id)}">${esc(name)}</button>`:`<b>${esc(name)}</b>`}<span>${esc(label)}</span></div>`;}
function show(e) {
  ++state.detailVersion;state.selected=e.kind+':'+e.id;
  document.querySelectorAll('[data-row]').forEach(b=>b.classList.toggle('selected',state.rows[Number(b.dataset.row)]?.id===e.id&&state.rows[Number(b.dataset.row)]?.kind===e.kind));
  const d=e.data;
  let html=`<div class="detail-top"><span class="icon">${image(d.image)}</span><div><span class="tag">${esc(d.subcategory||e.category)}</span><h2>${esc(e.name)}</h2><span class="note">${esc(level(e))}</span></div></div>`;
  if(e.kind==='item' && state.mode==='drops'){
    html+=`<p class="description">${esc(d.description||'')}</p><h3>드롭 몬스터</h3>`;
    html+=d.drops.length?d.drops.map(m=>related('monster',m.id,m.name,rate(m.rate),m.image)).join(''):'<p class="note">이 데이터에 등록된 직접 드롭 정보가 없습니다.</p>';
  } else if(e.kind==='item'){
    html+=`<p class="description">${esc(d.description||'등록된 설명이 없습니다.')}</p>`;
    if(d.options)html+=`<h3>장비 능력치</h3><div class="options">${esc(d.options)}</div>`;
    html+=`<h3>조합식 <span class="note">${d.recipes.length}개</span></h3>`;
    html+=d.recipes.length?d.recipes.map((r,n)=>`<div class="recipe"><div class="recipe-head"><b>제작 방법 ${n+1}</b><span>기본 성공률 ${num(r.success)}%</span></div>${r.ingredients.map(i=>related('item',i.id,i.name,num(i.quantity)+'개',i.image)).join('')}<div class="linkrow"><b>필요 SEED</b><span>${num(r.seed)}</span></div></div>`).join(''):'<p class="note">이 데이터에 등록된 조합식이 없습니다.</p>';
    html+='<h3>드롭 몬스터</h3>';
    html+=d.drops.length?d.drops.map(m=>related('monster',m.id,m.name,rate(m.rate),m.image)).join(''):'<p class="note">이 데이터에 등록된 직접 드롭 정보가 없습니다.</p>';
    if(d.draw_rewards?.length){html+='<h3>뽑기 보상</h3><p class="note">상자 원본 설정 기준 확률 · 몬스터 드롭 35배는 적용하지 않습니다.</p>';html+=d.draw_rewards.map(i=>related('item',i.id,i.name,num(i.quantity)+'개 · '+rate(i.rate),i.image)).join('');}
  } else {
    html+=`<p class="description">HP ${num(d.hp)} · 경험치 ${num(d.exp)}</p><h3>출현 장소</h3><p class="note">${esc(d.maps.join(' · ')||'등록된 출현 장소가 없습니다.')}</p><h3>드롭 아이템</h3>`;
    html+=d.drops.length?d.drops.map(i=>related('item',i.id,i.name,rate(i.rate),i.image)).join(''):'<p class="note">등록된 직접 드롭 정보가 없습니다.</p>';
  }
  html+='<p class="note">드롭 확률은 35배 설정을 적용한 예상값입니다. 조합 성공률은 추가 보정 전 기준입니다.</p>';
  $('#detail').innerHTML=html;$('#detail').scrollTop=0;
  if(window.innerWidth<800)$('#detail').scrollIntoView({behavior:'smooth',block:'start'});
}
async function openEntry(kind,id) {
  const version=++state.detailVersion;
  try {
    const entry=preview?state.local.find(e=>e.kind===kind&&e.id===String(id)):(await request(new URLSearchParams({select:'*',kind:'eq.'+kind,id:'eq.'+id,limit:1}))).rows[0];
    if(version!==state.detailVersion)return;
    if(entry)show(entry);else throw new Error('missing');
  }catch{if(version===state.detailVersion)$('#detail').innerHTML='<p class="errorbox">상세 정보를 불러오지 못했습니다. 목록에서 다시 선택해 주세요.</p>';}
}
$('#list').addEventListener('click',ev=>{const b=ev.target.closest('[data-row]');if(b)show(state.rows[Number(b.dataset.row)]);});
$('#detail').addEventListener('click',ev=>{const b=ev.target.closest('[data-id]');if(b)openEntry(b.dataset.kind,b.dataset.id);});
let timer;
$('#search').addEventListener('input',()=>{clearTimeout(timer);++state.version;timer=setTimeout(()=>{state.page=0;search();},250);});
function refreshSubcategories(){const cat=$('#category').value;const subs=cat?(state.metadata[cat]||[]):[...new Set(Object.values(state.metadata).flat())].sort();$('#subcategory').innerHTML='<option value="">전체 하위 분류</option>'+subs.map(c=>`<option>${esc(c)}</option>`).join('');}
for(const id of ['category','subcategory','minlevel','level'])$('#'+id).addEventListener('change',()=>{if(id==='category')refreshSubcategories();state.page=0;search();});
$('#prev').onclick=()=>{if(state.page){state.page--;search();}};
$('#next').onclick=()=>{if((state.page+1)*PAGE_SIZE<state.total){state.page++;search();}};
$('#reset').onclick=()=>{switchMode(state.mode);search();};
function switchMode(mode){state.mode=mode;state.kind=mode==='monster'?'monster':'item';state.page=0;state.selected=null;++state.detailVersion;$('#search').value='';$('#category').value=mode==='equipment'?'장비':'';$('#level').value='';$('#minlevel').value='';$('#category').disabled=mode==='monster'||mode==='equipment';$('#subcategory').disabled=mode==='monster';refreshSubcategories();$('#mode-title').textContent=modes[mode][0];$('#mode-description').textContent=modes[mode][1];$('#search').placeholder=mode==='monster'?'몬스터 이름 검색':'아이템 이름 검색';$('#detail').innerHTML='<div class="empty"><span>✧</span><h2>목록에서 항목을 선택하세요.</h2><p>이미지와 상세 정보를 확인할 수 있습니다.</p></div>';document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode===mode);b.setAttribute('aria-pressed',b.dataset.mode===mode);});}
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{switchMode(b.dataset.mode);search();});
document.querySelectorAll('[data-query]').forEach(b=>b.onclick=()=>{switchMode('item');$('#search').value=b.dataset.query;search();});
document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault();$('#search').focus();}});
$('#category').innerHTML+=categories.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
switchMode('item');
search();
fetch('metadata.json').then(r=>{if(!r.ok)throw new Error('metadata');return r.json();}).then(data=>{state.metadata=data;refreshSubcategories();}).catch(()=>{$('#subcategory').disabled=true;});
