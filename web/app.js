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

  // 直接列出所有分类（optgroup 分组）
  var sel = document.getElementById('incCategory');
  sel.innerHTML = '<option value="">-- 选择分类 --</option>';
  var groups = { '开单': [], '不开单': [], '外拍': [] };
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
  var tbody = document.getElementById('incList');
  try {
    var data = await api('/api/income/today?date='+date, 'GET');
    document.getElementById('incTotal').textContent = fmtMoney(data.total);
    if (!data.records || data.records.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty">暂无记录</td></tr>';
      return;
    }
    tbody.innerHTML = data.records.map(function(r){
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
  } catch(e) { tbody.innerHTML = '<tr><td colspan="9" class="empty">加载失败: '+e.message+'</td></tr>'; }
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
  var tbody = document.getElementById('expList');
  try {
    var data = await api('/api/expense/today?date='+date, 'GET');
    document.getElementById('expTotal').textContent = fmtMoney(data.total);
    if (!data.records || data.records.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty">暂无记录</td></tr>';
      return;
    }
    tbody.innerHTML = data.records.map(function(r){
      return '<tr>'+
        '<td>'+r.category_name+'</td>'+
        '<td>'+fmtMoney(r.amount)+'</td>'+
        '<td>'+r.notes+'</td>'+
        '<td>'+r.created_by+'</td>'+
        '<td>'+r.created_at.substring(11,19)+'</td>'+
        '<td>'+(currentUser&&currentUser.role==='admin'? '<button class="btn-del" onclick="deleteExpense('+r.id+')">删除</button>' : '')+'</td>'+
      '</tr>';
    }).join('');
  } catch(e) { tbody.innerHTML = '<tr><td colspan="6" class="empty">加载失败: '+e.message+'</td></tr>'; }
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
  }
}

// ===== 加载报表数据 =====
async function loadReport() {
  var tab = currentReportTab;
  try {
    var data;
    if (tab === 'daily') {
      var date = document.getElementById('reportDate').value;
      if (!date) { toast('请选择日期', 'error'); return; }
      data = await api('/api/report/daily?date='+date, 'GET');
    } else if (tab === 'monthly') {
      var month = document.getElementById('reportMonth').value;
      if (!month) { toast('请选择月份', 'error'); return; }
      var parts = month.split('-');
      data = await api('/api/report/monthly?year='+parts[0]+'&month='+parts[1], 'GET');
    } else {
      var year = document.getElementById('yearSelect').value;
      if (!year) { toast('请选择年份', 'error'); return; }
      data = await api('/api/report/yearly?year='+year, 'GET');
    }
    lastReportData = { tab: tab, data: data };

    // 根据当前视图渲染
    if (currentView === 'table') {
      renderReportTable(tab, data);
      document.getElementById('reportTableView').style.display = '';
      document.getElementById('reportChartView').style.display = 'none';
    } else {
      renderReportTable(tab, data); // 仍然渲染表格（可能在 chart view 下面或备用）
      document.getElementById('reportTableView').style.display = 'none';
      document.getElementById('reportChartView').style.display = '';
      renderChart(data, currentView);
    }
  } catch(e) { toast(e.message, 'error'); }
}

// ===== 表格渲染 =====
function renderReportTable(tab, data) {
  var html = '';
  if (tab === 'daily') {
    html += '<div class="report-section"><h4>\uD83D\uDCE5 收入合计: '+fmtMoney(data.income_total)+'</h4>';
    (data.income||[]).forEach(function(g){
      html += '<h4 class="sub">'+g.type+'</h4><table class="report-table"><thead><tr><th>分类</th><th>金额</th></tr></thead><tbody>';
      (g.categories||[]).forEach(function(c){ html += '<tr><td>'+c.name+'</td><td>'+fmtMoney(c.total)+'</td></tr>'; });
      html += '</tbody></table>';
    });
    if ((data.income||[]).length===0) html += '<p style="color:#9ca3af;padding:8px;">当日无收入记录</p>';
    html += '</div>';
    html += '<div class="report-section"><h4>\uD83D\uDCE4 支出合计: '+fmtMoney(data.expense_total)+'</h4>';
    if ((data.expense||[]).length > 0) {
      html += '<table class="report-table"><thead><tr><th>分类</th><th>金额</th></tr></thead><tbody>';
      data.expense.forEach(function(c){ html += '<tr><td>'+c.name+'</td><td>'+fmtMoney(c.total)+'</td></tr>'; });
      html += '</tbody></table>';
    } else { html += '<p style="color:#9ca3af;padding:8px;">当日无支出记录</p>'; }
    html += '</div>';
    html += '<div class="report-section"><strong>当日结余: '+fmtMoney(data.income_total - data.expense_total)+'</strong></div>';
  } else if (tab === 'monthly') {
    html += '<div class="report-section"><h4>\uD83D\uDCC5 月报表</h4>';
    html += '<table class="report-table"><thead><tr><th>日期</th><th>收入</th><th>支出</th><th>结余</th></tr></thead><tbody>';
    (data.days||[]).forEach(function(d){
      html += '<tr><td>'+d.date+'</td><td>'+fmtMoney(d.income)+'</td><td>'+fmtMoney(d.expense)+'</td><td>'+fmtMoney(d.income-d.expense)+'</td></tr>';
    });
    html += '<tr class="total-row"><td>月合计</td><td>'+fmtMoney(data.month_income_total)+'</td><td>'+fmtMoney(data.month_expense_total)+'</td><td>'+fmtMoney(data.month_income_total-data.month_expense_total)+'</td></tr>';
    html += '</tbody></table></div>';
  } else {
    html += '<div class="report-section"><h4>\uD83D\uDCC8 年度报表</h4>';
    html += '<table class="report-table"><thead><tr><th>月份</th><th>收入</th><th>支出</th><th>结余</th></tr></thead><tbody>';
    (data.months||[]).forEach(function(m){
      html += '<tr><td>'+m.month+'月</td><td>'+fmtMoney(m.income)+'</td><td>'+fmtMoney(m.expense)+'</td><td>'+fmtMoney(m.income-m.expense)+'</td></tr>';
    });
    html += '<tr class="total-row"><td>年合计</td><td>'+fmtMoney(data.year_income_total)+'</td><td>'+fmtMoney(data.year_expense_total)+'</td><td>'+fmtMoney(data.year_income_total-data.year_expense_total)+'</td></tr>';
    html += '</tbody></table></div>';
  }
  document.getElementById('reportTableView').innerHTML = html;
}

// ===== Canvas 图表渲染 =====
function renderChart(data, viewType) {
  var canvas = document.getElementById('reportChart');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var tab = currentReportTab;

  // 设置 canvas 尺寸
  var container = canvas.parentElement;
  canvas.width = Math.max(560, container.clientWidth - 20);
  canvas.height = 360;
  var W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // 边距
  var pad = { top: 30, right: 30, bottom: 60, left: 70 };
  var pw = W - pad.left - pad.right;
  var ph = H - pad.top - pad.bottom;

  // 解析数据为标签和数据集
  var labels = [], incomes = [], expenses = [];
  if (tab === 'daily') {
    // 日报：按分类汇总（收入+支出混排）
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
      labels.push(d.date.substring(5)); // MM-DD
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

  // 计算最大值
  var maxVal = 0;
  for (var i = 0; i < incomes.length; i++) {
    if (incomes[i] > maxVal) maxVal = incomes[i];
    if (expenses[i] > maxVal) maxVal = expenses[i];
  }
  if (maxVal === 0) maxVal = 10;
  var yMax = Math.ceil(maxVal * 1.2);

  var barCount = labels.length;
  var groupWidth = pw / barCount;

  // 绘制背景网格
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  var gridLines = 5;
  for (var g = 0; g <= gridLines; g++) {
    var y = pad.top + (ph / gridLines) * g;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(W - pad.right, y);
    ctx.stroke();
    // Y 轴标签
    var val = yMax - (yMax / gridLines) * g;
    ctx.fillStyle = '#6b7280';
    ctx.font = '11px "Microsoft YaHei",sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(fmtMoney(val), pad.left - 6, y + 4);
  }

  // 绘制 X 轴标签
  ctx.fillStyle = '#374151';
  ctx.font = '11px "Microsoft YaHei",sans-serif';
  ctx.textAlign = 'center';
  for (var i = 0; i < barCount; i++) {
    var x = pad.left + groupWidth * i + groupWidth / 2;
    var y = H - pad.bottom + 18;
    ctx.save();
    ctx.translate(x, y);
    if (labels[i].length > 4) {
      ctx.rotate(-0.5);
    }
    ctx.fillText(labels[i], 0, 0);
    ctx.restore();
  }

  if (viewType === 'bar') {
    drawBars(ctx, pad, groupWidth, barCount, ph, yMax, incomes, expenses);
  } else {
    drawLines(ctx, pad, groupWidth, barCount, ph, yMax, incomes, expenses);
  }

  // 图例
  var legendX = W - pad.right - 120;
  var legendY = 8;
  ctx.fillStyle = '#4f46e5';
  ctx.fillRect(legendX, legendY, 14, 14);
  ctx.fillStyle = '#374151';
  ctx.font = '12px "Microsoft YaHei",sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('收入', legendX + 18, legendY + 12);
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(legendX + 60, legendY, 14, 14);
  ctx.fillStyle = '#374151';
  ctx.fillText('支出', legendX + 78, legendY + 12);
}

function drawBars(ctx, pad, groupWidth, barCount, ph, yMax, incomes, expenses) {
  var barW = Math.min(groupWidth * 0.35, 40);
  for (var i = 0; i < barCount; i++) {
    var cx = pad.left + groupWidth * i + groupWidth / 2;
    // 收入柱
    var ih = (incomes[i] / yMax) * ph;
    if (ih > 0) {
      ctx.fillStyle = '#4f46e5';
      ctx.fillRect(cx - barW - 2, pad.top + ph - ih, barW, ih);
    }
    // 支出柱
    var eh = (expenses[i] / yMax) * ph;
    if (eh > 0) {
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(cx + 2, pad.top + ph - eh, barW, eh);
    }
  }
}

function drawLines(ctx, pad, groupWidth, barCount, ph, yMax, incomes, expenses) {
  function drawLine(vals, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    var first = true;
    for (var i = 0; i < vals.length; i++) {
      var x = pad.left + groupWidth * i + groupWidth / 2;
      var y = pad.top + ph - (vals[i] / yMax) * ph;
      if (first) { ctx.moveTo(x, y); first = false; }
      else { ctx.lineTo(x, y); }
    }
    ctx.stroke();
    // 画点
    for (var i = 0; i < vals.length; i++) {
      var x = pad.left + groupWidth * i + groupWidth / 2;
      var y = pad.top + ph - (vals[i] / yMax) * ph;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  drawLine(incomes, '#4f46e5');
  drawLine(expenses, '#ef4444');
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
