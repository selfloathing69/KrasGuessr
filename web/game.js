import { api } from './api.js';
import { MapView } from './map.js';
import { PhotoViewer } from './photo.js';
import { DevMode } from './dev-mode.js';

const SVG_MEDAL_1 = `<svg class="svg-inline-icon" viewBox="0 0 24 24" width="18" height="18" fill="none"><circle cx="12" cy="14" r="7" fill="#FACC15" stroke="#CA8A04" stroke-width="1.8"/><path d="M9 3h6l-1.5 5h-3L9 3z" fill="#EF4444"/><text x="12" y="17" text-anchor="middle" font-size="9" font-weight="800" fill="#713F12">1</text></svg>`;
const SVG_MEDAL_2 = `<svg class="svg-inline-icon" viewBox="0 0 24 24" width="18" height="18" fill="none"><circle cx="12" cy="14" r="7" fill="#E2E8F0" stroke="#64748B" stroke-width="1.8"/><path d="M9 3h6l-1.5 5h-3L9 3z" fill="#3B82F6"/><text x="12" y="17" text-anchor="middle" font-size="9" font-weight="800" fill="#334155">2</text></svg>`;
const SVG_MEDAL_3 = `<svg class="svg-inline-icon" viewBox="0 0 24 24" width="18" height="18" fill="none"><circle cx="12" cy="14" r="7" fill="#FDBA74" stroke="#C2410C" stroke-width="1.8"/><path d="M9 3h6l-1.5 5h-3L9 3z" fill="#16A34A"/><text x="12" y="17" text-anchor="middle" font-size="9" font-weight="800" fill="#7C2D12">3</text></svg>`;
const SVG_TROPHY_HERO = `<svg viewBox="0 0 24 24" width="42" height="42" fill="none"><path d="M8 21h8M12 17v4M6 4h12v5a6 6 0 0 1-12 0V4z" stroke="#D97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="#FEF3C7"/><path d="M6 6H4a2 2 0 0 0-2 2v1a4 4 0 0 0 4 4M18 6h2a2 2 0 0 1 2 2v1a4 4 0 0 1-4 4" stroke="#D97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function formatDistance(m) {
  if (m < 1000) return `${Math.round(m)} м`;
  return `${(m / 1000).toFixed(2)} км`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function collectEls() {
  const id = (x) => document.getElementById(x);
  return {
    modeModal:        id('mode-modal'),
    modesGrid:        id('modes-grid'),
    gameView:         id('game-view'),
    finalView:        id('final-view'),
    gameModeBadge:    id('game-mode-badge'),
    photo:            id('photo'),
    photoWrap:        id('photo-wrap'),
    photoPlaceholder: id('photo-placeholder'),
    photoPrev:        id('photo-prev'),
    photoNext:        id('photo-next'),
    photoCounter:     id('photo-counter'),
    photoFullscreen:  id('photo-fullscreen'),
    photoFitToggle:   id('photo-fit-toggle'),
    photoResizer:     id('photo-resizer'),
    overlay:          id('photo-overlay'),
    overlayImg:       id('photo-overlay-img'),
    roundInfo:        id('round-info'),
    submitBtn:        id('submit-btn'),
    nextBtn:          id('next-btn'),
    result:           id('result'),
    status:           id('status'),
    hintBtn:          id('hint-btn'),
    hintOutput:       id('hint-output')
  };
}

export class Game {
  constructor() {
    this.els = collectEls();
    this.map = null;
    this.photo = null;

    this.currentMode = null;
    this.miniLeaderboardMode = 'krasnoyarsk';
    this.totalRounds = 0;
    this.round = null;
    this.guess = null;
    this.nextHint = 1;
    this.submitted = false;

    this.bindUi();
  }

  async init() {
    this.map = new MapView('map-container');
    this.map.onClick((coords) => this.onMapClick(coords));

    this.photo = new PhotoViewer({
      photo: this.els.photo,
      wrap: this.els.photoWrap,
      placeholder: this.els.photoPlaceholder,
      photoPrev: this.els.photoPrev,
      photoNext: this.els.photoNext,
      photoCounter: this.els.photoCounter,
      fitToggle: this.els.photoFitToggle,
      overlay: this.els.overlay,
      overlayImg: this.els.overlayImg
    });

    this.initResizer();
    this.initKeyboard();

    const modes = api.getModes();
    this.renderModeModal(modes);
    this.initMiniLeaderboard();
    this.selectModeCard('krasnoyarsk');

    try {
      this.devMode = new DevMode(this);
    } catch (e) {
      console.warn('DevMode не инициализировался:', e);
    }
  }

  initMiniLeaderboard() {
    const tabs = document.getElementById('lb-mini-tabs');
    if (!tabs) return;
    tabs.querySelectorAll('.lb-mini-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        this.selectModeCard(mode);
      });
    });
  }

  selectModeCard(mode) {
    this.miniLeaderboardMode = mode;

    if (this.els.modesGrid) {
      this.els.modesGrid.querySelectorAll('.mode-card-btn').forEach((card) => {
        card.classList.toggle('is-selected', card.dataset.mode === mode);
      });
    }

    const tabs = document.getElementById('lb-mini-tabs');
    if (tabs) {
      tabs.querySelectorAll('.lb-mini-tab').forEach((b) => {
        b.classList.toggle('active', b.dataset.mode === mode);
      });
    }

    this.loadMiniLeaderboard(mode);
  }

  async loadMiniLeaderboard(mode) {
    const listEl = document.getElementById('lb-mini-list');
    if (!listEl) return;
    listEl.innerHTML = '<div class="lb-mini-empty">Загрузка...</div>';
    try {
      const data = await api.getLeaderboard(mode);
      if (this.miniLeaderboardMode !== mode) return;
      const entries = Array.isArray(data.entries) ? data.entries : [];
      this.renderMiniLeaderboard(listEl, entries);
    } catch (e) {
      if (this.miniLeaderboardMode !== mode) return;
      listEl.innerHTML = '<div class="lb-mini-empty">Пока никто не играл</div>';
    }
  }

  renderMiniLeaderboard(listEl, entries) {
    if (!entries.length) {
      listEl.innerHTML = '<div class="lb-mini-empty">Пока никто не играл</div>';
      return;
    }
    const top = entries.slice(0, 10);
    listEl.innerHTML = top.map((e, i) => {
      const rank = i + 1;
      const medal = rank === 1 ? SVG_MEDAL_1 : rank === 2 ? SVG_MEDAL_2 : rank === 3 ? SVG_MEDAL_3 : '';
      const cls = i < 3 ? 'lb-mini-row lb-mini-top' : 'lb-mini-row';
      return `
        <div class="${cls}">
          <div class="lb-mini-rank">${medal}<span>${rank}. МЕСТО:</span></div>
          <div class="lb-mini-name">${escapeHtml(e.name)}</div>
          <div class="lb-mini-score">${e.score}</div>
        </div>
      `;
    }).join('');
  }

  renderModeModal(modes) {
    this.els.modesGrid.innerHTML = modes.map((m, idx) => `
      <div class="mode-card-btn ${idx === 0 ? 'is-selected' : ''}" data-mode="${m.id}" role="button" tabindex="0">
        <div class="mode-bg mode-bg-${m.id}"></div>
        <div class="mode-shade"></div>
        <div class="mode-content">
          <div class="mode-badge">${m.icon || ''}</div>
          <div class="mode-title-wrap">
            <span class="mode-title">${escapeHtml(m.label)}</span>
            <span class="mode-desc">${escapeHtml(m.description || '')}</span>
          </div>
          <div class="mode-play-reveal">
            <button type="button" class="mode-play-btn" data-play-mode="${m.id}">
              <span>ИГРАТЬ</span>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <polygon points="6 4 20 12 6 20 6 4"></polygon>
              </svg>
            </button>
          </div>
        </div>
      </div>
    `).join('');

    this.els.modesGrid.querySelectorAll('.mode-card-btn').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.mode-play-btn')) return;
        this.selectModeCard(card.dataset.mode);
      });
    });

    this.els.modesGrid.querySelectorAll('.mode-play-btn').forEach((playBtn) => {
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.startMode(playBtn.dataset.playMode);
      });
    });
  }

  showModeModal() {
    this.els.modeModal.style.display = 'flex';
    this.els.gameView.style.display = 'none';
    this.els.finalView.style.display = 'none';
    this.loadMiniLeaderboard(this.miniLeaderboardMode);
  }

  hideModeModal() { this.els.modeModal.style.display = 'none'; }

async startMode(mode) {
    if (this._busy) return;
    this._busy = true;
    try {
      const data = await api.startSession(mode);
      this.currentMode = mode;
      this.totalRounds = data.totalRounds;
      this.els.gameModeBadge.textContent = data.modeLabel;

      this.hideModeModal();
      this.els.gameView.style.display = 'flex';
      this.els.finalView.style.display = 'none';

      const round = await api.getRound();
      if (round.finished) return this.showFinal();
      this.setRound(round);
	} catch (e) {
      alert('Не удалось начать игру: ' + e.message);
    } finally {
      this._busy = false;
    }
}

  resetRoundUi() {
    this.guess = null;
    this.submitted = false;
    this.nextHint = 1;
    this.map.clearAll();
    this.els.hintOutput.innerHTML = '';
    this.els.result.innerHTML = '';
    this.els.status.textContent = '';
    this.els.submitBtn.disabled = true;
    this.els.submitBtn.style.display = 'block';
    this.els.nextBtn.style.display = 'none';
    this.updateHintButton();
  }

  setRound(round) {
    this.round = round;
    this.resetRoundUi();
    this.els.roundInfo.textContent = `Раунд ${round.roundNumber} / ${round.totalRounds}`;
    this.renderProgress(round.roundNumber, round.totalRounds);
    this.photo.setImages(round.images || []);
    this.map.resetView(this.currentMode);

    if (round.hintsApplied && round.hintsApplied.length) {
      for (const h of round.hintsApplied) {
        if (h.type === 'polygon') {
          const polys = h.polygons || (h.polygon ? [h.polygon] : []);
          this.map.addHintPolygon(polys, h.fillColor, h.strokeColor);
        } else if (h.type === 'circle') {
          this.map.addHintCircle(h.center, h.radius, h.fillColor, h.strokeColor);
        }
        this.appendHintLine(h.html);
        this.nextHint = Math.max(this.nextHint, h.level + 1);
      }
      this.updateHintButton();
    }
    if (round.submitted && round.submitResult) {
      this.submitted = true;
      this.renderResult(round.submitResult);
      this.map.addAnswer(round.submitResult.target, round.submitResult.guess, round.submitResult.nearestPoint);
    }
  }

	onMapClick(coords) {
    if (!this.round || this.submitted) return;
    if (!Array.isArray(coords) || coords.length !== 2 || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) return;
    this.guess = [Number(coords[0]), Number(coords[1])];
    this.map.setGuess(this.guess);
    this.els.submitBtn.disabled = false;
  }

  async submit() {
    if (this.submitted || !this.guess) return;
    this.submitted = true;
    this.els.submitBtn.disabled = true;
    try {
      const { result } = await api.submit(this.guess);
      this.renderResult(result);
      this.map.addAnswer(result.target, result.guess, result.nearestPoint);
    } catch (e) {
      this.submitted = false;
      this.els.submitBtn.disabled = false;
      alert('Ошибка отправки: ' + e.message);
    }
  }

  renderProgress(current, total) {
    const el = document.getElementById('round-progress');
    if (!el) return;
    el.innerHTML = '';
    for (let i = 1; i <= total; i++) {
      const dot = document.createElement('div');
      dot.className = 'rp-dot';
      if (i < current) dot.classList.add('done');
      else if (i === current) dot.classList.add('active');
      el.appendChild(dot);
    }
  }

  animateNumber(el, from, to, duration = 900) {
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(from + (to - from) * eased);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  renderResult(result) {
    const penaltyRow = result.hintsUsed && result.hintsUsed.length
      ? `<div class="result-row"><span>Штраф за подсказки</span><strong>x ${result.multiplier.toFixed(2)}</strong></div>`
      : '';
    this.els.result.innerHTML = `
      <div class="result-card">
        <div class="result-name">${escapeHtml(result.target.name)}</div>
        <div class="result-address">${escapeHtml(result.target.address)}</div>
        <div class="result-row"><span>Расстояние</span><strong>${formatDistance(result.distance)}</strong></div>
        ${penaltyRow}
        <div class="result-row highlight"><span>Очки</span><strong>${result.points} / 5000</strong></div>
      </div>
    `;
    this.els.submitBtn.style.display = 'none';
    this.els.nextBtn.style.display = 'block';
    const nextBtnText = this.els.nextBtn.querySelector('span');
    if (nextBtnText) {
      nextBtnText.textContent =
        result.roundNumber === this.totalRounds ? 'Показать итоги игры' : 'Следующий раунд';
    } else {
      this.els.nextBtn.textContent =
        result.roundNumber === this.totalRounds ? 'Показать итоги игры' : 'Следующий раунд';
    }
  }

async next() {
    if (this._busy) return;
    this._busy = true;
    this.els.nextBtn.disabled = true;
    try {
      const data = await api.next();
      if (data.finished) return this.showFinal();
      this.setRound(data);
    } catch (e) {
      alert('Ошибка перехода: ' + e.message);
    } finally {
      this._busy = false;
      this.els.nextBtn.disabled = false;
    }
  }

  async useHint() {
    if (this.submitted || !this.round) return;
    const level = this.nextHint;
    if (level > 3) return;

    this.els.hintBtn.disabled = true;
    try {
      const { hint, nextHint } = await api.requestHint(level);
      this.nextHint = nextHint;

      if (hint.type === 'polygon') {
        const polys = hint.polygons || (hint.polygon ? [h.polygon] : []);
        this.map.addHintPolygon(polys, hint.fillColor, hint.strokeColor);
      } else if (hint.type === 'circle') {
        this.map.addHintCircle(hint.center, hint.radius, hint.fillColor, hint.strokeColor);
      }
      this.appendHintLine(hint.html);
      this.updateHintButton();
    } catch (e) {
      this.els.hintBtn.disabled = false;
      alert('Ошибка подсказки: ' + e.message);
    }
  }

	appendHintLine(html) {
    const div = document.createElement('div');
    div.className = 'hint-line';
    const safe = escapeHtml(String(html || ''))
      .replace(/&lt;strong&gt;/gi, '<strong>')
      .replace(/&lt;\/strong&gt;/gi, '</strong>')
      .replace(/&lt;b&gt;/gi, '<b>')
      .replace(/&lt;\/b&gt;/gi, '</b>');
    div.innerHTML = safe;
    this.els.hintOutput.appendChild(div);
  }

  updateHintButton() {
    const penalties = { 1: '-15%', 2: '-30%', 3: '-50%' };
    const labelsByMode = {
      krasnoyarsk: { 1: 'Берег', 2: 'Район', 3: 'Зона 2 км' },
      sfu:         { 1: 'Берег', 2: 'Район', 3: 'Зона 2 км' },
      russia:      { 1: 'Европа/Азия', 2: 'Фед. округ', 3: 'Субъект РФ' }
    };
    const labels = labelsByMode[this.currentMode] || labelsByMode.krasnoyarsk;
    const lvl = this.nextHint;
    if (lvl > 3) {
      this.els.hintBtn.textContent = 'Все подсказки использованы';
      this.els.hintBtn.disabled = true;
      return;
    }
    this.els.hintBtn.textContent = `Подсказка: ${labels[lvl]} (${penalties[lvl]})`;
    this.els.hintBtn.disabled = false;
  }

  async showFinal() {
    try {
      const final = await api.final();
      this.renderFinal(final);
      this.els.gameView.style.display = 'none';
      this.els.finalView.style.display = 'flex';
      this.loadLeaderboardInto(final.mode);
    } catch (e) {
      alert('Ошибка финала: ' + e.message);
    }
  }

  renderFinal(final) {
    const pct = final.max > 0 ? Math.round((final.total / final.max) * 100) : 0;

    const rows = final.results.map((r, i) => {
      const hintMark = r.hintsUsed > 0
        ? `<span class="hint-mark">x${r.multiplier.toFixed(2)}</span>` : '';
      return `
        <div class="round-item" style="animation-delay: ${i * 60}ms;">
          <div class="ri-left">
            <div class="ri-name">Раунд ${r.roundNumber}. ${escapeHtml(r.name)}</div>
            <div class="ri-dist">${formatDistance(r.distance)} ${hintMark}</div>
          </div>
          <div class="ri-points">${r.points}</div>
        </div>
      `;
    }).join('');

    this.els.finalView.innerHTML = `
      <div class="final-hero">
        <span class="final-emoji">${SVG_TROPHY_HERO}</span>
        <div class="final-title">Игра завершена</div>
        <div class="final-subtitle">${final.results.length} раундов · ${escapeHtml(final.modeLabel)}</div>
      </div>

      <div class="final-total" id="final-total-num">0</div>
      <div class="final-total-label">из ${final.max} возможных баллов</div>
      <div class="final-progress"><div class="final-progress-bar" id="final-progress-bar"></div></div>

      ${rows}

      <div class="lb-block">
        <div class="lb-title">Таблица лидеров · ${escapeHtml(final.modeLabel)}</div>
        <div class="lb-input-row" id="lb-save-block">
          <input type="text" id="lb-name" placeholder="Ваше имя" maxlength="20" autocomplete="off">
          <button class="lb-save-btn" id="lb-save">Сохранить</button>
        </div>
        <div id="lb-list"><div class="lb-empty">Загрузка...</div></div>
      </div>

      <div class="final-buttons-title">Сыграть снова:</div>
      <button class="final-btn primary" id="final-replay-same">Повторить этот режим</button>
      <button class="final-btn" id="final-choose-mode">Выбрать другой режим</button>
    `;

    const totalEl = document.getElementById('final-total-num');
    if (totalEl) this.animateNumber(totalEl, 0, final.total, 1000);

    setTimeout(() => {
      const bar = document.getElementById('final-progress-bar');
      if (bar) bar.style.width = pct + '%';
    }, 100);

    document.getElementById('final-replay-same').addEventListener('click', () => {
      this.startMode(this.currentMode);
    });
    document.getElementById('final-choose-mode').addEventListener('click', () => {
      this.showModeModal();
    });

    document.getElementById('lb-save').addEventListener('click', () => this.saveLeaderboard());
    document.getElementById('lb-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.saveLeaderboard();
    });
  }

  async loadLeaderboardInto(mode) {
    const listEl = document.getElementById('lb-list');
    if (!listEl) return;
    try {
      const data = await api.getLeaderboard(mode);
      const entries = Array.isArray(data.entries) ? data.entries : [];
      this.renderLeaderboardList(listEl, entries, null);
    } catch (e) {
      listEl.innerHTML = `<div class="lb-empty">Не удалось загрузить: ${escapeHtml(e.message)}</div>`;
    }
  }

  renderLeaderboardList(listEl, entries, myScore) {
    if (!Array.isArray(entries)) entries = [];
    if (!entries.length) {
      listEl.innerHTML = `<div class="lb-empty">Пока никто не играл</div>`;
      return;
    }
    const rows = entries.map((e, i) => {
      const rank = i + 1;
      const isTop = rank <= 3;
      const isMe = myScore !== null && e.score === myScore && e._mine;
      const cls = ['lb-row', isTop ? 'lb-top' : '', isMe ? 'lb-me' : ''].filter(Boolean).join(' ');
      const medal = rank === 1 ? SVG_MEDAL_1 : rank === 2 ? SVG_MEDAL_2 : rank === 3 ? SVG_MEDAL_3 : rank;
      return `
        <div class="${cls}">
          <div class="lb-rank">${medal}</div>
          <div class="lb-name">${escapeHtml(e.name)}</div>
          <div class="lb-score">${e.score}</div>
        </div>
      `;
    }).join('');
    listEl.innerHTML = rows;
  }

async saveLeaderboard() {
    const nameInput = document.getElementById('lb-name');
    const saveBtn = document.getElementById('lb-save');
    const rawName = (nameInput.value || '').replace(/[\u0000-\u001F\u007F<>]/g, '').trim().slice(0, 20);
    if (!rawName) { nameInput.focus(); return; }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Сохраняем...';
    try {
      const data = await api.saveLeaderboardEntry(rawName);
      document.getElementById('lb-save-block').style.display = 'none';
      const listEl = document.getElementById('lb-list');
      const entries = Array.isArray(data.entries) ? data.entries : [];
      this.renderLeaderboardList(listEl, entries, data.yourScore);
    } catch (e) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Сохранить';
      alert('Ошибка сохранения: ' + e.message);
    }
  }

  bindUi() {
    this.els.submitBtn.addEventListener('click', () => this.submit());
    this.els.nextBtn.addEventListener('click', () => this.next());
    this.els.hintBtn.addEventListener('click', () => this.useHint());
    this.els.photoPrev.addEventListener('click', () => this.photo.prev());
    this.els.photoNext.addEventListener('click', () => this.photo.next());
    this.els.photoFullscreen.addEventListener('click', () => this.photo.openFullscreen());
    this.els.photoFitToggle.addEventListener('click', () => this.photo.toggleFit());
  }

  initResizer() {
    const { photoResizer: resizer, photoWrap: wrap, gameView } = this.els;
    if (!resizer || !wrap || !gameView) return;
    let dragging = false, startY = 0, startH = 0;
    resizer.addEventListener('mousedown', (e) => {
      dragging = true; startY = e.clientY; startH = wrap.offsetHeight;
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const delta = e.clientY - startY;
      const gameH = gameView.offsetHeight;
      const newH = Math.max(120, Math.min(gameH - 220, startH + delta));
      wrap.style.flexBasis = (newH / gameH * 100) + '%';
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });
  }

  initKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { this.photo.closeFullscreen(); return; }
      if (this.photo.isFullscreenOpen()) return;
      if (this.devMode && this.devMode.open) return;
      if (this.submitted || !this.round) return;
      if (e.key === 'ArrowLeft')  this.photo.prev();
      if (e.key === 'ArrowRight') this.photo.next();
    });
  }
}