(() => {
'use strict';

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const money = n => n == null ? '—' : '¥' + Math.round(Number(n)||0).toLocaleString('ja-JP');
const num = n => Number(n||0).toLocaleString('ja-JP');
const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmt = d => d ? new Date(d).toLocaleString('ja-JP', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';
const fmtDate = d => d ? new Date(d).toLocaleDateString('ja-JP') : '—';
const roles = ['CEO','COO','GENERAL MANAGER','DIRECTOR','STAFF','LOOKIE'];
const depts = ['FARMING DIVISION','PRODUCTION DIVISION','SALES DIVISION'];
const adminPages = new Set(['employees','inventory','cash','audit','settings']);
const navItems = [
  ['dashboard','02','DASHBOARD','ダッシュボード'],['farming','03','FARMING','素材管理'],['production','04','PRODUCTION','生産管理'],['sales','05','SALES','販売管理'],['payroll','06','PAYROLL','給与管理'],['employees','07','EMPLOYEES','従業員管理'],['performance','08','PERFORMANCE','実績分析'],['inventory','09','INVENTORY','在庫管理'],['cash','10','COMPANY CASH','会社現金'],['activity','11','ACTIVITY LOG','業務履歴'],['audit','12','AUDIT LOG','監査ログ'],['settings','13','SETTINGS','設定']
];
const subs = {dashboard:'会社概要 / 管理コンソール',farming:'素材納品 / 個人別数量',production:'製造登録 / 給与15%',sales:'販売登録 / 給与25%',payroll:'給与 / 支給管理',employees:'従業員 / アクセス管理',performance:'個人実績 / 分析',inventory:'会社保有在庫 / 資産管理',cash:'現金 / 入出金管理',activity:'業務記録 / 修正',audit:'管理操作 / 監査履歴',settings:'システム / 会社設定'};

let client = null;
let token = localStorage.getItem('nexus_session_token') || '';
let state = null;
let currentPage = 'dashboard';
let initialized = true;
let busy = false;
let farmingRows = [];
let perfEmployeeId = '';
let prodPrice = 500000, prodQty = 1000;
let salesPrice = 500000, salesQty = 1000;
let prodSelected = new Set(), salesSelected = new Set();

function show(el, yes=true){ el?.classList.toggle('hidden', !yes); }
function toast(msg){ const t=$('#toast'); $('span',t).textContent=msg; t.classList.add('show'); clearTimeout(t._timer); t._timer=setTimeout(()=>t.classList.remove('show'),2600); }
function setBusy(v){ busy=v; $('#loading').classList.toggle('show',v); }
function errText(e){
  const m = String(e?.message || e || 'ERROR');
  const map = {
    'SESSION_INVALID':'セッションの有効期限が切れました。再ログインしてください。',
    'FORBIDDEN':'この操作を行う権限がありません。',
    'PIN_MUST_BE_4_DIGITS':'PINは4桁の数字にしてください。',
    'INSUFFICIENT_CASH':'会社CASH残高が不足しています。',
    'INSUFFICIENT_INVENTORY':'会社保有ECSTASYが不足しています。',
    'PAID_RECORD_REQUIRES_ADJUSTMENT':'支給済み給与がある記録はVOIDできません。調整処理が必要です。',
    'INVENTORY_ALREADY_CONSUMED':'このSALESから取得した会社在庫がすでに売却されています。',
    'DUPLICATE_PARTICIPANT':'同じ従業員が重複して選択されています。',
    'NO_UNPAID_ITEMS':'未払い明細が選択されていません。',
    'RATE_LIMITED':'操作回数が多すぎます。少し待ってから再試行してください。',
    'ORIGIN_NOT_ALLOWED':'許可されていないアクセス元です。',
    'CURRENT_PIN_INVALID':'現在のPINが正しくありません。',
    'NEW_PIN_MUST_DIFFER':'新しいPINは現在のPINと違う番号にしてください。',
    'LAST_ADMIN_REQUIRED':'最後の管理者を退職・降格させることはできません。先に別の管理者を作成してください。',
    'PAYMENT_TOTAL_MUST_BE_POSITIVE':'選択した給与の合計が0円以下です。マイナス調整はプラス給与と合わせて処理してください。',
    'ADJUSTMENT_AMOUNT_REQUIRED':'調整額を入力してください。',
    'ADJUSTMENT_REASON_REQUIRED':'給与調整の理由を入力してください。'
  };
  for(const [k,v] of Object.entries(map)) if(m.includes(k)) return v;
  return m.replace(/^.*?: /,'');
}
async function rpc(name, args={}){
  const c=window.NEXUS_CONFIG||{};
  const base=String(c.supabaseUrl||'').replace(/\/$/,'');
  const res=await fetch(base+'/functions/v1/nexus-api',{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'apikey':c.supabaseAnonKey,
      'Authorization':'Bearer '+c.supabaseAnonKey
    },
    body:JSON.stringify({rpc:name,args}),
    cache:'no-store'
  });
  let payload={};
  try{ payload=await res.json(); }catch{}
  if(!res.ok || payload?.error) throw new Error(payload?.error || ('HTTP_'+res.status));
  return payload?.data;
}
function configReady(){
  const c=window.NEXUS_CONFIG||{};
  return /^https:\/\/.+\.supabase\.co\/?$/.test(c.supabaseUrl||'') && c.supabaseAnonKey && !String(c.supabaseAnonKey).includes('YOUR_');
}

async function boot(){
  if(!configReady()) { show($('#configScreen')); return; }
  try{
    const st=await rpc('system_status');
    initialized=!!st.initialized;
    $('#dbStatus').textContent='ONLINE';
    show($('#configScreen'),false);
    if(token){
      try { await loadState(); openApp(); return; } catch(e){ localStorage.removeItem('nexus_session_token'); token=''; }
    }
    renderLoginMode(); show($('#loginScreen'));
  }catch(e){
    show($('#loginScreen')); $('#dbStatus').textContent='ERROR'; loginMessage('DB接続に失敗しました: '+errText(e),'danger');
  }
}
function renderLoginMode(){
  if(initialized){
    $('#loginTitle').textContent='SECURE ACCESS'; $('#loginLead').textContent='名前と4桁PINを入力してください。'; show($('#loginBtn')); show($('#bootstrapBtn'),false);
  }else{
    $('#loginTitle').textContent='FIRST SETUP'; $('#loginLead').textContent='まだ従業員がいません。最初のCEOアカウントを作成します。'; show($('#loginBtn'),false); show($('#bootstrapBtn'));
  }
}
function loginMessage(msg,type='warn'){ const el=$('#loginMessage'); el.className='notice '+type; el.textContent=msg; show(el); }
async function login(){
  const name=$('#loginName').value.trim(), pin=$('#loginPin').value.trim();
  if(!name || !/^\d{4}$/.test(pin)) return loginMessage('名前と4桁PINを入力してください。','warn');
  try{setBusy(true); const res=await rpc('login_employee',{p_name:name,p_pin:pin});
    if(!res?.ok){
      if(res?.error==='LOCKED') return loginMessage('ログイン試行上限に達しました。約15分後に再試行してください。','danger');
      return loginMessage(`認証できませんでした。${res?.attempts_remaining!=null?' 残り'+res.attempts_remaining+'回':''}`,'danger');
    }
    token=res.token; localStorage.setItem('nexus_session_token',token); await loadState(); openApp();
  }catch(e){ loginMessage(errText(e),'danger'); } finally{setBusy(false)}
}
async function bootstrap(){
  const name=$('#loginName').value.trim(), pin=$('#loginPin').value.trim();
  if(!name || !/^\d{4}$/.test(pin)) return loginMessage('最初のCEO名と4桁PINを入力してください。','warn');
  try{setBusy(true); const res=await rpc('bootstrap_first_admin',{p_name:name,p_pin:pin}); token=res.token; localStorage.setItem('nexus_session_token',token); initialized=true; await loadState(); openApp(); toast('最初のCEOアカウントを作成しました');}
  catch(e){loginMessage(errText(e),'danger')} finally{setBusy(false)}
}
async function logout(){
  try{ if(token) await rpc('logout_employee',{p_session:token}); }catch{}
  token=''; state=null; localStorage.removeItem('nexus_session_token'); show($('#appShell'),false); show($('#loginScreen')); renderLoginMode();
}
async function loadState(){ state=await rpc('get_app_state',{p_session:token}); if(!state?.me) throw new Error('SESSION_INVALID'); }
async function refresh(){ try{setBusy(true); await loadState(); renderShell(); renderPage(); toast('最新データに更新しました');}catch(e){handleError(e)}finally{setBusy(false)} }
function handleError(e){ const m=errText(e); if(m.includes('セッション')){logout();} else toast(m); }
function openApp(){ show($('#loginScreen'),false); show($('#configScreen'),false); show($('#appShell')); renderShell(); renderPage(); }

function renderShell(){
  $('#sideUserName').textContent=state.me.name; $('#sideUserRole').textContent=`${state.me.role} / ${state.is_admin?'ADMIN ACCESS':'EMPLOYEE ACCESS'}`; $('#topRole').textContent=state.me.role;
  $('#nav').innerHTML=navItems.filter(n=>state.is_admin || !adminPages.has(n[0])).map(n=>`<button data-goto="${n[0]}" class="${currentPage===n[0]?'active':''}"><span class="nav-icon">${n[1]}</span><span class="nav-meta">${n[2]}<small>${n[3]}</small></span></button>`).join('');
  if(!state.is_admin && adminPages.has(currentPage)) currentPage='dashboard';
  setCrumb();
}
function setCrumb(){ const n=navItems.find(x=>x[0]===currentPage); $('#crumbTitle').textContent=n?.[2]||currentPage.toUpperCase(); $('#crumbSub').textContent=subs[currentPage]||''; $$('[data-goto]').forEach(b=>b.classList.toggle('active',b.dataset.goto===currentPage)); }
function go(page){ if(!state.is_admin && adminPages.has(page)) return; currentPage=page; setCrumb(); $('#sidebar').classList.remove('open'); renderPage(); window.scrollTo({top:0,behavior:'smooth'}); }
function title(name,sub,actions=''){ return `<div class="page-title"><div><h1>${name}</h1><p>${sub}</p></div><div class="actions">${actions}</div></div>`; }
function empty(msg='データがありません'){ return `<div class="big-empty"><b>${msg}</b><span>登録後にここへ反映されます。</span></div>`; }
function activeEmployees(){return state.employees.filter(e=>e.status==='ACTIVE')}
function mePerf(){return state.performance.find(p=>p.id===state.me.id)||{} }
function recordCode(r){return '#'+String(r.record_no||0).padStart(4,'0')}

function renderPage(){
  const fn={dashboard:dashboardPage,farming:farmingPage,production:productionPage,sales:salesPage,payroll:payrollPage,employees:employeesPage,performance:performancePage,inventory:inventoryPage,cash:cashPage,activity:activityPage,audit:auditPage,settings:settingsPage}[currentPage]||dashboardPage;
  $('#content').innerHTML=fn(); bindPage();
}

function dashboardPage(){
  const d=state.dashboard, p=mePerf(), recent=state.work_records.slice(0,6);
  const kpis=state.is_admin ? [
    ['TOTAL ASSETS',money(d.total_assets),'会社総資産'],['CASH RESERVE',money(d.cash),'会社現金'],['ECSTASY RESERVE',`${num(d.inventory_units)} units`,money(d.inventory_current_value)],['UNPAID PAYROLL',money(d.unpaid_payroll),'全社未払い']
  ] : [
    ['MY TOTAL SALARY',money(p.salary_total),'累計給与'],['MY PAID',money(p.salary_paid),'支給済み'],['MY UNPAID',money(p.salary_unpaid),'未払い'],['TOTAL ACTIVITY',num(p.total_activity)+' times','総稼働回数']
  ];
  return title('DASHBOARD','COMPANY OVERVIEW / MANAGEMENT CONSOLE',`<span class="badge ${state.is_admin?'admin':'active'}">${state.is_admin?'ADMIN':'EMPLOYEE'} VIEW</span>`) +
  `<div class="grid kpi4">${kpis.map(k=>`<div class="card kpi"><div class="label">${k[0]}</div><div class="value mono">${k[1]}</div><div class="trend muted">${k[2]}</div><div class="spark"></div></div>`).join('')}</div>
  <div class="grid two" style="margin-top:14px">
    <div class="card"><div class="card-title"><h3>REVENUE ALLOCATION / 売上配分</h3><span class="badge">FIXED</span></div><div class="alloc">${[['FARMING',40],['PRODUCTION',15],['SALES',25],['CASH',10],['ECSTASY',10]].map(a=>`<div class="item"><b>${a[0]}</b><div class="hero-number" style="font-size:22px;margin-top:8px">${a[1]}%</div><div class="bar"><i style="width:${a[1]}%"></i></div></div>`).join('')}</div></div>
    <div class="card"><div class="card-title"><h3>ECSTASY MARKET</h3><span class="badge active">LIVE SETTING</span></div><div class="hero-number">${money(state.settings.market_price)} <span class="small">/ pcs</span></div>${state.is_admin?`<div class="small" style="margin-top:10px">現在評価額 ${money(d.inventory_current_value)} / 評価損益 <b class="${d.unrealized_pl>=0?'success-text':'danger-text'}">${money(d.unrealized_pl)}</b></div>`:''}</div>
  </div>
  <div class="grid two" style="margin-top:14px">
    <div class="card"><div class="card-title"><h3>ACTIVITY SUMMARY</h3></div><div class="metric-row"><div class="metric"><span>FARMING</span><b>${num(d.farming_count)}</b></div><div class="metric"><span>PRODUCTION</span><b>${num(d.production_count)}</b></div><div class="metric"><span>SALES</span><b>${num(d.sales_count)}</b></div><div class="metric"><span>ACTIVE EMPLOYEES</span><b>${num(d.active_employees)}</b></div><div class="metric"><span>MARKET</span><b>${money(state.settings.market_price)}</b></div></div></div>
    <div class="card"><div class="card-title"><h3>RECENT ACTIVITY</h3><button class="btn ghost smallbtn" data-goto="activity">VIEW ALL</button></div>${recent.length?`<div class="timeline">${recent.map(r=>`<div class="timeline-item"><b>${recordCode(r)} ${r.type} / ${num(r.quantity)} ${r.type==='FARMING'?'units':'pcs'}</b><small>${fmt(r.created_at)} / ${r.status}</small></div>`).join('')}</div>`:empty()}</div>
  </div>`;
}

function ensureFarm(){ if(!farmingRows.length){farmingRows=[{employee_id:activeEmployees()[0]?.id||'', q:{}}];} }
function farmingPage(){
  ensureFarm();
  const admin=state.is_admin;
  const recent=state.work_records.filter(r=>r.type==='FARMING').slice(0,8);
  return title('FARMING','MATERIAL DELIVERY / INDIVIDUAL QUANTITY',admin?'<span class="badge admin">ADMIN REGISTER</span>':'<span class="badge">READ ONLY</span>')+
  (admin?`<div class="card admin-only"><div class="card-title"><h3>NEW FARMING RECORD</h3><button id="addFarmParticipant" class="btn ghost smallbtn">＋ 従業員を追加</button></div><div id="farmParticipants">${farmingRows.map((r,i)=>farmBlock(r,i)).join('')}</div><div class="summary-bar"><div class="stats"><span>PARTICIPANTS<b id="farmSumPeople">0</b></span><span>TOTAL UNITS<b id="farmSumUnits">0</b></span><span>PAYROLL<b id="farmSumPay">¥0</b></span></div><button id="registerFarm" class="btn primary">FARMING RECORDを登録 →</button></div></div>`:`<div class="notice">登録はCEO / COO / GENERAL MANAGERのみ可能です。実績はACTIVITY LOGとPERFORMANCEから確認できます。</div>`)+
  `<div class="section-head"><h2>RECENT FARMING RECORDS</h2></div>${recordsTable(recent)}`;
}
function farmBlock(r,i){
  return `<div class="participant-block" data-farm-index="${i}"><div class="participant-head"><select class="select farm-employee" style="max-width:360px">${employeeOptions(r.employee_id)}</select>${farmingRows.length>1?`<button class="btn danger smallbtn remove-farm" data-index="${i}">REMOVE</button>`:''}</div><div class="material-grid">${state.materials.map(m=>`<div class="material-input"><label>${esc(m.label)}<br>${money(m.unit_price)} / unit</label><input class="farm-q" data-code="${m.code}" type="number" min="0" step="1" value="${Number(r.q[m.code]||0)}"></div>`).join('')}</div></div>`;
}
function employeeOptions(selected=''){ return `<option value="">従業員を選択</option>`+activeEmployees().map(e=>`<option value="${e.id}" ${e.id===selected?'selected':''}>${esc(e.name)} / ${esc(e.role)}</option>`).join(''); }
function readFarmDom(){ return $$('.participant-block').map(b=>({employee_id:$('.farm-employee',b).value,materials:$$('.farm-q',b).map(i=>({code:i.dataset.code,quantity:Number(i.value||0)}))})); }
function farmCalc(){ const entries=readFarmDom(); let units=0,pay=0,people=0; entries.forEach(e=>{let u=0; e.materials.forEach(m=>{u+=m.quantity; pay+=m.quantity*(state.materials.find(x=>x.code===m.code)?.unit_price||0)});units+=u;if(e.employee_id&&u>0)people++;}); $('#farmSumPeople').textContent=people; $('#farmSumUnits').textContent=num(units); $('#farmSumPay').textContent=money(pay); }

function productionPage(){
  if(!prodSelected.size && activeEmployees()[0]) prodSelected.add(activeEmployees()[0].id);
  const gross=prodPrice*prodQty,pay=gross*.15,per=prodSelected.size?pay/prodSelected.size:0;
  return title('PRODUCTION','ECSTASY MANUFACTURING / PAYROLL 15%',state.is_admin?'<span class="badge admin">ADMIN REGISTER</span>':'<span class="badge">READ ONLY</span>')+
  (state.is_admin?`<div class="grid two"><div class="card admin-only"><div class="form-card"><h4>UNIT VALUE</h4><div id="prodPrice" class="price-options">${[300000,400000,500000].map(p=>`<button class="price ${p===prodPrice?'active':''}" data-price="${p}">${money(p)}</button>`).join('')}</div></div><div class="form-card" style="margin-top:10px"><h4>QUANTITY / 500刻み・MAX 10,000</h4><div class="qty-control"><button data-prod-dir="-1">−</button><input id="prodQty" value="${prodQty}" inputmode="numeric"><button data-prod-dir="1">＋</button></div></div><div class="calc-box" style="margin-top:10px"><div class="formula">${money(prodPrice)} × ${num(prodQty)} × 15%</div><div class="result">${money(pay)}</div><div class="small">${prodSelected.size}人選択 / 1人あたり 約 ${money(per)}</div></div></div><div class="card"><div class="card-title"><h3>PARTICIPANTS</h3><span class="badge">${prodSelected.size} PEOPLE</span></div>${participantChecks('prod',prodSelected)}<button id="registerProduction" class="btn primary block" style="margin-top:12px">PRODUCTION RECORDを登録 →</button></div></div>`:`<div class="notice">製造登録は管理者のみです。</div>`)+
  `<div class="section-head"><h2>RECENT PRODUCTION</h2></div>${recordsTable(state.work_records.filter(r=>r.type==='PRODUCTION').slice(0,8))}`;
}
function salesPage(){
  if(!salesSelected.size && activeEmployees()[0]) salesSelected.add(activeEmployees()[0].id);
  const gross=salesPrice*salesQty,pay=gross*.25,per=salesSelected.size?pay/salesSelected.size:0,cash=gross*.1,reserve=salesQty*.1;
  return title('SALES','ECSTASY SALES / REVENUE DISTRIBUTION',state.is_admin?'<span class="badge admin">ADMIN REGISTER</span>':'<span class="badge">READ ONLY</span>')+
  (state.is_admin?`<div class="grid two"><div class="card admin-only"><div class="form-card"><h4>SALE PRICE</h4><div id="salesPrice" class="price-options">${[300000,400000,500000].map(p=>`<button class="price ${p===salesPrice?'active':''}" data-price="${p}">${money(p)}</button>`).join('')}</div></div><div class="form-card" style="margin-top:10px"><h4>QUANTITY / 500刻み・MAX 10,000</h4><div class="qty-control"><button data-sales-dir="-1">−</button><input id="salesQty" value="${salesQty}" inputmode="numeric"><button data-sales-dir="1">＋</button></div></div><div class="calc-box" style="margin-top:10px"><div class="formula">GROSS SALES</div><div class="result">${money(gross)}</div></div><div class="metric-row" style="margin-top:10px"><div class="metric"><span>FARMING 40%</span><b>${money(gross*.4)}</b></div><div class="metric"><span>PRODUCTION 15%</span><b>${money(gross*.15)}</b></div><div class="metric"><span>SALES 25%</span><b>${money(pay)}</b></div><div class="metric"><span>CASH 10%</span><b>${money(cash)}</b></div><div class="metric"><span>ECSTASY 10%</span><b>+${num(reserve)}</b></div></div></div><div class="card"><div class="card-title"><h3>PARTICIPANTS</h3><span class="badge">${salesSelected.size} PEOPLE</span></div>${participantChecks('sales',salesSelected)}<div class="notice" style="margin-top:10px">1人あたり 約 <b>${money(per)}</b></div><button id="registerSales" class="btn primary block" style="margin-top:12px">SALES RECORDを登録 →</button></div></div>`:`<div class="notice">販売登録は管理者のみです。</div>`)+
  `<div class="section-head"><h2>RECENT SALES</h2></div>${recordsTable(state.work_records.filter(r=>r.type==='SALES').slice(0,8))}`;
}
function participantChecks(kind,set){ return `<div class="check-grid">${activeEmployees().map(e=>`<label class="check-card"><input type="checkbox" class="participant-check" data-kind="${kind}" value="${e.id}" ${set.has(e.id)?'checked':''}><span><b>${esc(e.name)}</b><br><span class="small">${esc(e.role)} / ${esc((e.departments||[]).join(' · '))}</span></span></label>`).join('')}</div>`; }

function payrollPage(){
  const items=state.payroll, unpaid=items.filter(x=>x.status==='UNPAID'), paid=items.filter(x=>x.status==='PAID');
  const total=items.reduce((s,x)=>s+Number(x.amount||0),0),up=unpaid.reduce((s,x)=>s+Number(x.amount||0),0),pd=paid.reduce((s,x)=>s+Number(x.amount||0),0);
  return title('PAYROLL','SALARY / PAYMENT MANAGEMENT',`${state.is_admin?'<button id="adjustPayroll" class="btn dark">+ ADJUSTMENT</button>':''}<span class="badge ${state.is_admin?'admin':'active'}">${state.is_admin?'ALL EMPLOYEES':'MY SALARY'}</span>`)+
  `<div class="grid kpi4"><div class="card kpi"><div class="label">TOTAL EARNED</div><div class="value">${money(total)}</div></div><div class="card kpi"><div class="label">PAID</div><div class="value">${money(pd)}</div></div><div class="card kpi"><div class="label">UNPAID</div><div class="value danger-text">${money(up)}</div></div><div class="card kpi"><div class="label">UNPAID RECORDS</div><div class="value">${unpaid.length}</div></div></div>
  <div class="card" style="margin-top:14px"><div class="table-wrap"><table class="table"><thead><tr>${state.is_admin?'<th>SELECT</th>':''}<th>EMPLOYEE</th><th>SOURCE</th><th>RECORD</th><th>DATE</th><th>AMOUNT</th><th>STATUS</th></tr></thead><tbody>${items.length?items.map(x=>`<tr>${state.is_admin?`<td>${x.status==='UNPAID'?`<input class="pay-check" type="checkbox" value="${x.id}" data-amount="${x.amount}">`:''}</td>`:''}<td><b>${esc(x.employee_name)}</b></td><td>${esc(x.source_type)}</td><td>${x.source_record_no?'#'+String(x.source_record_no).padStart(4,'0'):'—'}</td><td>${fmtDate(x.created_at)}</td><td class="amount">${money(x.amount)}</td><td><span class="badge ${x.status==='PAID'?'green':x.status==='VOID'?'red':'yellow'}">${x.status}</span></td></tr>`).join(''):`<tr><td colspan="7">${empty('給与明細がありません')}</td></tr>`}</tbody></table></div>${state.is_admin?`<div class="summary-bar"><div class="stats"><span>SELECTED<b id="payCount">0 RECORDS</b></span><span>TOTAL<b id="payTotal">¥0</b></span></div><button id="payBtn" class="btn primary">選択した給与を支給 →</button></div>`:''}</div>
  ${state.is_admin?`<div class="section-head"><h2>PAYMENT HISTORY</h2></div><div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>DATE</th><th>ADMIN</th><th>AMOUNT</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>${state.payments.length?state.payments.map(p=>`<tr><td>${fmt(p.created_at)}</td><td>${esc(p.processed_by_name)}</td><td class="amount">${money(p.total_amount)}</td><td><span class="badge ${p.status==='PAID'?'green':'red'}">${p.status}</span></td><td>${p.status==='PAID'?`<button class="btn danger smallbtn cancel-payment" data-id="${p.id}">CANCEL</button>`:'—'}</td></tr>`).join(''):'<tr><td colspan="5">履歴なし</td></tr>'}</tbody></table></div></div>`:''}`;
}

function employeesPage(){
  return title('EMPLOYEES','EMPLOYEE / ACCESS MANAGEMENT','<span class="badge admin">ADMIN ONLY</span>')+
  `<div class="grid two"><div class="card admin-only"><div class="card-title"><h3>ADD EMPLOYEE</h3></div><div class="form-grid"><div class="field"><label>NAME</label><input id="newName" class="input"></div><div class="field"><label>4 DIGIT PIN</label><input id="newPin" class="input" maxlength="4" inputmode="numeric" type="password"></div><div class="field"><label>ROLE</label><select id="newRole" class="select">${roles.map(r=>`<option>${r}</option>`).join('')}</select></div><div class="field"><label>HIRE DATE</label><input id="newHire" type="date" class="input" value="${new Date().toISOString().slice(0,10)}"></div></div><div class="field"><label>DEPARTMENTS</label><div class="check-grid">${depts.map(d=>`<label class="check-card"><input type="checkbox" class="newDept" value="${d}">${d}</label>`).join('')}</div></div><button id="createEmployee" class="btn primary">EMPLOYEEを登録 →</button></div><div class="card"><div class="metric-row"><div class="metric"><span>ACTIVE</span><b>${state.employees.filter(e=>e.status==='ACTIVE').length}</b></div><div class="metric"><span>RETIRED</span><b>${state.employees.filter(e=>e.status==='RETIRED').length}</b></div><div class="metric"><span>ADMIN</span><b>${state.employees.filter(e=>['CEO','COO','GENERAL MANAGER'].includes(e.role)&&e.status==='ACTIVE').length}</b></div></div></div></div>
  <div class="section-head"><h2>EMPLOYEE MASTER</h2></div><div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>NAME</th><th>ROLE</th><th>DEPARTMENT</th><th>HIRE DATE</th><th>LAST ACTIVE</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>${state.employees.map(e=>`<tr><td><b>${esc(e.name)}</b></td><td>${esc(e.role)}</td><td>${esc((e.departments||[]).join(' / '))}</td><td>${esc(e.hire_date)}</td><td>${fmt(e.last_active_at)}</td><td><span class="badge ${e.status==='ACTIVE'?'active':'red'}">${e.status}</span></td><td class="nowrap"><button class="btn ghost smallbtn edit-employee" data-id="${e.id}">EDIT</button> <button class="btn ghost smallbtn reset-pin" data-id="${e.id}">PIN RESET</button></td></tr>`).join('')}</tbody></table></div></div>`;
}

function performancePage(){
  if(!perfEmployeeId) perfEmployeeId=state.me.id;
  const p=state.performance.find(x=>x.id===perfEmployeeId)||state.performance[0]||{};
  const mb=p.material_breakdown||{};
  return title('PERFORMANCE','EMPLOYEE PERFORMANCE / ANALYTICS')+
  `<div class="card"><div class="field" style="max-width:420px"><label>EMPLOYEE</label><select id="perfSelect" class="select">${state.performance.map(x=>`<option value="${x.id}" ${x.id===p.id?'selected':''}>${esc(x.name)} / ${esc(x.role)}</option>`).join('')}</select></div></div>
  <div class="grid kpi4" style="margin-top:14px"><div class="card kpi"><div class="label">TOTAL ACTIVITY</div><div class="value">${num(p.total_activity)} times</div></div><div class="card kpi"><div class="label">LAST ACTIVE</div><div class="value" style="font-size:18px">${fmt(p.last_active)}</div></div><div class="card kpi"><div class="label">ROLE</div><div class="value" style="font-size:20px">${esc(p.role||'—')}</div></div><div class="card kpi"><div class="label">STATUS</div><div class="value" style="font-size:20px">${esc(p.status||'—')}</div></div></div>
  <div class="grid three" style="margin-top:14px"><div class="card"><div class="card-title"><h3>FARMING</h3></div><div class="hero-number">${num(p.farming_count)} <span class="small">times</span></div><div class="metric-row" style="grid-template-columns:1fr 1fr;margin-top:10px"><div class="metric"><span>TOTAL UNITS</span><b>${num(p.farming_qty)}</b></div><div class="metric"><span>DELIVERY VALUE</span><b>${money(p.farming_value)}</b></div></div><div class="small" style="margin-top:12px">${state.materials.map(m=>`${esc(m.label)}: <b>${num(mb[m.code]||0)}</b>`).join('<br>')}</div></div><div class="card"><div class="card-title"><h3>PRODUCTION</h3></div><div class="hero-number">${num(p.production_count)} <span class="small">times</span></div><div class="metric-row" style="grid-template-columns:1fr 1fr;margin-top:10px"><div class="metric"><span>PARTICIPATION QTY</span><b>${num(p.production_qty)}</b></div><div class="metric"><span>REVENUE-EQUIV.</span><b>${money(p.production_value)}</b></div></div></div><div class="card"><div class="card-title"><h3>SALES</h3></div><div class="hero-number">${num(p.sales_count)} <span class="small">times</span></div><div class="metric-row" style="grid-template-columns:1fr 1fr;margin-top:10px"><div class="metric"><span>SALE QTY</span><b>${num(p.sales_qty)}</b></div><div class="metric"><span>ACTUAL SALES</span><b>${money(p.sales_value)}</b></div></div></div></div>
  ${p.salary_total!=null?`<div class="card" style="margin-top:14px"><div class="card-title"><h3>SALARY PERFORMANCE</h3><span class="badge">本人またはADMINのみ</span></div><div class="metric-row"><div class="metric"><span>TOTAL EARNED</span><b>${money(p.salary_total)}</b></div><div class="metric"><span>PAID</span><b>${money(p.salary_paid)}</b></div><div class="metric"><span>UNPAID</span><b class="danger-text">${money(p.salary_unpaid)}</b></div></div></div>`:''}`;
}

function inventoryPage(){
  const d=state.dashboard;
  return title('INVENTORY','COMPANY ECSTASY / ASSET MANAGEMENT','<span class="badge admin">ADMIN ONLY</span>')+
  `<div class="grid kpi4"><div class="card kpi"><div class="label">ECSTASY RESERVE</div><div class="value">${num(d.inventory_units)} units</div></div><div class="card kpi"><div class="label">CURRENT VALUE</div><div class="value">${money(d.inventory_current_value)}</div></div><div class="card kpi"><div class="label">ACQUISITION VALUE</div><div class="value">${money(d.inventory_acquisition_value)}</div></div><div class="card kpi"><div class="label">UNREALIZED P/L</div><div class="value ${d.unrealized_pl>=0?'success-text':'danger-text'}">${money(d.unrealized_pl)}</div></div></div>
  <div class="grid two" style="margin-top:14px"><div class="card admin-only"><div class="card-title"><h3>SELL COMPANY INVENTORY</h3></div><div class="form-grid"><div class="field"><label>QUANTITY</label><input id="invQty" class="input" type="number" min="1" max="${d.inventory_units}" value="100"></div><div class="field"><label>SALE PRICE</label><select id="invPrice" class="select">${[300000,400000,500000].map(p=>`<option value="${p}" ${p===state.settings.market_price?'selected':''}>${money(p)}</option>`).join('')}</select></div></div><div id="invPreview" class="notice">予定売却額 ${money(100*state.settings.market_price)}</div><button id="sellInventory" class="btn primary" style="margin-top:12px">SELL INVENTORY →</button></div><div class="card"><div class="card-title"><h3>ASSET SUMMARY</h3></div><div class="metric-row" style="grid-template-columns:1fr 1fr 1fr"><div class="metric"><span>CASH</span><b>${money(d.cash)}</b></div><div class="metric"><span>ECSTASY VALUE</span><b>${money(d.inventory_current_value)}</b></div><div class="metric"><span>TOTAL ASSETS</span><b>${money(d.total_assets)}</b></div></div></div></div>
  <div class="section-head"><h2>INVENTORY HISTORY</h2></div><div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>DATE</th><th>TYPE</th><th>QTY</th><th>UNIT PRICE</th><th>VALUE</th><th>ADMIN</th></tr></thead><tbody>${state.inventory_transactions.length?state.inventory_transactions.map(i=>`<tr><td>${fmt(i.created_at)}</td><td>${esc(i.txn_type)}</td><td class="${Number(i.qty_delta)>=0?'success-text':'danger-text'}">${Number(i.qty_delta)>=0?'+':''}${num(i.qty_delta)}</td><td>${money(i.unit_price)}</td><td class="amount">${money(i.gross_value)}</td><td>${esc(i.created_by_name)}</td></tr>`).join(''):'<tr><td colspan="6">履歴なし</td></tr>'}</tbody></table></div></div>`;
}

function cashPage(){
  const d=state.dashboard;
  return title('COMPANY CASH','CASH FLOW / EXPENSE MANAGEMENT','<span class="badge admin">ADMIN ONLY</span>')+
  `<div class="grid two"><div class="card kpi"><div class="label">CURRENT CASH</div><div class="value">${money(d.cash)}</div><div class="spark"></div></div><div class="card admin-only"><div class="form-grid"><div class="field"><label>TYPE</label><select id="cashType" class="select"><option>INCOME</option><option>EXPENSE</option></select></div><div class="field"><label>AMOUNT</label><input id="cashAmount" class="input" type="number" min="1"></div><div class="field"><label>CATEGORY</label><select id="cashCategory" class="select"><option>EQUIPMENT</option><option>EVENT</option><option>BONUS</option><option>OPERATING COST</option><option>OTHER</option></select></div><div class="field"><label>MEMO</label><input id="cashMemo" class="input"></div></div><button id="cashRegister" class="btn primary">REGISTER TRANSACTION →</button></div></div>
  <div class="section-head"><h2>CASH FLOW HISTORY</h2></div><div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>DATE</th><th>CATEGORY</th><th>MEMO</th><th>AMOUNT</th><th>ADMIN</th></tr></thead><tbody>${state.cash_transactions.length?state.cash_transactions.map(c=>`<tr><td>${fmt(c.created_at)}</td><td>${esc(c.category)}</td><td>${esc(c.memo||'')}</td><td class="amount ${Number(c.amount_signed)>=0?'success-text':'danger-text'}">${Number(c.amount_signed)>=0?'+ ':''}${money(c.amount_signed)}</td><td>${esc(c.created_by_name)}</td></tr>`).join(''):'<tr><td colspan="5">履歴なし</td></tr>'}</tbody></table></div></div>`;
}

function activityPage(){ return title('ACTIVITY LOG','WORK RECORDS / CORRECTION')+`<div class="card">${recordsTable(state.work_records,true)}</div>`; }
function recordsTable(records, actions=false){
  if(!records.length) return `<div class="card">${empty('業務記録がありません')}</div>`;
  return `<div class="table-wrap"><table class="table"><thead><tr><th>RECORD</th><th>TYPE</th><th>DATE</th><th>PRODUCT</th><th>QTY</th><th>VALUE</th><th>PARTICIPANTS</th><th>STATUS</th>${actions&&state.is_admin?'<th>ACTION</th>':''}</tr></thead><tbody>${records.map(r=>`<tr><td><b>${recordCode(r)}</b></td><td>${r.type}</td><td>${fmt(r.created_at)}</td><td>${esc(r.product)}</td><td>${num(r.quantity)}</td><td class="amount">${money(r.gross_value)}</td><td>${(r.participants||[]).map(p=>esc(p.name)).join(', ')||'—'}</td><td><span class="badge ${r.status==='VALID'?'active':'red'}">${r.status}</span></td>${actions&&state.is_admin?`<td>${r.status==='VALID'?`<button class="btn danger smallbtn void-record" data-id="${r.id}">VOID</button>`:'—'}</td>`:''}</tr>`).join('')}</tbody></table></div>`;
}

function auditPage(){
  return title('AUDIT LOG','ADMINISTRATIVE ACTION HISTORY','<span class="badge admin">ADMIN ONLY</span>')+`<div>${state.audit_logs.length?state.audit_logs.map(a=>`<div class="log-card"><div class="log-top"><b>${fmt(a.created_at)} / ${esc(a.action)}</b><span class="badge">${esc(a.actor_name||'SYSTEM')}</span></div><div class="log-grid"><div><span>ENTITY</span><strong>${esc(a.entity_type)}</strong></div><div><span>ID</span><strong>${esc(a.entity_id||'—')}</strong></div><div><span>BEFORE</span><strong>${esc(a.before_data?JSON.stringify(a.before_data):'—')}</strong></div><div><span>AFTER</span><strong>${esc(a.after_data?JSON.stringify(a.after_data):'—')}</strong></div></div></div>`).join(''):empty('監査ログがありません')}</div>`;
}

function settingsPage(){
  return title('SETTINGS','SYSTEM / COMPANY CONFIGURATION','<span class="badge admin">ADMIN ONLY</span>')+
  `<div class="setting-block"><h3>01 / MATERIAL PRICES</h3><div class="table-wrap"><table class="table"><thead><tr><th>MATERIAL</th><th>CURRENT PRICE</th><th>NEW PRICE</th><th>ACTION</th></tr></thead><tbody>${state.materials.map(m=>`<tr><td><b>${esc(m.label)}</b></td><td class="amount">${money(m.unit_price)}</td><td><input id="mat-${m.code}" type="number" min="0" value="${m.unit_price}"></td><td><button class="btn ghost smallbtn set-material" data-code="${m.code}">UPDATE</button></td></tr>`).join('')}</tbody></table></div></div>
  <div class="setting-block"><h3>02 / ECSTASY MARKET</h3><div class="price-options" id="marketButtons" style="max-width:620px">${[300000,400000,500000].map(p=>`<button class="price ${p===state.settings.market_price?'active':''}" data-market="${p}">${money(p)}</button>`).join('')}</div></div>
  <div class="setting-block"><h3>03 / REVENUE ALLOCATION</h3><div class="alloc">${Object.entries(state.settings.allocation).map(([k,v])=>`<div class="item"><b>${k}</b><div class="hero-number" style="font-size:22px;margin-top:8px">${v}%</div></div>`).join('')}</div><div class="page-footer-note">初期版では売上配分率は固定。素材単価と市場価格のみ管理画面から変更可能です。</div></div>
  <div class="setting-block"><h3>04 / SECURITY</h3><div class="form-grid three"><div class="form-card"><h4>LOGIN</h4><b>NAME + 4 DIGIT PIN</b></div><div class="form-card"><h4>FAILED LOGIN</h4><b>5 ATTEMPTS / 15 MIN LOCK</b></div><div class="form-card"><h4>PIN STORAGE</h4><b>HASHED / NEVER DISPLAY</b></div><div class="form-card"><h4>SESSION</h4><b>7 DAYS</b></div><div class="form-card"><h4>DIRECT TABLE ACCESS</h4><b>BLOCKED</b></div><div class="form-card"><h4>API GATEWAY</h4><b>SECURE / RATE LIMITED</b></div><div class="form-card"><h4>AUDIT LOG</h4><b>ENABLED</b></div></div></div>`;
}

function bindPage(){
  $$('[data-goto]').forEach(b=>b.onclick=()=>go(b.dataset.goto));
  if(currentPage==='farming') bindFarming();
  if(currentPage==='production') bindProduction();
  if(currentPage==='sales') bindSales();
  if(currentPage==='payroll') bindPayroll();
  if(currentPage==='employees') bindEmployees();
  if(currentPage==='performance') $('#perfSelect')?.addEventListener('change',e=>{perfEmployeeId=e.target.value;renderPage()});
  if(currentPage==='inventory') bindInventory();
  if(currentPage==='cash') bindCash();
  if(currentPage==='activity') $$('.void-record').forEach(b=>b.onclick=()=>voidRecord(b.dataset.id));
  if(currentPage==='settings') bindSettings();
}
function bindFarming(){
  $('#addFarmParticipant')?.addEventListener('click',()=>{farmingRows.push({employee_id:'',q:{}});renderPage()});
  $$('.remove-farm').forEach(b=>b.onclick=()=>{farmingRows.splice(Number(b.dataset.index),1);renderPage()});
  $$('.farm-employee').forEach((s,i)=>s.addEventListener('change',()=>{farmingRows[i].employee_id=s.value;farmCalc()}));
  $$('.farm-q').forEach(inp=>inp.addEventListener('input',farmCalc)); farmCalc();
  $('#registerFarm')?.addEventListener('click',async()=>{
    const entries=readFarmDom().filter(e=>e.employee_id && e.materials.some(m=>m.quantity>0));
    if(!entries.length) return toast('従業員と素材数量を入力してください');
    if(new Set(entries.map(e=>e.employee_id)).size!==entries.length) return toast('同じ従業員が重複しています');
    if(!confirm('このFARMING RECORDを登録しますか？')) return;
    try{setBusy(true);await rpc('register_farming',{p_session:token,p_entries:entries});farmingRows=[];await loadState();renderShell();renderPage();toast('FARMING RECORDを登録しました')}catch(e){handleError(e)}finally{setBusy(false)}
  });
}
function bindProduction(){
  $$('#prodPrice .price').forEach(b=>b.onclick=()=>{prodPrice=Number(b.dataset.price);renderPage()});
  $('[data-prod-dir="-1"]')?.addEventListener('click',()=>{prodQty=Math.max(500,prodQty-500);renderPage()}); $('[data-prod-dir="1"]')?.addEventListener('click',()=>{prodQty=Math.min(10000,prodQty+500);renderPage()});
  $('#prodQty')?.addEventListener('change',e=>{prodQty=Math.max(500,Math.min(10000,Math.round(Number(e.target.value||500)/500)*500));renderPage()});
  $$('.participant-check[data-kind="prod"]').forEach(c=>c.onchange=()=>{c.checked?prodSelected.add(c.value):prodSelected.delete(c.value);renderPage()});
  $('#registerProduction')?.addEventListener('click',async()=>{if(!prodSelected.size)return toast('参加者を選択してください');if(!confirm('PRODUCTION RECORDを登録しますか？'))return;try{setBusy(true);await rpc('register_production',{p_session:token,p_unit_price:prodPrice,p_quantity:prodQty,p_participants:[...prodSelected]});await loadState();renderShell();renderPage();toast('PRODUCTION RECORDを登録しました')}catch(e){handleError(e)}finally{setBusy(false)}});
}
function bindSales(){
  $$('#salesPrice .price').forEach(b=>b.onclick=()=>{salesPrice=Number(b.dataset.price);renderPage()});
  $('[data-sales-dir="-1"]')?.addEventListener('click',()=>{salesQty=Math.max(500,salesQty-500);renderPage()}); $('[data-sales-dir="1"]')?.addEventListener('click',()=>{salesQty=Math.min(10000,salesQty+500);renderPage()});
  $('#salesQty')?.addEventListener('change',e=>{salesQty=Math.max(500,Math.min(10000,Math.round(Number(e.target.value||500)/500)*500));renderPage()});
  $$('.participant-check[data-kind="sales"]').forEach(c=>c.onchange=()=>{c.checked?salesSelected.add(c.value):salesSelected.delete(c.value);renderPage()});
  $('#registerSales')?.addEventListener('click',async()=>{if(!salesSelected.size)return toast('参加者を選択してください');if(!confirm('SALES RECORDを登録しますか？\n給与25%・CASH10%・会社在庫10%が自動反映されます。'))return;try{setBusy(true);await rpc('register_sales',{p_session:token,p_unit_price:salesPrice,p_quantity:salesQty,p_participants:[...salesSelected]});await loadState();renderShell();renderPage();toast('SALES RECORDを登録しました')}catch(e){handleError(e)}finally{setBusy(false)}});
}
function bindPayroll(){
  const calc=()=>{const a=$$('.pay-check:checked'),t=a.reduce((s,x)=>s+Number(x.dataset.amount||0),0); if($('#payCount'))$('#payCount').textContent=a.length+' RECORDS';if($('#payTotal'))$('#payTotal').textContent=money(t)}; $$('.pay-check').forEach(c=>c.onchange=calc);
  $('#payBtn')?.addEventListener('click',async()=>{const ids=$$('.pay-check:checked').map(x=>x.value);if(!ids.length)return toast('未払い明細を選択してください');if(!confirm(`${ids.length}件を支給済みにしますか？`))return;try{setBusy(true);await rpc('process_payroll',{p_session:token,p_item_ids:ids});await loadState();renderPage();toast('支給処理を完了しました')}catch(e){handleError(e)}finally{setBusy(false)}});
  $$('.cancel-payment').forEach(b=>b.onclick=async()=>{if(!confirm('この支給処理を取り消し、対象明細を未払いに戻しますか？'))return;try{setBusy(true);await rpc('cancel_payment',{p_session:token,p_payment_id:b.dataset.id});await loadState();renderPage();toast('支給処理を取り消しました')}catch(e){handleError(e)}finally{setBusy(false)}});
  $('#adjustPayroll')?.addEventListener('click',openPayrollAdjustmentModal);
}
function openPayrollAdjustmentModal(){
  const employeeOptions=state.employees.map(e=>`<option value="${e.id}">${esc(e.name)} / ${e.role}${e.status==='RETIRED'?' / RETIRED':''}</option>`).join('');
  const recordOptions=['<option value="">関連記録なし</option>',...state.work_records.slice(0,100).map(r=>`<option value="${r.id}">${recordCode(r)} ${r.type} / ${fmtDate(r.created_at)}</option>`)].join('');
  openModal('PAYROLL ADJUSTMENT',`<div class="notice warn">支給済み記録を直接書き換えず、差額を調整明細として残します。追加支給はプラス、過払い調整はマイナスで入力してください。</div><div class="field"><label>EMPLOYEE</label><select id="adjEmployee" class="select">${employeeOptions}</select></div><div class="field"><label>AMOUNT / 円</label><input id="adjAmount" class="input" type="number" step="1" placeholder="例: 50000 / -20000"></div><div class="field"><label>RELATED RECORD / 任意</label><select id="adjRecord" class="select">${recordOptions}</select></div><div class="field"><label>REASON</label><textarea id="adjReason" class="input" rows="3" maxlength="500" placeholder="調整理由を入力"></textarea></div>`,async()=>{
    const employeeId=$('#adjEmployee').value, amount=Math.trunc(Number($('#adjAmount').value||0)), reason=$('#adjReason').value.trim(), recordId=$('#adjRecord').value||null;
    if(!employeeId||!amount)return toast('従業員と調整額を入力してください');
    if(!reason)return toast('調整理由を入力してください');
    if(!confirm(`${money(amount)} の給与調整を登録しますか？`))return;
    try{setBusy(true);await rpc('create_payroll_adjustment',{p_session:token,p_employee_id:employeeId,p_amount:amount,p_reason:reason,p_source_record_id:recordId});closeModal();await loadState();renderPage();toast('給与調整を登録しました')}catch(e){handleError(e)}finally{setBusy(false)}
  });
}
function bindEmployees(){
  $('#createEmployee')?.addEventListener('click',async()=>{const name=$('#newName').value.trim(),pin=$('#newPin').value.trim(),role=$('#newRole').value,hire=$('#newHire').value,deptsSel=$$('.newDept:checked').map(x=>x.value);if(!name||!/^\d{4}$/.test(pin))return toast('名前と4桁PINを入力してください');try{setBusy(true);await rpc('create_employee',{p_session:token,p_name:name,p_pin:pin,p_role:role,p_departments:deptsSel,p_hire_date:hire});await loadState();renderShell();renderPage();toast('従業員を登録しました')}catch(e){handleError(e)}finally{setBusy(false)}});
  $$('.edit-employee').forEach(b=>b.onclick=()=>openEmployeeModal(b.dataset.id)); $$('.reset-pin').forEach(b=>b.onclick=()=>openPinModal(b.dataset.id));
}
function openEmployeeModal(id){
  const e=state.employees.find(x=>x.id===id); if(!e)return;
  openModal('EDIT EMPLOYEE',`<div class="field"><label>NAME</label><input id="editName" class="input" value="${esc(e.name)}"></div><div class="form-grid"><div class="field"><label>ROLE</label><select id="editRole" class="select">${roles.map(r=>`<option ${r===e.role?'selected':''}>${r}</option>`).join('')}</select></div><div class="field"><label>STATUS</label><select id="editStatus" class="select"><option ${e.status==='ACTIVE'?'selected':''}>ACTIVE</option><option ${e.status==='RETIRED'?'selected':''}>RETIRED</option></select></div><div class="field"><label>HIRE DATE</label><input id="editHire" class="input" type="date" value="${esc(e.hire_date)}"></div></div><div class="field"><label>DEPARTMENTS</label><div class="check-grid">${depts.map(d=>`<label class="check-card"><input class="editDept" type="checkbox" value="${d}" ${(e.departments||[]).includes(d)?'checked':''}>${d}</label>`).join('')}</div></div>`, async()=>{try{setBusy(true);await rpc('update_employee',{p_session:token,p_employee_id:id,p_name:$('#editName').value.trim(),p_role:$('#editRole').value,p_departments:$$('.editDept:checked').map(x=>x.value),p_hire_date:$('#editHire').value,p_status:$('#editStatus').value});closeModal();await loadState();renderShell();renderPage();toast('従業員情報を更新しました')}catch(e){handleError(e)}finally{setBusy(false)}});
}
function openPinModal(id){const e=state.employees.find(x=>x.id===id);openModal(`PIN RESET / ${esc(e?.name||'')}`,`<div class="notice warn">現在のPINは表示されません。新しい4桁PINを設定すると、既存ログインセッションは無効になります。</div><div class="field"><label>NEW PIN</label><input id="resetPinValue" class="input" type="password" maxlength="4" inputmode="numeric" placeholder="••••"></div>`,async()=>{const pin=$('#resetPinValue').value.trim();if(!/^\d{4}$/.test(pin))return toast('4桁PINを入力してください');try{setBusy(true);await rpc('reset_employee_pin',{p_session:token,p_employee_id:id,p_new_pin:pin});closeModal();toast('PINをリセットしました');if(id===state.me.id){await logout()}else{await loadState();renderPage()}}catch(e){handleError(e)}finally{setBusy(false)}})}
function bindInventory(){ const preview=()=>{if($('#invPreview'))$('#invPreview').innerHTML='予定売却額 <b>'+money(Number($('#invQty').value||0)*Number($('#invPrice').value||0))+'</b>';}; $('#invQty')?.addEventListener('input',preview);$('#invPrice')?.addEventListener('change',preview);$('#sellInventory')?.addEventListener('click',async()=>{const q=Number($('#invQty').value),p=Number($('#invPrice').value);if(q<=0)return toast('数量を入力してください');if(!confirm(`${q} unitsを ${money(p)} で売却しますか？`))return;try{setBusy(true);await rpc('sell_inventory',{p_session:token,p_quantity:q,p_unit_price:p});await loadState();renderPage();toast('会社在庫を売却しました')}catch(e){handleError(e)}finally{setBusy(false)}}); }
function bindCash(){ $('#cashRegister')?.addEventListener('click',async()=>{const type=$('#cashType').value,amount=Number($('#cashAmount').value),cat=$('#cashCategory').value,memo=$('#cashMemo').value;if(amount<=0)return toast('金額を入力してください');if(!confirm(`${type} ${money(amount)} を登録しますか？`))return;try{setBusy(true);await rpc('register_cash_transaction',{p_session:token,p_type:type,p_amount:amount,p_category:cat,p_memo:memo});await loadState();renderPage();toast('CASH取引を登録しました')}catch(e){handleError(e)}finally{setBusy(false)}}); }
async function voidRecord(id){const reason=prompt('VOID理由を入力してください');if(!reason)return;try{setBusy(true);await rpc('void_work_record',{p_session:token,p_record_id:id,p_reason:reason});await loadState();renderPage();toast('業務記録をVOIDにしました')}catch(e){handleError(e)}finally{setBusy(false)}}
function bindSettings(){
  $$('.set-material').forEach(b=>b.onclick=async()=>{const code=b.dataset.code,v=Number($('#mat-'+code).value);if(v<0)return toast('単価を確認してください');try{setBusy(true);await rpc('set_material_price',{p_session:token,p_code:code,p_unit_price:v});await loadState();renderPage();toast('素材単価を更新しました')}catch(e){handleError(e)}finally{setBusy(false)}});
  $$('[data-market]').forEach(b=>b.onclick=async()=>{const v=Number(b.dataset.market);if(!confirm(`ECSTASY市場価格を ${money(v)} に変更しますか？`))return;try{setBusy(true);await rpc('set_market_price',{p_session:token,p_market_price:v});await loadState();renderPage();toast('市場価格を更新しました')}catch(e){handleError(e)}finally{setBusy(false)}});
}

function openChangeMyPinModal(){
  openModal('CHANGE MY PIN',`<div class="notice warn">PINは保存・表示されません。変更後も現在の端末のログインは維持され、他端末のセッションは無効になります。</div><div class="field"><label>CURRENT PIN</label><input id="currentPinValue" class="input" type="password" maxlength="4" inputmode="numeric" placeholder="••••"></div><div class="field"><label>NEW PIN</label><input id="newMyPinValue" class="input" type="password" maxlength="4" inputmode="numeric" placeholder="••••"></div>`,async()=>{
    const currentPin=$('#currentPinValue').value.trim(), newPin=$('#newMyPinValue').value.trim();
    if(!/^\d{4}$/.test(currentPin)||!/^\d{4}$/.test(newPin))return toast('現在のPINと新しい4桁PINを入力してください');
    try{setBusy(true);await rpc('change_my_pin',{p_session:token,p_current_pin:currentPin,p_new_pin:newPin});closeModal();toast('PINを変更しました')}catch(e){handleError(e)}finally{setBusy(false)}
  });
}

function openModal(titleText,body,onSave){$('#modalTitle').textContent=titleText;$('#modalBody').innerHTML=body;$('#modalFoot').innerHTML=`<button class="btn ghost" id="modalCancel">CANCEL</button><button class="btn primary" id="modalSave">SAVE</button>`;$('#modalBack').classList.add('show');$('#modalCancel').onclick=closeModal;$('#modalSave').onclick=onSave;}
function closeModal(){ $('#modalBack').classList.remove('show'); }

// Global UI events
$('#loginBtn').addEventListener('click',login); $('#bootstrapBtn').addEventListener('click',bootstrap); $('#loginPin').addEventListener('keydown',e=>{if(e.key==='Enter')(initialized?login:bootstrap)()});
$('#logoutBtn').addEventListener('click',logout); $('#refreshBtn').addEventListener('click',refresh); $('#changePinBtn').addEventListener('click',openChangeMyPinModal); $('#menuBtn').addEventListener('click',()=>$('#sidebar').classList.toggle('open')); $('#modalClose').addEventListener('click',closeModal); $('#modalBack').addEventListener('click',e=>{if(e.target===$('#modalBack'))closeModal()});
document.addEventListener('click',e=>{const b=e.target.closest('[data-goto]');if(b)go(b.dataset.goto)});

boot();
})();
