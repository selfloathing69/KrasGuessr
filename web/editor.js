const KEY_STORAGE = 'krasguessr_dev_key';
let API_KEY = '';
let sessionKey = sessionStorage.getItem(KEY_STORAGE) || '';
let map = null;
let currentMode = 'krasnoyarsk';
let filter = '';
let data = { krasnoyarsk: [], sfu: [], russia: [] };
let selectedId = null;
let dirty = false;
let pickingCoords = false;

let marker = null;
let polygonObject = null;   // полигон текущей локации на карте
let pointMarkers = [];      // маркеры точек полигона
let pickingPointIndex = -1; // индекс точки, для которой сейчас берём координаты с карты
let formState = null;

const els = {
  tabs:       document.getElementById('editor-tabs'),
  search:     document.getElementById('editor-search'),
  save:       document.getElementById('editor-save'),
  list:       document.getElementById('editor-list'),
  formWrap:   document.getElementById('editor-form-wrap'),
  mapContainer: document.getElementById('editor-map'),
  pickBadge:  document.getElementById('editor-pick-badge'),
  toast:      document.getElementById('editor-toast')
};


function getApiKey() {
  return window.YANDEX_MAPS_API_KEY || prompt('Введите API-ключ Яндекс.Карт:');
}

function loadYmaps(key) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(key)}&lang=ru_RU`;
    script.onload = () => window.ymaps.ready(resolve);
    script.onerror = () => reject(new Error('Yandex Maps не загрузилась'));
    document.head.appendChild(script);
  });
}

function ensureKey() {
  if (!sessionKey) {
    const input = prompt('Dev-key (смотри строку DEV MODE KEY в консоли start.bat):');
    if (!input || !input.trim()) {
      document.body.innerHTML = '<p style="padding:40px;font-family:sans-serif;">Без ключа работать не будет.</p>';
      throw new Error('No key');
    }
    sessionKey = input.trim().toUpperCase();
	sessionKey = input.trim().toUpperCase();
    sessionStorage.setItem(KEY_STORAGE, sessionKey);
  }
}

async function fetchData() {
  const res = await fetch('/api/dev/locations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ key: sessionKey })
  });
  if (res.status === 403) {
    sessionStorage.removeItem(KEY_STORAGE);
    throw new Error('Неверный ключ. Перезапусти - спросит заново.');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  data.krasnoyarsk = json.krasnoyarsk || [];
  data.sfu         = json.sfu || [];
  data.russia      = json.russia || [];
}

async function saveLocation(mode, id, patch) {
  const res = await fetch('/api/dev/update-location', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ key: sessionKey, mode, id, patch })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

async function addLocation(mode, location) {
  const res = await fetch('/api/dev/add-location', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ key: sessionKey, mode, location })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

async function deleteLocation(mode, id) {
  const res = await fetch('/api/dev/delete-location', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ key: sessionKey, mode, id })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}


function toast(msg, type = '') {
  els.toast.textContent = msg;
  els.toast.className = type;
  els.toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => els.toast.classList.remove('show'), 2200);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function renderList() {
  const list = data[currentMode] || [];
  const q = filter.toLowerCase();
  const filtered = q
    ? list.filter((l) =>
        (l.name || '').toLowerCase().includes(q) ||
        (l.address || '').toLowerCase().includes(q) ||
        (l.id || '').toLowerCase().includes(q))
    : list;

  if (!filtered.length) {
    els.list.innerHTML = '<div class="editor-empty">Ничего не найдено</div>';
    return;
  }

  els.list.innerHTML = filtered.map((l) => `
    <div class="editor-item ${l.id === selectedId ? 'active' : ''}" data-id="${esc(l.id)}">
      <div class="editor-item-id">${esc(l.id)}</div>
      <div class="editor-item-name">${esc(l.name)}</div>
      <div class="editor-item-addr">${esc(l.address || '')}</div>
    </div>
  `).join('');

  els.list.querySelectorAll('.editor-item').forEach((el) => {
    el.addEventListener('click', () => selectLocation(el.dataset.id));
  });
}


function fieldHtml(label, id, value, opts = {}) {
  const type = opts.type || 'text';
  const placeholder = opts.placeholder || '';
  return `
    <div class="editor-field">
      <label for="${id}">${label}</label>
      <input type="${type}" id="${id}" value="${esc(value)}" placeholder="${esc(placeholder)}">
    </div>
  `;
}

function renderForm() {
  const loc = (data[currentMode] || []).find((l) => l.id === selectedId);
  if (!loc) {
    els.formWrap.innerHTML = '<div class="editor-empty">Выбери локацию слева или нажми «+ Локация»</div>';
    return;
  }

  const isRussia = currentMode === 'russia';
  const coords = Array.isArray(loc.coords) ? loc.coords : [0, 0];
  const images = Array.isArray(loc.images) ? loc.images : [''];
  const polygon = Array.isArray(loc.polygon) ? loc.polygon : null;

  formState = formState || {};
  formState.images = images.slice();
  formState.polygon = polygon ? polygon.map((p) => [Number(p[0]), Number(p[1])]) : null;

  els.formWrap.innerHTML = `
    <div class="editor-form-title">${esc(loc.name)}</div>
    <div class="editor-form-sub">${esc(loc.id)} · ${esc(currentMode)}</div>

    ${fieldHtml('Название', 'f-name', loc.name || '')}
    ${fieldHtml('Адрес', 'f-address', loc.address || '')}

    <div class="editor-field">
      <label>Координаты (центр объекта)</label>
      <div class="editor-coords-row">
        <input type="number" id="f-lat" step="0.000001" value="${coords[0]}" placeholder="lat">
        <input type="number" id="f-lon" step="0.000001" value="${coords[1]}" placeholder="lon">
      </div>
      <button class="editor-coords-pick" id="f-pick">📍 Взять с карты</button>
    </div>

    ${isRussia
      ? fieldHtml('Федеральный округ', 'f-federal', loc.federal || '', { placeholder: 'ЦФО / СЗФО / ...' }) +
        fieldHtml('Регион (субъект РФ)', 'f-region', loc.region || '')
      : fieldHtml('Район', 'f-district', loc.district || '') +
        fieldHtml('Берег (left / right)', 'f-bank', loc.bank || '')
    }

    <div class="editor-field">
      <label>Полигон (опционально)</label>
      <div id="f-poly-wrap"></div>
    </div>

    <div class="editor-field">
      <label>Фотографии</label>
      <div class="editor-images" id="f-images"></div>
      <button class="editor-image-add" id="f-img-add">+ Добавить фото</button>
    </div>

    <div class="editor-form-actions">
      <button class="editor-btn" id="f-reset">Отменить изменения</button>
      <button class="editor-btn-danger" id="f-delete">🗑 Удалить локацию</button>
    </div>
    <div class="editor-dirty" id="f-dirty" style="display:none;">● Есть несохранённые изменения</div>
  `;

  renderPolygonSection();
  renderImages(images);
  bindFormEvents(loc);
  drawPolygonOnMap();
}

function renderPolygonSection() {
  const wrap = document.getElementById('f-poly-wrap');
  if (!wrap) return;

  if (!formState.polygon) {
    wrap.innerHTML = `
      <button class="editor-poly-create" id="f-poly-create">+ Создать полигон</button>
      <div class="editor-poly-hint">Полигон нужен для объектов, у которых важно попадание внутрь, а не в центр: мосты, парки, набережные.</div>
    `;
    document.getElementById('f-poly-create').addEventListener('click', () => {
      formState.polygon = [];
      renderPolygonSection();
      drawPolygonOnMap();
      markDirty();
    });
    return;
  }

  const pts = formState.polygon;
  const rowsHtml = pts.map((pt, i) => `
    <div class="editor-poly-row" data-i="${i}">
      <span class="editor-poly-idx">${i + 1}</span>
      <input type="number" class="editor-poly-lat" step="0.000001" value="${pt[0]}" placeholder="lat">
      <input type="number" class="editor-poly-lon" step="0.000001" value="${pt[1]}" placeholder="lon">
      <button class="editor-poly-mini editor-poly-mini-pick" data-i="${i}" title="Взять с карты">📍</button>
      <button class="editor-poly-mini editor-poly-mini-remove" data-i="${i}" title="Удалить точку">✕</button>
    </div>
  `).join('');

  wrap.innerHTML = `
    <div class="editor-poly-section">
      <div class="editor-poly-head">
        <span class="editor-poly-title">Полигон</span>
        <span class="editor-poly-count">${pts.length} ${pts.length === 1 ? 'точка' : pts.length < 5 ? 'точки' : 'точек'}</span>
      </div>
      <div class="editor-poly-points">${rowsHtml || '<div class="editor-poly-hint">Нет точек. Добавь минимум 3.</div>'}</div>
      <div class="editor-poly-actions">
        <button class="editor-poly-add" id="f-poly-add">+ Точка</button>
        <button class="editor-poly-clear" id="f-poly-clear">Удалить полигон</button>
      </div>
      <div class="editor-poly-hint">📍 — взять координаты точки с карты (следующий клик). Порядок обхода — любой. Замыкание автоматическое.</div>
    </div>
  `;

  wrap.querySelectorAll('.editor-poly-lat, .editor-poly-lon').forEach((inp) => {
    inp.addEventListener('input', () => {
      const i = Number(inp.closest('.editor-poly-row').dataset.i);
      const row = inp.closest('.editor-poly-row');
      const lat = parseFloat(row.querySelector('.editor-poly-lat').value);
      const lon = parseFloat(row.querySelector('.editor-poly-lon').value);
      if (!isNaN(lat) && !isNaN(lon)) {
        formState.polygon[i] = [lat, lon];
        drawPolygonOnMap();
        markDirty();
      }
    });
  });

  wrap.querySelectorAll('.editor-poly-mini-pick').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.i);
      pickingPointIndex = i;
      pickingCoords = false;
      wrap.querySelectorAll('.editor-poly-mini-pick').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      els.pickBadge.textContent = `📍 Клик по карте — точка ${i + 1} полигона`;
      els.pickBadge.style.display = 'block';
    });
  });

  wrap.querySelectorAll('.editor-poly-mini-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.i);
      formState.polygon.splice(i, 1);
      renderPolygonSection();
      drawPolygonOnMap();
      markDirty();
    });
  });

  document.getElementById('f-poly-add').addEventListener('click', () => {
    formState.polygon.push([0, 0]);
    renderPolygonSection();
    markDirty();
  });

  document.getElementById('f-poly-clear').addEventListener('click', () => {
    if (!confirm('Удалить весь полигон?')) return;
    formState.polygon = null;
    renderPolygonSection();
    drawPolygonOnMap();
    markDirty();
  });
}

function renderImages(images) {
  const wrap = document.getElementById('f-images');
  if (!wrap) return;
  formState = formState || {};
  formState.images = images.slice();

  wrap.innerHTML = images.map((url, i) => `
    <div class="editor-image-row" data-i="${i}">
      <div class="editor-image-preview" ${url ? 'data-fullscreen="1"' : ''}>
        ${url ? `<img src="${esc(url)}" alt="" onerror="this.parentNode.innerHTML='⚠️';">` : '🖼'}
      </div>
      <div class="editor-image-body">
        <input type="text" class="editor-image-input" value="${esc(url)}" placeholder="https://...">
      </div>
      <button class="editor-image-remove" data-i="${i}" title="Удалить">✕</button>
    </div>
  `).join('');

  wrap.querySelectorAll('.editor-image-preview[data-fullscreen]').forEach((el) => {
    el.style.cursor = 'zoom-in';
    el.addEventListener('click', () => {
      const img = el.querySelector('img');
      if (!img || !img.src) return;
      const ov = document.getElementById('editor-img-overlay');
      const full = document.getElementById('editor-img-full');
      full.src = img.src;
      ov.classList.add('open');
    });
  });

  wrap.querySelectorAll('.editor-image-input').forEach((inp) => {
    inp.addEventListener('input', () => {
      const i = Number(inp.closest('.editor-image-row').dataset.i);
      formState.images[i] = inp.value;
      markDirty();
    });
    inp.addEventListener('blur', () => {
      const i = Number(inp.closest('.editor-image-row').dataset.i);
      formState.images[i] = inp.value;
      renderImages(formState.images);
    });
  });

  wrap.querySelectorAll('.editor-image-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.i);
      formState.images.splice(i, 1);
      if (!formState.images.length) formState.images = [''];
      renderImages(formState.images);
      markDirty();
    });
  });
}

function bindFormEvents(loc) {
  document.getElementById('f-name')?.addEventListener('input', markDirty);
  document.getElementById('f-address')?.addEventListener('input', markDirty);
  document.getElementById('f-lat')?.addEventListener('input', markDirty);
  document.getElementById('f-lon')?.addEventListener('input', markDirty);
  ['f-district','f-bank','f-federal','f-region'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', markDirty);
  });

  document.getElementById('f-img-add')?.addEventListener('click', () => {
    formState.images = formState.images || [];
    formState.images.push('');
    renderImages(formState.images);
    markDirty();
  });

  document.getElementById('f-reset')?.addEventListener('click', () => {
    if (!confirm('Отменить все изменения?')) return;
    dirty = false;
    els.save.disabled = true;
    renderForm();
    updateDirtyIndicator();
  });

  document.getElementById('f-delete')?.addEventListener('click', async () => {
    if (!confirm(`Удалить локацию «${loc.name}»?\nЭто действие нельзя отменить.`)) return;
    try {
      await deleteLocation(currentMode, loc.id);
      const idx = data[currentMode].findIndex((l) => l.id === loc.id);
      if (idx >= 0) data[currentMode].splice(idx, 1);
      selectedId = null;
      dirty = false;
      els.save.disabled = true;
      clearMapObjects();
      renderList();
      renderForm();
      toast('✓ Локация удалена', 'success');
    } catch (e) {
      toast('Ошибка: ' + e.message, 'error');
    }
  });

  document.getElementById('f-pick')?.addEventListener('click', () => {
    pickingCoords = !pickingCoords;
    pickingPointIndex = -1;
    const btn = document.getElementById('f-pick');
    btn.classList.toggle('active', pickingCoords);
    btn.textContent = pickingCoords ? '📍 Кликни по карте…' : '📍 Взять с карты';
    els.pickBadge.textContent = '📍 Клик по карте — взять координаты';
    els.pickBadge.style.display = pickingCoords ? 'block' : 'none';
  });
}

function markDirty() {
  dirty = true;
  els.save.disabled = false;
  updateDirtyIndicator();
}

function updateDirtyIndicator() {
  const el = document.getElementById('f-dirty');
  if (el) el.style.display = dirty ? 'block' : 'none';
}


function clearMapObjects() {
  if (!map) return;
  if (marker) { map.geoObjects.remove(marker); marker = null; }
  if (polygonObject) { map.geoObjects.remove(polygonObject); polygonObject = null; }
  pointMarkers.forEach((m) => map.geoObjects.remove(m));
  pointMarkers = [];
}

function drawPolygonOnMap() {
  if (!map) return;

  if (polygonObject) { map.geoObjects.remove(polygonObject); polygonObject = null; }
  pointMarkers.forEach((m) => map.geoObjects.remove(m));
  pointMarkers = [];

  const pts = formState?.polygon;
  if (!pts || pts.length === 0) return;

  const valid = pts.filter((p) => Array.isArray(p) && p.length === 2 &&
    !isNaN(p[0]) && !isNaN(p[1]) && !(p[0] === 0 && p[1] === 0));

  if (valid.length >= 3) {
    try {
      polygonObject = new ymaps.Polygon([valid], {}, {
        fillColor: '#8b5cf644',
        strokeColor: '#7c3aed',
        strokeWidth: 2,
        interactive: false
      });
      map.geoObjects.add(polygonObject);
    } catch (e) {
      console.error('Polygon draw failed:', e);
    }
  }

  pts.forEach((p, i) => {
    if (!Array.isArray(p) || p.length !== 2) return;
    if (isNaN(p[0]) || isNaN(p[1])) return;
    if (p[0] === 0 && p[1] === 0) return;
    const m = new ymaps.Placemark(p, {
      hintContent: `Точка ${i + 1}`
    }, { preset: 'islands#violetIcon' });
    map.geoObjects.add(m);
    pointMarkers.push(m);
  });
}

function selectLocation(id) {
  if (dirty && !confirm('Есть несохранённые изменения. Переключиться без сохранения?')) return;
  dirty = false;
  els.save.disabled = true;
  selectedId = id;
  pickingCoords = false;
  pickingPointIndex = -1;

  clearMapObjects();
  formState = null;

  renderForm();
  renderList();
  const loc = (data[currentMode] || []).find((l) => l.id === id);
  if (!loc || !Array.isArray(loc.coords) || loc.coords.length !== 2) return;

  const coords = [Number(loc.coords[0]), Number(loc.coords[1])];
  if (isNaN(coords[0]) || isNaN(coords[1])) return;

  if (map) {
    marker = new ymaps.Placemark(coords, {}, { preset: 'islands#redDotIcon' });
    map.geoObjects.add(marker);

    try {
      if (polygonObject) {
        map.setBounds(polygonObject.geometry.getBounds(), {
          checkZoomRange: true,
          zoomMargin: 60,
          duration: 400
        });
      } else {
        map.setCenter(coords, 16, { duration: 400 });
      }
    } catch (e) {
      console.warn('View adjust failed, fallback to center:', e);
      map.setCenter(coords, 16, { duration: 400 });
    }
  }
}


async function saveCurrent() {
  const loc = (data[currentMode] || []).find((l) => l.id === selectedId);
  if (!loc) return;

  const lat = parseFloat(document.getElementById('f-lat').value);
  const lon = parseFloat(document.getElementById('f-lon').value);
  if (isNaN(lat) || isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    toast('Некорректные координаты центра', 'error');
    return;
  }

  let polygonPayload = null;
  if (formState.polygon && formState.polygon.length > 0) {
    const cleaned = [];
    for (const p of formState.polygon) {
      if (!Array.isArray(p) || p.length !== 2) continue;
      const pl = parseFloat(p[0]);
      const pn = parseFloat(p[1]);
      if (isNaN(pl) || isNaN(pn)) continue;
      if (pl === 0 && pn === 0) continue;
      cleaned.push([pl, pn]);
    }
    if (cleaned.length > 0 && cleaned.length < 3) {
      toast('Полигон должен содержать минимум 3 точки', 'error');
      return;
    }
    polygonPayload = cleaned.length >= 3 ? cleaned : null;
  }

  const patch = {
    name:    document.getElementById('f-name').value.trim(),
    address: document.getElementById('f-address').value.trim(),
    coords:  [lat, lon],
    images:  (formState.images || []).filter((s) => s && s.trim()),
    polygon: polygonPayload
  };

  if (currentMode === 'russia') {
    patch.federal = document.getElementById('f-federal').value.trim();
    patch.region  = document.getElementById('f-region').value.trim();
  } else {
    patch.district = document.getElementById('f-district').value.trim();
    patch.bank     = document.getElementById('f-bank').value.trim();
  }

  els.save.disabled = true;
  try {
    const res = await saveLocation(currentMode, loc.id, patch);
    const updated = res.location;
    const idx = data[currentMode].findIndex((l) => l.id === loc.id);
    if (idx >= 0) data[currentMode][idx] = updated;

    dirty = false;
    updateDirtyIndicator();
    toast('Сохранено', 'success');
    renderList();
    renderForm();
  } catch (e) {
    toast('Ошибка: ' + e.message, 'error');
    els.save.disabled = false;
  }
}


async function init() {
  try {
    ensureKey();
  } catch { return; }

  try {
    await fetchData();
  } catch (e) {
    document.body.innerHTML = `<p style="padding:40px;font-family:sans-serif;">${esc(e.message)}</p>`;
    return;
  }

  API_KEY = getApiKey();
  await loadYmaps(API_KEY);

  map = new ymaps.Map('editor-map', {
    center: [56.0106, 92.8726],
    zoom: 12,
    controls: ['zoomControl', 'typeSelector']
  }, {
    yandexMapDisablePoiInteractivity: true,
    suppressMapOpenBlock: true
  });

  map.events.add('click', (e) => {
    const coords = e.get('coords');

    if (pickingCoords) {
      const latInput = document.getElementById('f-lat');
      const lonInput = document.getElementById('f-lon');
      if (!latInput || !lonInput) return;
      latInput.value = coords[0].toFixed(6);
      lonInput.value = coords[1].toFixed(6);

      if (marker) map.geoObjects.remove(marker);
      marker = new ymaps.Placemark(coords, {}, { preset: 'islands#redDotIcon' });
      map.geoObjects.add(marker);

      pickingCoords = false;
      const btn = document.getElementById('f-pick');
      if (btn) { btn.classList.remove('active'); btn.textContent = '📍 Взять с карты'; }
      els.pickBadge.style.display = 'none';
      markDirty();
      return;
    }

    if (pickingPointIndex >= 0 && formState?.polygon) {
      const i = pickingPointIndex;
      formState.polygon[i] = [Number(coords[0].toFixed(6)), Number(coords[1].toFixed(6))];
      pickingPointIndex = -1;
      els.pickBadge.style.display = 'none';
      drawPolygonOnMap();
      renderPolygonSection();
      markDirty();
      return;
    }
  });

  els.tabs.querySelectorAll('.editor-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (dirty && !confirm('Есть несохранённые изменения. Переключиться?')) return;
      dirty = false;
      els.save.disabled = true;
      els.tabs.querySelectorAll('.editor-tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentMode = btn.dataset.mode;
      selectedId = null;
      filter = '';
      els.search.value = '';
      els.formWrap.innerHTML = '<div class="editor-empty">Выбери локацию слева</div>';

      if (currentMode === 'russia') {
        map.setCenter([62, 90], 3, { duration: 400 });
      } else {
        map.setCenter([56.0106, 92.8726], 12, { duration: 400 });
      }
      renderList();
    });
  });

  els.search.addEventListener('input', () => {
    filter = els.search.value.trim();
    renderList();
  });

  els.save.addEventListener('click', saveCurrent);

    document.getElementById('editor-add').addEventListener('click', async () => {
    if (dirty && !confirm('Есть несохранённые изменения. Продолжить?')) return;

    const name = prompt('Название новой локации:', 'Новая локация');
    if (!name) return;

    let coords = [0, 0];
    if (map) {
      const c = map.getCenter();
      coords = [Number(c[0].toFixed(6)), Number(c[1].toFixed(6))];
    }

    try {
      const res = await addLocation(currentMode, {
        name: name.trim(),
        coords,
        address: '',
        images: [''],
        ...(currentMode === 'russia'
          ? { federal: '', region: '' }
          : { district: '', bank: '' })
      });

      data[currentMode].push(res.location);
      dirty = false;
      els.save.disabled = true;
      selectLocation(res.location.id);
      toast('Локация добавлена', 'success');
    } catch (e) {
      toast('Ошибка: ' + e.message, 'error');
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  const imgOverlay = document.getElementById('editor-img-overlay');
  if (imgOverlay) {
    imgOverlay.addEventListener('click', () => {
      imgOverlay.classList.remove('open');
      document.getElementById('editor-img-full').src = '';
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && imgOverlay.classList.contains('open')) {
        imgOverlay.classList.remove('open');
        document.getElementById('editor-img-full').src = '';
      }
    });
  }

  renderList();
}

init();
// bri'ish innit aye mate?