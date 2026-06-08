function sendMessage(type, data = {}) {
  return chrome.runtime.sendMessage({ type, ...data });
}

async function refresh() {
  const settings = await sendMessage('GET_SETTINGS');
  const stats = await sendMessage('GET_STATS');

  document.getElementById('qsToday').textContent = stats.todayBids || 0;
  document.getElementById('qsTotal').textContent = stats.totalBids || 0;
  document.getElementById('qsSuccess').textContent = stats.successfulBids || 0;

  const dot = document.getElementById('statusDot');
  dot.className = settings.isRunning ? 'status-dot running' : 'status-dot';
}

document.getElementById('btnQuickStart').addEventListener('click', async () => {
  await sendMessage('START_BOT');
  refresh();
});

document.getElementById('btnQuickStop').addEventListener('click', async () => {
  await sendMessage('STOP_BOT');
  refresh();
});

document.getElementById('btnDashboard').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
});

refresh();
