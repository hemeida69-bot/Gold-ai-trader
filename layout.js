/**
 * Gold AI Trader — shared app shell (sidebar, topbar, status bar).
 * Every page calls Layout.mount('<page-key>') once on load.
 * Keeps navigation, responsive drawer behavior, and the bottom status
 * bar identical across all pages without duplicating markup in each file.
 */
const Layout = (() => {
  const NAV = [
    { key: 'dashboard', href: 'index.html', icon: '🏠', label: 'Dashboard' },
    { key: 'analysis', href: 'analysis.html', icon: '🧠', label: 'AI Analysis' },
    { key: 'liquidity', href: 'liquidity.html', icon: '💧', label: 'Liquidity' },
    { key: 'structure', href: 'structure.html', icon: '📊', label: 'Market Structure' },
    { key: 'setups', href: 'setups.html', icon: '🎯', label: 'Trade Setups' },
    { key: 'chart', href: 'chart.html', icon: '📈', label: 'Chart' },
    { divider: true },
    { key: 'news', href: 'news.html', icon: '📰', label: 'News & Macro' },
    { key: 'fed', href: 'fed.html', icon: '🏦', label: 'FED' },
    { divider: true },
    { key: 'risk', href: 'risk.html', icon: '🧮', label: 'Risk Calculator' },
    { key: 'journal', href: 'journal.html', icon: '📔', label: 'Trade Journal' },
    { divider: true },
    { key: 'settings', href: 'settings.html', icon: '⚙️', label: 'Settings' }
  ];

  function navHTML(active) {
    return NAV.map(item => {
      if (item.divider) return '<div class="sidebar-divider"></div>';
      const isActive = item.key === active;
      return `<a class="sidebar-link${isActive ? ' active' : ''}" href="${item.href}">
        <span class="sidebar-icon">${item.icon}</span><span>${item.label}</span>
      </a>`;
    }).join('');
  }

  function mount(active) {
    const topbar = document.createElement('div');
    topbar.className = 'topbar';
    topbar.innerHTML = `
      <button class="hamburger" id="hamburger-btn" aria-label="Open menu">☰</button>
      <div class="topbar-title">🥇 GOLD AI TRADER</div>
      <div class="topbar-spacer"></div>
    `;
    document.body.prepend(topbar);

    const backdrop = document.createElement('div');
    backdrop.className = 'sidebar-backdrop';
    backdrop.id = 'sidebar-backdrop';
    document.body.appendChild(backdrop);

    const sidebar = document.createElement('nav');
    sidebar.className = 'sidebar';
    sidebar.id = 'sidebar';
    sidebar.innerHTML = `<div class="sidebar-brand">🥇 GOLD AI TRADER</div>` + navHTML(active);
    document.body.appendChild(sidebar);

    const statusBar = document.createElement('div');
    statusBar.className = 'status-bar';
    statusBar.innerHTML = `
      <span><span class="dot open" id="status-live-dot"></span>LIVE</span>
      <span>XAUUSD</span>
      <span id="status-lastupdate">Last update: —</span>
      <span id="status-session">Session: —</span>
      <span id="status-api">API: checking…</span>
    `;
    document.body.appendChild(statusBar);

    function openDrawer() { sidebar.classList.add('open'); backdrop.classList.add('open'); }
    function closeDrawer() { sidebar.classList.remove('open'); backdrop.classList.remove('open'); }

    document.getElementById('hamburger-btn').addEventListener('click', () => {
      sidebar.classList.contains('open') ? closeDrawer() : openDrawer();
    });
    backdrop.addEventListener('click', closeDrawer);
    sidebar.querySelectorAll('.sidebar-link').forEach(a => a.addEventListener('click', closeDrawer));
  }

  function setStatusBar({ lastUpdateText, sessionText, apiOk }) {
    const u = document.getElementById('status-lastupdate');
    const s = document.getElementById('status-session');
    const a = document.getElementById('status-api');
    if (u && lastUpdateText) u.textContent = `Last update: ${lastUpdateText}`;
    if (s && sessionText) s.textContent = `Session: ${sessionText}`;
    if (a && apiOk !== undefined) a.textContent = `API: ${apiOk ? 'Connected' : 'Unavailable'}`;
  }

  return { mount, setStatusBar };
})();
