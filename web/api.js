const ICON_KRASNOYARSK = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18h20"/><path d="M4 18v-5c0-3 3.5-5 8-5s8 2 8 5v5"/><path d="M8 13v5"/><path d="M12 8v10"/><path d="M16 13v5"/><path d="M2 21c2-1 4-1 6 0s4 1 6 0 4-1 6 0"/></svg>`;

const ICON_SFU = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12.5V17c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.5"/><line x1="22" y1="10" x2="22" y2="16"/></svg>`;

const ICON_RUSSIA = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="3.6" y1="9" x2="20.4" y2="9"/><line x1="3.6" y1="15" x2="20.4" y2="15"/><path d="M11.5 3a17 17 0 0 0 0 18"/><path d="M12.5 3a17 17 0 0 1 0 18"/></svg>`;

const MODES = [
  {
    id: 'krasnoyarsk',
    label: 'Красноярск',
    icon: ICON_KRASNOYARSK,
    description: '50 знаковых мест города: театры, набережные, мосты, арены'
  },
  {
    id: 'sfu',
    label: 'СФУ',
    icon: ICON_SFU,
    description: 'Институты, корпуса, библиотеки и общежития СФУ'
  },
  {
    id: 'russia',
    label: 'Россия',
    icon: ICON_RUSSIA,
    description: 'Достопримечательности всей страны — от Калининграда до Камчатки'
  }
];

let _sessionId = null;

async function call(path, body = {}) {
  const payload = _sessionId ? { sessionId: _sessionId, ...body } : body;
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  getModes() { return MODES; },

  async startSession(mode) {
    const data = await call('/api/session', { mode });
    _sessionId = data.sessionId;
    return data;
  },

  getRound()         { return call('/api/round'); },
  requestHint(level) { return call('/api/hint', { level }); },
  submit(guess)      { return call('/api/submit', { guess }); },
  next()             { return call('/api/next'); },
  final()            { return call('/api/final'); },

  saveLeaderboardEntry(name) {
    return call('/api/leaderboard/submit', { name });
  },

  async getLeaderboard(mode) {
    const res = await fetch('/api/leaderboard?mode=' + encodeURIComponent(mode));
    if (!res.ok) throw new Error('Не удалось загрузить лидерборд');
    return res.json();
  },

  async getDevLocations(key) {
    const res = await fetch('/api/dev/locations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ key })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }
};