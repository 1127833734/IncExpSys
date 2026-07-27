// ===== Toast 通知 =====
function toast(msg, type) {
  type = type || 'info';
  var box = document.getElementById('toastBox');
  var el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(function(){ el.remove(); }, 3000);
}

// ===== API 封装 =====
async function api(url, method, body) {
  var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  var resp;
  try {
    resp = await fetch(url, opts);
  } catch(e) {
    toast('网络错误，请检查服务是否启动', 'error');
    throw e;
  }
  if (resp.status === 401) { window.location.href = '/login.html'; throw new Error('未登录'); }
  var ct = resp.headers.get('Content-Type') || '';
  if (!ct.includes('application/json')) throw new Error('服务器返回异常');
  var data = await resp.json();
  if (!resp.ok) throw new Error(data.error || '请求失败');
  return data;
}

// ===== 工具函数 =====
function fmtMoney(n) { return '\u00a5' + (Number(n) || 0).toFixed(2); }
function todayStr() {
  var d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

// ===== 全局状态 =====
var currentUser = null;
var allIncomeCategories = [];
var allExpenseCategories = [];
var currentReportTab = 'daily';   // 'daily' | 'monthly' | 'yearly'
var currentView = 'table';       // 'table' | 'bar' | 'line'
var lastReportData = null;       // 缓存最近一次报表数据用于图表切换
var incomeSort = { col: null, dir: 'asc' };   // 收入表格排序状态
var expenseSort = { col: null, dir: 'asc' };  // 支出表格排序状态
var incomeCache = [];   // 收入原始数据缓存
var expenseCache = [];  // 支出原始数据缓存

// ===== 页面导航 =====
function navTo(name) {
  document.querySelectorAll('.nav-item').forEach(function(el){ el.classList.remove('active'); });
  var nav = document.querySelector('.nav-item[data-page="'+name+'"]');
  if (nav) nav.classList.add('active');
  document.querySelectorAll('.page').forEach(function(el){ el.classList.remove('active'); });
  var page = document.getElementById('page-'+name);
  if (page) page.classList.add('active');
  if (name === 'income') loadTodayIncome();
  if (name === 'expense') loadTodayExpense();
  if (name === 'report') loadReport();
}

// ===== 表格排序 =====
function toggleSort(table, col) {
  var st = table === 'income' ? incomeSort : expenseSort;
  if (st.col === col) {
    // 循环：asc → desc → null(默认)
    if (st.dir === 'asc') { st.dir = 'desc'; }
    else if (st.dir === 'desc') { st.col = null; st.dir = 'asc'; }
  } else {
    st.col = col;
    st.dir = 'asc';
  }
  updateSortArrows(table);
  if (table === 'income') renderIncomeTable();
  else renderExpenseTable();
}

function applySort(records, st) {
  if (!st.col || !records || records.length === 0) return records;
  var sorted = records.slice();
  var col = st.col;
  sorted.sort(function(a, b) {
    var va = a[col], vb = b[col];
    if (va == null) va = '';
    if (vb == null) vb = '';
    // 数字比较
    if (col === 'amount') {
      va = parseFloat(va) || 0;
      vb = parseFloat(vb) || 0;
    }
    if (va < vb) return st.dir === 'asc' ? -1 : 1;
    if (va > vb) return st.dir === 'asc' ? 1 : -1;
    return 0;
  });
  return sorted;
}

function updateSortArrows(table) {
  var st = table === 'income' ? incomeSort : expenseSort;
  var prefix = table === 'income' ? 'inc' : 'exp';
  var thead = document.querySelector('#page-' + table + ' thead');
  if (!thead) return;
  var ths = thead.querySelectorAll('th');
  ths.forEach(function(th) {
    var arrow = th.querySelector('.sort-arrow');
    if (!arrow) return;
    var col = th.getAttribute('data-sort');
    if (col === st.col) {
      arrow.textContent = st.dir === 'asc' ? ' ▲' : ' ▼';
    } else {
      arrow.textContent = '';
    }
  });
}

// ===== 初始化 =====
async function init() {
  try {
    currentUser = await api('/api/me', 'GET');
    document.getElementById('userName').textContent = currentUser.name + ' (' + currentUser.role + ')';
  } catch(e) {
    window.location.href = '/login.html';
    return;
  }

  document.getElementById('incDate').value = todayStr();
  document.getElementById('incDateFilter').value = todayStr();
  document.getElementById('expDate').value = todayStr();
  document.getElementById('expDateFilter').value = todayStr();
  document.getElementById('reportDate').value = todayStr();
  document.getElementById('reportMonth').value = todayStr().substring(0,7);

  // 加载收入分类
  try {
    allIncomeCategories = await api('/api/income/categories', 'GET');
  } catch(e) { toast('加载收入分类失败', 'error'); }

  // 加载支出分类
  try {
    allExpenseCategories = await api('/api/expense/categories', 'GET');
    var expSel = document.getElementById('expCategory');
    if (expSel) {
      expSel.innerHTML = '<option value="">-- 选择分类 --</option>';
      allExpenseCategories.forEach(function(c){
        expSel.innerHTML += '<option value="'+c.id+'">'+c.name+'</option>';
      });
    }
  } catch(e) { toast('加载支出分类失败', 'error'); }

  // 年份选择器
  var yearSel = document.getElementById('yearSelect');
  if (yearSel) {
    var cy = new Date().getFullYear();
    for (var y = cy; y >= cy - 5; y--) {
      yearSel.innerHTML += '<option value="'+y+'">'+y+'年</option>';
    }
  }

  // 报表分类筛选下拉
  var catSel = document.getElementById('reportCatFilter');
  if (catSel && allIncomeCategories.length > 0) {
    allIncomeCategories.forEach(function(c){
      catSel.innerHTML += '<option value="'+c.id+'">'+c.name+'</option>';
    });
  }

  // 报表分类筛选下拉
  var catSel = document.getElementById('reportCatFilter');
  if (catSel && allIncomeCategories.length > 0) {
    allIncomeCategories.forEach(function(c){
      catSel.innerHTML += '<option value="'+c.id+'">'+c.name+'</option>';
    });
  }

  loadTodayIncome();
  loadTodayExpense();

  // 局域网地址
  try {
    var addrResp = await fetch('/api/lan');
    var addrData = await addrResp.json();
    if (addrData.addr) {
      var lanEl = document.getElementById('lanAddr');
      if (lanEl) { lanEl.textContent = '\ud83c\udf10 ' + addrData.addr; lanEl.title = 'http://'+addrData.addr+':3456'; }
    }
  } catch(e) {}
}

// ===== 弹窗：快捷开单 =====
function openIncomeModal() {
  document.getElementById('incDate').value = todayStr();
  document.getElementById('incAmount').value = '';
  document.getElementById('incNotes').value = '';
  document.getElementById('incResult').textContent = '';
  document.getElementById('incResult').className = 'modal-result';

  // 直接列出所有分类（门市/外拍 分组）
  var sel = document.getElementById('incCategory');
  sel.innerHTML = '<option value="">-- 选择分类 --</option>';
  var groups = { '门市': [], '外拍': [] };
  allIncomeCategories.forEach(function(c){
    if (groups[c.type]) groups[c.type].push(c);
  });
  Object.keys(groups).forEach(function(g){
    if (groups[g].length === 0) return;
    sel.innerHTML += '<optgroup label="'+g+'">';
    groups[g].forEach(function(c){
      sel.innerHTML += '<option value="'+c.id+'">'+c.name+'</option>';
    });
    sel.innerHTML += '</optgroup>';
  });

  document.getElementById('incomeModal').classList.add('show');
}

function closeIncomeModal() {
  document.getElementById('incomeModal').classList.remove('show');
}

async function submitIncome() {
  var categoryId = parseInt(document.getElementById('incCategory').value) || 0;
  var amount = parseFloat(document.getElementById('incAmount').value) || 0;
  var paymentMethod = document.getElementById('incPayMethod').value;
  var recordDate = document.getElementById('incDate').value;
  var notes = document.getElementById('incNotes').value;
  var resultDiv = document.getElementById('incResult');

  if (!categoryId || amount <= 0 || !recordDate) {
    resultDiv.className = 'modal-result error';
    resultDiv.textContent = '\u26a0 请选择分类并填写正确的金额和日期';
    return;
  }
  try {
    var data = await api('/api/income', 'POST', {
      category_id: categoryId, amount: amount,
      payment_method: paymentMethod, record_date: recordDate, notes: notes
    });
    resultDiv.className = 'modal-result success';
    var msg = data.order_no ? '\u2705 单号: ' + data.order_no : '\u2705 录入成功';
    resultDiv.textContent = msg;
    toast(msg, 'success');
    document.getElementById('incAmount').value = '';
    document.getElementById('incNotes').value = '';
    loadTodayIncome();
    setTimeout(closeIncomeModal, 800);
  } catch(e) {
    resultDiv.className = 'modal-result error';
    resultDiv.textContent = '\u274c ' + e.message;
    toast(e.message, 'error');
  }
}

async function loadTodayIncome() {
  var date = document.getElementById('incDateFilter').value || todayStr();
  try {
    var data = await api('/api/income/today?date='+date, 'GET');
    document.getElementById('incTotal').textContent = fmtMoney(data.total);
    incomeCache = data.records || [];
    renderIncomeTable();
  } catch(e) {
    incomeCache = [];
    document.getElementById('incList').innerHTML = '<tr><td colspan="9" class="empty">加载失败: '+e.message+'</td></tr>';
  }
}

function renderIncomeTable() {
  var records = applySort(incomeCache, incomeSort);
  var tbody = document.getElementById('incList');
  updateSortArrows('income');
  if (!records || records.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">暂无记录</td></tr>';
    return;
  }
  tbody.innerHTML = records.map(function(r){
    return '<tr>'+
      '<td><b>'+(r.order_no||'---')+'</b></td>'+
      '<td><span class="tag">'+r.type+'</span></td>'+
      '<td>'+r.category_name+'</td>'+
      '<td>'+fmtMoney(r.amount)+'</td>'+
      '<td>'+r.payment_method+'</td>'+
      '<td>'+r.notes+'</td>'+
      '<td>'+r.created_by+'</td>'+
      '<td>'+r.created_at.substring(11,19)+'</td>'+
      '<td>'+(currentUser&&currentUser.role==='admin'? '<button class="btn-del" onclick="deleteIncome('+r.id+')">删除</button>' : '')+'</td>'+
    '</tr>';
  }).join('');
}

async function deleteIncome(id) {
  if (!confirm('确认删除此记录？')) return;
  try { await api('/api/income/'+id, 'DELETE'); toast('已删除', 'success'); loadTodayIncome(); }
  catch(e) { toast(e.message, 'error'); }
}

// ===== 弹窗：支出录入 =====
function openExpenseModal() {
  document.getElementById('expDate').value = todayStr();
  document.getElementById('expAmount').value = '';
  document.getElementById('expNotes').value = '';
  document.getElementById('expenseModal').classList.add('show');
}

function closeExpenseModal() {
  document.getElementById('expenseModal').classList.remove('show');
}

async function submitExpense() {
  var categoryId = parseInt(document.getElementById('expCategory').value) || 0;
  var amount = parseFloat(document.getElementById('expAmount').value) || 0;
  var recordDate = document.getElementById('expDate').value;
  var notes = document.getElementById('expNotes').value;
  if (!categoryId || amount <= 0 || !recordDate) {
    toast('请选择分类并填写正确的金额和日期', 'error');
    return;
  }
  try {
    await api('/api/expense', 'POST', {
      category_id: categoryId, amount: amount, record_date: recordDate, notes: notes
    });
    toast('\u2705 支出录入成功', 'success');
    document.getElementById('expAmount').value = '';
    document.getElementById('expNotes').value = '';
    loadTodayExpense();
    setTimeout(closeExpenseModal, 800);
  } catch(e) { toast(e.message, 'error'); }
}

async function loadTodayExpense() {
  var date = document.getElementById('expDateFilter').value || todayStr();
  try {
    var data = await api('/api/expense/today?date='+date, 'GET');
    document.getElementById('expTotal').textContent = fmtMoney(data.total);
    expenseCache = data.records || [];
    renderExpenseTable();
  } catch(e) {
    expenseCache = [];
    document.getElementById('expList').innerHTML = '<tr><td colspan="6" class="empty">加载失败: '+e.message+'</td></tr>';
  }
}

function renderExpenseTable() {
  var records = applySort(expenseCache, expenseSort);
  var tbody = document.getElementById('expList');
  updateSortArrows('expense');
  if (!records || records.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">暂无记录</td></tr>';
    return;
  }
  tbody.innerHTML = records.map(function(r){
    return '<tr>'+
      '<td><b>'+(r.order_no||'---')+'</b></td>'+
      '<td>'+r.category_name+'</td>'+
      '<td>'+fmtMoney(r.amount)+'</td>'+
      '<td>'+r.notes+'</td>'+
      '<td>'+r.created_by+'</td>'+
      '<td>'+r.created_at.substring(11,19)+'</td>'+
      '<td>'+(currentUser&&currentUser.role==='admin'? '<button class="btn-del" onclick="deleteExpense('+r.id+')">删除</button>' : '')+'</td>'+
    '</tr>';
  }).join('');
}

async function deleteExpense(id) {
  if (!confirm('确认删除此记录？')) return;
  try { await api('/api/expense/'+id, 'DELETE'); toast('已删除', 'success'); loadTodayExpense(); }
  catch(e) { toast(e.message, 'error'); }
}

// ===== 报表子标签切换 =====
function switchReportTab(tab) {
  currentReportTab = tab;
  document.querySelectorAll('.sub-tab').forEach(function(el){ el.classList.remove('active'); });
  var t = document.querySelector('.sub-tab[onclick*="'+tab+'"]');
  if (t) t.classList.add('active');

  document.getElementById('reportDateGroup').style.display = tab === 'daily' ? '' : 'none';
  document.getElementById('reportMonthGroup').style.display = tab === 'monthly' ? '' : 'none';
  document.getElementById('reportYearGroup').style.display = tab === 'yearly' ? '' : 'none';

  // 视图切换按钮：年报不显示折线图（折线图意义不大）
  document.querySelectorAll('.view-btn').forEach(function(b){ b.style.display = ''; });
  document.getElementById('reportTableView').innerHTML = '';
  document.getElementById('reportChartView').style.display = 'none';
  lastReportData = null;
  loadReport();
}

// ===== 视图切换 =====
function switchView(view) {
  currentView = view;
  document.querySelectorAll('.view-btn').forEach(function(el){ el.classList.remove('active'); });
  var v = document.querySelector('.view-btn[onclick*="'+view+'"]');
  if (v) v.classList.add('active');

  if (view === 'table') {
    document.getElementById('reportTableView').style.display = '';
    document.getElementById('reportChartView').style.display = 'none';
  } else {
    document.getElementById('reportTableView').style.display = 'none';
    document.getElementById('reportChartView').style.display = '';
    if (lastReportData) renderChart(lastReportData, view);
    else loadReport();
  }
}

// ===== 加载报表数据 =====
function getReportFilterParams() {
  var params = '';
  var type = document.getElementById('reportTypeFilter').value;
  var cat = document.getElementById('reportCatFilter').value;
  if (type) params += '&type=' + encodeURIComponent(type);
  if (cat) params += '&category_id=' + encodeURIComponent(cat);
  return params;
}

async function loadReport() {
  var tab = currentReportTab;
  var filter = getReportFilterParams();
  try {
    var data;
    if (tab === 'daily') {
      var date = document.getElementById('reportDate').value;
      if (!date) { toast('请选择日期', 'error'); return; }
      data = await api('/api/report/daily?date='+date+filter, 'GET');
    } else if (tab === 'monthly') {
      var month = document.getElementById('reportMonth').value;
      if (!month) { toast('请选择月份', 'error'); return; }
      var parts = month.split('-');
      data = await api('/api/report/monthly?year='+parts[0]+'&month='+parts[1]+filter, 'GET');
    } else {
      var year = document.getElementById('yearSelect').value;
      if (!year) { toast('请选择年份', 'error'); return; }
      data = await api('/api/report/yearly?year='+year+filter, 'GET');
    }
    lastReportData = { tab: tab, data: data };

    if (currentView === 'table') {
      renderReportTable(tab, data);
      document.getElementById('reportTableView').style.display = '';
      document.getElementById('reportChartView').style.display = 'none';
    } else {
      renderReportTable(tab, data);
      document.getElementById('reportTableView').style.display = 'none';
      document.getElementById('reportChartView').style.display = '';
      renderChart(data, currentView);
    }
  } catch(e) { toast(e.message, 'error'); }
}

// ===== 表格渲染 =====
function renderReportTable(tab, data) {
  var inEx = document.getElementById('reportInExFilter') ? document.getElementById('reportInExFilter').value : '';
  var showIncome = inEx !== 'expense';
  var showExpense = inEx !== 'income';
  var html = '';
  if (tab === 'daily') {
    if (showIncome) {
    html += '<div class="report-section"><h4>\uD83D\uDCE5 收入合计: '+fmtMoney(data.income_total)+'</h4>';
    (data.income||[]).forEach(function(g){
      html += '<h4 class="sub">'+g.type+'</h4><table class="report-table"><thead><tr><th>分类</th><th>金额</th></tr></thead><tbody>';
      (g.categories||[]).forEach(function(c){ html += '<tr><td>'+c.name+'</td><td>'+fmtMoney(c.total)+'</td></tr>'; });
      html += '</tbody></table>';
    });
    if ((data.income||[]).length===0) html += '<p style="color:#9ca3af;padding:8px;">当日无收入记录</p>';
    html += '</div>';
    }
    if (showExpense) {
    html += '<div class="report-section"><h4>\uD83D\uDCE4 支出合计: '+fmtMoney(data.expense_total)+'</h4>';
    if ((data.expense||[]).length > 0) {
      html += '<table class="report-table"><thead><tr><th>分类</th><th>金额</th></tr></thead><tbody>';
      data.expense.forEach(function(c){ html += '<tr><td>'+c.name+'</td><td>'+fmtMoney(c.total)+'</td></tr>'; });
      html += '</tbody></table>';
    } else { html += '<p style="color:#9ca3af;padding:8px;">当日无支出记录</p>'; }
    html += '</div>';
    }
    if (showIncome && showExpense) {
    html += '<div class="report-section"><strong>当日结余: '+fmtMoney(data.income_total - data.expense_total)+'</strong></div>';
    }
  } else if (tab === 'monthly') {
    html += '<div class="report-section"><h4>\uD83D\uDCC5 月报表</h4>';
    html += '<table class="report-table"><thead><tr><th>日期</th>';
    if (showIncome) html += '<th>收入</th>';
    if (showExpense) html += '<th>支出</th>';
    if (showIncome && showExpense) html += '<th>结余</th>';
    html += '</tr></thead><tbody>';
    (data.days||[]).forEach(function(d){
      html += '<tr><td>'+d.date+'</td>';
      if (showIncome) html += '<td>'+fmtMoney(d.income)+'</td>';
      if (showExpense) html += '<td>'+fmtMoney(d.expense)+'</td>';
      if (showIncome && showExpense) html += '<td>'+fmtMoney(d.income-d.expense)+'</td>';
      html += '</tr>';
    });
    html += '<tr class="total-row"><td>月合计</td>';
    if (showIncome) html += '<td>'+fmtMoney(data.month_income_total)+'</td>';
    if (showExpense) html += '<td>'+fmtMoney(data.month_expense_total)+'</td>';
    if (showIncome && showExpense) html += '<td>'+fmtMoney(data.month_income_total-data.month_expense_total)+'</td>';
    html += '</tr></tbody></table></div>';
  } else {
    html += '<div class="report-section"><h4>\uD83D\uDCC8 年度报表</h4>';
    html += '<table class="report-table"><thead><tr><th>月份</th>';
    if (showIncome) html += '<th>收入</th>';
    if (showExpense) html += '<th>支出</th>';
    if (showIncome && showExpense) html += '<th>结余</th>';
    html += '</tr></thead><tbody>';
    (data.months||[]).forEach(function(m){
      html += '<tr><td>'+m.month+'月</td>';
      if (showIncome) html += '<td>'+fmtMoney(m.income)+'</td>';
      if (showExpense) html += '<td>'+fmtMoney(m.expense)+'</td>';
      if (showIncome && showExpense) html += '<td>'+fmtMoney(m.income-m.expense)+'</td>';
      html += '</tr>';
    });
    html += '<tr class="total-row"><td>年合计</td>';
    if (showIncome) html += '<td>'+fmtMoney(data.year_income_total)+'</td>';
    if (showExpense) html += '<td>'+fmtMoney(data.year_expense_total)+'</td>';
    if (showIncome && showExpense) html += '<td>'+fmtMoney(data.year_income_total-data.year_expense_total)+'</td>';
    html += '</tr></tbody></table></div>';
  }
  document.getElementById('reportTableView').innerHTML = html;
}

// ===== Canvas 图表渲染 =====
function renderChart(data, viewType) {
  var canvas = document.getElementById('reportChart');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var tab = currentReportTab;

  var container = canvas.parentElement;
  canvas.width = Math.max(560, container.clientWidth - 20);
  canvas.height = 380;
  var W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // 解析数据
  var labels = [], incomes = [], expenses = [];
  if (tab === 'daily') {
    (data.income||[]).forEach(function(g){
      (g.categories||[]).forEach(function(c){
        labels.push(c.name); incomes.push(c.total); expenses.push(0);
      });
    });
    (data.expense||[]).forEach(function(c){
      labels.push(c.name); incomes.push(0); expenses.push(c.total);
    });
  } else if (tab === 'monthly') {
    (data.days||[]).forEach(function(d){
      labels.push(d.date.substring(5));
      incomes.push(d.income); expenses.push(d.expense);
    });
  } else {
    (data.months||[]).forEach(function(m){
      labels.push(m.month+'月');
      incomes.push(m.income); expenses.push(m.expense);
    });
  }

  if (labels.length === 0) {
    ctx.fillStyle = '#9ca3af';
    ctx.font = '16px "Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('暂无数据', W/2, H/2);
    return;
  }

  if (viewType === 'pie') {
    drawPie(ctx, W, H, data, tab);
  } else if (viewType === 'bar') {
    drawBarsV2(ctx, W, H, labels, incomes, expenses);
  } else {
    drawLinesV2(ctx, W, H, labels, incomes, expenses);
  }
}

// ===== 柱状图 V2：收入向上、支出向下（双Y轴独立刻度）=====
function drawBarsV2(ctx, W, H, labels, incomes, expenses) {
  var pad = { top: 20, right: 60, bottom: 60, left: 60 };
  var midY = H / 2; // 中间基线
  var pw = W - pad.left - pad.right;

  // 计算收入/支出各自的最大值
  var maxInc = 0, maxExp = 0;
  for (var i = 0; i < incomes.length; i++) {
    if (incomes[i] > maxInc) maxInc = incomes[i];
    if (expenses[i] > maxExp) maxExp = expenses[i];
  }
  if (maxInc === 0) maxInc = 10;
  if (maxExp === 0) maxExp = 10;
  var incMax = Math.ceil(maxInc * 1.15);
  var expMax = Math.ceil(maxExp * 1.15);
  var incH = midY - pad.top - 10;   // 收入区域高度
  var expH = H - midY - pad.bottom; // 支出区域高度

  var barCount = labels.length;
  var groupW = pw / barCount;
  var barW = Math.min(groupW * 0.5, 50);

  // 网格——收入区
  ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1;
  for (var g = 0; g <= 4; g++) {
    var y = pad.top + (incH / 4) * g;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    var val = incMax - (incMax / 4) * g;
    ctx.fillStyle = '#4f46e5'; ctx.font = '10px "Microsoft YaHei",sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(fmtMoney(val), pad.left - 4, y + 3);
  }
  // 网格——支出区
  for (var g2 = 1; g2 <= 4; g2++) {
    var y2 = midY + (expH / 4) * g2;
    ctx.beginPath(); ctx.moveTo(pad.left, y2); ctx.lineTo(W - pad.right, y2); ctx.stroke();
    var val2 = (expMax / 4) * g2;
    ctx.fillStyle = '#ef4444'; ctx.font = '10px "Microsoft YaHei",sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(fmtMoney(val2), pad.left - 4, y2 + 3);
  }

  // 基线
  ctx.strokeStyle = '#9ca3af'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(pad.left, midY); ctx.lineTo(W - pad.right, midY); ctx.stroke();

  // X轴标签
  ctx.fillStyle = '#374151'; ctx.font = '11px "Microsoft YaHei",sans-serif'; ctx.textAlign = 'center';
  for (var i = 0; i < barCount; i++) {
    var x = pad.left + groupW * i + groupW / 2;
    ctx.save(); ctx.translate(x, H - pad.bottom + 16);
    if (labels[i].length > 4) ctx.rotate(-0.5);
    ctx.fillText(labels[i], 0, 0);
    ctx.restore();
  }

  // 画柱子
  for (var i2 = 0; i2 < barCount; i2++) {
    var cx = pad.left + groupW * i2 + groupW / 2;
    // 收入向上
    var ih = incMax > 0 ? (incomes[i2] / incMax) * incH : 0;
    if (ih > 0) {
      ctx.fillStyle = '#4f46e5';
      ctx.fillRect(cx - barW / 2, midY - ih, barW, ih);
    }
    // 支出向下
    var eh = expMax > 0 ? (expenses[i2] / expMax) * expH : 0;
    if (eh > 0) {
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(cx - barW / 2, midY + 1, barW, eh);
    }
  }

  // 图例
  ctx.fillStyle = '#4f46e5'; ctx.fillRect(W - pad.right + 10, 16, 12, 12);
  ctx.fillStyle = '#374151'; ctx.font = '11px "Microsoft YaHei",sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('收入', W - pad.right + 26, 27);
  ctx.fillStyle = '#ef4444'; ctx.fillRect(W - pad.right + 10, 36, 12, 12);
  ctx.fillStyle = '#374151';
  ctx.fillText('支出', W - pad.right + 26, 47);
}

// ===== 折线图 V2：双尺度 =====
function drawLinesV2(ctx, W, H, labels, incomes, expenses) {
  var pad = { top: 20, right: 60, bottom: 60, left: 60 };
  var midY = H / 2;
  var pw = W - pad.left - pad.right;

  var maxInc = 0, maxExp = 0;
  for (var i = 0; i < incomes.length; i++) {
    if (incomes[i] > maxInc) maxInc = incomes[i];
    if (expenses[i] > maxExp) maxExp = expenses[i];
  }
  if (maxInc === 0) maxInc = 10;
  if (maxExp === 0) maxExp = 10;
  var incMax = Math.ceil(maxInc * 1.15);
  var expMax = Math.ceil(maxExp * 1.15);
  var incH = midY - pad.top - 10;
  var expH = H - midY - pad.bottom;

  var barCount = labels.length;
  var groupW = pw / barCount;

  // 网格
  ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1;
  for (var g = 0; g <= 4; g++) {
    var y = pad.top + (incH / 4) * g;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    ctx.fillStyle = '#4f46e5'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(fmtMoney(incMax - (incMax / 4) * g), pad.left - 4, y + 3);
  }
  for (var g2 = 1; g2 <= 4; g2++) {
    var y2 = midY + (expH / 4) * g2;
    ctx.beginPath(); ctx.moveTo(pad.left, y2); ctx.lineTo(W - pad.right, y2); ctx.stroke();
    ctx.fillStyle = '#ef4444'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(fmtMoney((expMax / 4) * g2), pad.left - 4, y2 + 3);
  }
  ctx.strokeStyle = '#9ca3af'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(pad.left, midY); ctx.lineTo(W - pad.right, midY); ctx.stroke();

  // X轴
  ctx.fillStyle = '#374151'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
  for (var i = 0; i < barCount; i++) {
    var x = pad.left + groupW * i + groupW / 2;
    ctx.save(); ctx.translate(x, H - pad.bottom + 16);
    if (labels[i].length > 4) ctx.rotate(-0.5);
    ctx.fillText(labels[i], 0, 0);
    ctx.restore();
  }

  function drawLineV2(vals, max, areaH, color, baseY, dir) {
    ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.beginPath();
    var first = true;
    for (var i = 0; i < vals.length; i++) {
      var x = pad.left + groupW * i + groupW / 2;
      var y = baseY + dir * (max > 0 ? (vals[i] / max) * areaH : 0);
      if (first) { ctx.moveTo(x, y); first = false; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    for (var j = 0; j < vals.length; j++) {
      var x2 = pad.left + groupW * j + groupW / 2;
      var y2 = baseY + dir * (max > 0 ? (vals[j] / max) * areaH : 0);
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x2, y2, 4, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x2, y2, 2, 0, Math.PI*2); ctx.fill();
    }
  }
  drawLineV2(incomes, incMax, incH, '#4f46e5', midY, -1);
  drawLineV2(expenses, expMax, expH, '#ef4444', midY, 1);

  // 图例
  ctx.fillStyle = '#4f46e5'; ctx.fillRect(W - pad.right + 10, 16, 12, 12);
  ctx.fillStyle = '#374151'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('收入', W - pad.right + 26, 27);
  ctx.fillStyle = '#ef4444'; ctx.fillRect(W - pad.right + 10, 36, 12, 12);
  ctx.fillStyle = '#374151';
  ctx.fillText('支出', W - pad.right + 26, 47);
}

// ===== 饼状图 =====
function drawPie(ctx, W, H, data, tab) {
  var items = [];
  var incTotal = 0, expTotal = 0;
  if (tab === 'daily') { incTotal = data.income_total || 0; expTotal = data.expense_total || 0; }
  else if (tab === 'monthly') { incTotal = data.month_income_total || 0; expTotal = data.month_expense_total || 0; }
  else { incTotal = data.year_income_total || 0; expTotal = data.year_expense_total || 0; }

  // 收支混合饼图
  if (incTotal > 0) items.push({ name: '收入', value: incTotal, color: '#4f46e5' });
  if (expTotal > 0) items.push({ name: '支出', value: expTotal, color: '#ef4444' });
  var balance = incTotal - expTotal;
  items.push({ name: '结余', value: balance >= 0 ? balance : 0, color: '#10b981' });

  if (items.length === 0) {
    ctx.fillStyle = '#9ca3af';
    ctx.font = '16px "Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('暂无数据', W/2, H/2);
    return;
  }

  var total = 0;
  items.forEach(function(it){ total += it.value; });
  if (total === 0) total = 1;

  var cx = W * 0.38, cy = H / 2;
  var radius = Math.min(cx - 20, cy - 30, 130);

  var startAngle = -Math.PI / 2;
  items.forEach(function(it){
    var sliceAngle = (it.value / total) * Math.PI * 2;
    ctx.fillStyle = it.color;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, startAngle, startAngle + sliceAngle);
    ctx.closePath();
    ctx.fill();
    // 标签
    var midAngle = startAngle + sliceAngle / 2;
    var lx = cx + Math.cos(midAngle) * (radius + 20);
    var ly = cy + Math.sin(midAngle) * (radius + 20);
    ctx.fillStyle = '#374151';
    ctx.font = '12px "Microsoft YaHei",sans-serif';
    ctx.textAlign = midAngle > Math.PI/2 || midAngle < -Math.PI/2 ? 'right' : 'left';
    ctx.fillText(it.name, lx, ly);
    startAngle += sliceAngle;
  });

  // 右侧详情
  var rx = W * 0.72, ry = cy - items.length * 22;
  items.forEach(function(it, i){
    ctx.fillStyle = it.color;
    ctx.fillRect(rx, ry + i * 44, 14, 14);
    ctx.fillStyle = '#374151';
    ctx.font = '13px "Microsoft YaHei",sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(it.name + ': ' + fmtMoney(it.value) + ' (' + (it.value/total*100).toFixed(1) + '%)', rx + 20, ry + i * 44 + 12);
  });
}

// ===== 弹窗关闭（点击遮罩） =====
function closeModalBg(ev) {
  if (ev.target === ev.currentTarget) ev.target.classList.remove('show');
}

// ===== 登出 =====
async function doLogout() {
  try { await api('/api/logout', 'POST'); } catch(e) {}
  window.location.href = '/login.html';
}

// 启动
init();
