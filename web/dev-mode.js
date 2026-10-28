import { api } from './api.js';

const KEY_STORAGE = 'krasguessr_dev_key';

const SVG_PIN = `<svg class="svg-inline-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
const SVG_DISTRICT = `<svg class="svg-inline-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>`;
const SVG_WAVE = `<svg class="svg-inline-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12c2-2.5 4-2.5 6 0s4 2.5 6 0 4-2.5 6 0"/><path d="M2 17c2-2.5 4-2.5 6 0s4 2.5 6 0 4-2.5 6 0"/></svg>`;

export class DevMode {
  constructor(game) {
    this.game = game;
    this.open = false;
    this.disabled = false;
    this.data = null;
    this.filter = '';
    this.currentMode = 'krasnoyarsk';
    this.marker = null;
    this.polygon = null;
	this.key = sessionStorage.getItem(KEY_STORAGE) || '';

    this.els = {
      overlay: document.getElementById('dev-overlay'),
      search:  document.getElementById('dev-search'),
      tabs:    document.getElementById('dev-tabs'),
      list:    document.getElementById('dev-list'),
      close:   document.getElementById('dev-close')
    };

    if (!this.els.overlay || !this.els.close || !this.els.tabs ||
        !this.els.list || !this.els.search) {
      console.warn('DevMode: элементы #dev-* не найдены — отключено');
      this.disabled = true;
      return;
    }

    this.init();
  }

  init() {
    window.addEventListener('keydown', (e) => {
      if (this.disabled) return;
      if (e.ctrlKey && e.altKey && !e.shiftKey && e.code === 'KeyD') {
        e.preventDefault();
        e.stopPropagation();
        this.toggle();
        return;
      }
      if (this.open && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    }, true);

    this.els.close.addEventListener('click', () => this.close());

    this.els.search.addEventListener('input', () => {
      this.filter = this.els.search.value.trim().toLowerCase();
      this.renderList();
    });

    this.els.tabs.querySelectorAll('.dev-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.currentMode = btn.dataset.mode;
        this.els.tabs.querySelectorAll('.dev-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.filter = '';
        this.els.search.value = '';
        this.renderList();
      });
    });
  }

  async toggle() {
    if (this.disabled) return;
    if (this.open) return this.close();
    await this.openOverlay();
  }

  async openOverlay() {
    if (!this.key) {
      const input = prompt(
        'Dev-mode key (смотри в окне start.bat, строка DEV MODE KEY):'
      );
      if (!input || !input.trim()) return;
      this.key = input.trim().toUpperCase();
	sessionStorage.setItem(KEY_STORAGE, this.key);
    }

    if (!this.data) {
      try {
        this.data = await api.getDevLocations(this.key);
      } catch (e) {
        if (String(e.message).toLowerCase().includes('forbidden')) {
          sessionStorage.removeItem(KEY_STORAGE);
          this.key = '';
          alert('Dev-mode: неверный ключ. Смотри строку DEV MODE KEY в консоли start.bat.');
        } else {
          alert('Dev-mode: ' + e.message);
        }
        return;
      }
    }

    this.els.overlay.style.display = 'flex';
    this.open = true;
    this.els.search.focus();
    this.renderList();
  }

  close() {
    this.els.overlay.style.display = 'none';
    this.open = false;
  }

  renderList() {
    if (!this.data) return;
    const list = this.data[this.currentMode] || [];
    const q = this.filter;

    const filtered = q
      ? list.filter((loc) =>
          (loc.name     || '').toLowerCase().includes(q) ||
          (loc.address  || '').toLowerCase().includes(q) ||
          (loc.id       || '').toLowerCase().includes(q) ||
          (loc.district || '').toLowerCase().includes(q))
      : list;

    if (!filtered.length) {
      this.els.list.innerHTML = '<div class="dev-empty">Ничего не найдено</div>';
      return;
    }

    this.els.list.innerHTML = filtered.map((loc) => {
      const c = Array.isArray(loc.coords) ? loc.coords : [];
      const cStr = c.length === 2
        ? `${Number(c[0]).toFixed(5)}, ${Number(c[1]).toFixed(5)}`
        : '-';
      const hasPoly = Array.isArray(loc.polygon) && loc.polygon.length >= 3;
      const imgs = Array.isArray(loc.images) ? loc.images.length : 0;

      return `
        <div class="dev-item" data-id="${this.esc(loc.id)}">
          <div class="dev-item-head">
            <span class="dev-item-id">${this.esc(loc.id)}</span>
            <span class="dev-item-name">${this.esc(loc.name)}</span>
          </div>
          <div class="dev-item-meta">
            <span>${this.esc(loc.address || '')}</span>
          </div>
          <div class="dev-item-meta">
            <span>${SVG_PIN} ${cStr}</span>
            <span>${SVG_DISTRICT} ${this.esc(loc.district || '-')}</span>
            <span>${SVG_WAVE} ${this.esc(loc.bank || '-')}</span>
            ${hasPoly ? '<span class="dev-badge">полигон</span>' : ''}
            ${imgs > 1 ? `<span class="dev-badge">${imgs} фото</span>` : ''}
          </div>
        </div>
      `;
    }).join('');

    this.els.list.querySelectorAll('.dev-item').forEach((el) => {
      el.addEventListener('click', () => this.focusLocation(el.dataset.id));
    });
  }

  focusLocation(id) {
    if (!this.data) return;
    const list = this.data[this.currentMode] || [];
    const loc = list.find((l) => l.id === id);
    if (!loc) return;

    this.close();
    this.showInPanel(loc);
    this.showOnMap(loc);
  }

  showInPanel(loc) {
    const g = this.game;
    const els = g.els;

    els.modeModal.style.display = 'none';
    els.finalView.style.display = 'none';
    els.gameView.style.display = 'flex';

    els.gameModeBadge.textContent = 'DEV';
    els.roundInfo.textContent = loc.id;

    const hintsBlock = document.getElementById('hints-block');
    if (hintsBlock) hintsBlock.style.display = 'none';
    els.submitBtn.style.display = 'none';
    els.nextBtn.style.display = 'none';
    els.hintOutput.innerHTML = '';
    els.status.textContent = '';

    g.photo.setImages(Array.isArray(loc.images) ? loc.images : []);
    g.photo.fitMode = 'contain';
    g.photo.render();
    els.photoFitToggle.textContent = 'Fit';

    const c = Array.isArray(loc.coords) ? loc.coords : [];
    const coordStr = c.length === 2
      ? `${Number(c[0]).toFixed(6)}, ${Number(c[1]).toFixed(6)}`
      : '-';
    const hasPoly = Array.isArray(loc.polygon) && loc.polygon.length >= 3;
    const imgsCount = Array.isArray(loc.images) ? loc.images.length : 0;

    els.result.innerHTML = `
      <div class="dev-panel">
        <div class="dev-panel-id">${this.esc(loc.id)}</div>
        <div class="dev-panel-name">${this.esc(loc.name)}</div>
        <div class="dev-panel-address">${this.esc(loc.address || '')}</div>

        <div class="dev-panel-row"><span>Координаты:</span><strong>${coordStr}</strong></div>
        <div class="dev-panel-row"><span>Район/ФО:</span><strong>${this.esc(loc.district || loc.federal || '-')}</strong></div>
        <div class="dev-panel-row"><span>Берег/Регион:</span><strong>${this.esc(loc.bank || loc.region || '-')}</strong></div>
        <div class="dev-panel-row"><span>Полигон:</span><strong>${hasPoly ? loc.polygon.length + ' точек' : 'нет'}</strong></div>
        <div class="dev-panel-row"><span>Фото:</span><strong>${imgsCount}</strong></div>

        <button class="final-btn primary" id="dev-back-btn" style="margin-top:16px;">
          Вернуться к режимам
        </button>
      </div>
    `;

    document.getElementById('dev-back-btn').addEventListener('click', () => {
      this.restoreGameUi();
      g.showModeModal();
    });
  }

  restoreGameUi() {
    const els = this.game.els;
    const hintsBlock = document.getElementById('hints-block');
    if (hintsBlock) hintsBlock.style.display = '';
    els.result.innerHTML = '';
    els.gameModeBadge.textContent = 'Режим';
    els.roundInfo.textContent = 'Раунд - / -';
    this.game.photo.setImages([]);
  }

  showOnMap(loc) {
    const mapView = this.game.map;
    if (!mapView || !mapView.map) return;
    const map = mapView.map;

    if (this.marker)  { map.geoObjects.remove(this.marker);  this.marker = null; }
    if (this.polygon) { map.geoObjects.remove(this.polygon); this.polygon = null; }

    if (!Array.isArray(loc.coords) || loc.coords.length !== 2) return;
    const coords = [Number(loc.coords[0]), Number(loc.coords[1])];

	this.marker = new ymaps.Placemark(coords, {
      hintContent: this.esc(loc.name),
      balloonContent:
        `<strong>${this.esc(loc.name)}</strong><br>` +
        `${this.esc(loc.address || '')}<br>` +
        `<span style="color:#888;font-size:11px;">${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}</span>`
    }, { preset: 'islands#violetDotIcon' });
    map.geoObjects.add(this.marker);

    if (Array.isArray(loc.polygon) && loc.polygon.length >= 3) {
      this.polygon = new ymaps.Polygon([loc.polygon], {}, {
        fillColor:   '#8b5cf644',
        strokeColor: '#7c3aed',
        strokeWidth: 2,
        interactive: false
      });
      map.geoObjects.add(this.polygon);
      map.setBounds(this.polygon.geometry.getBounds(), {
        checkZoomRange: true, zoomMargin: 60, duration: 500
      });
    } else {
      map.setCenter(coords, 16, { duration: 500 });
    }
  }

  esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
}