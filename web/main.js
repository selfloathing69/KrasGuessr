import { Game } from './game.js';

function getApiKey() {
  if (window.YANDEX_MAPS_API_KEY && window.YANDEX_MAPS_API_KEY !== 'ВАШ_API_КЛЮЧ') {
    return window.YANDEX_MAPS_API_KEY;
  }
  const saved = localStorage.getItem('krasguessr_ymaps_key');
  if (saved) return saved;
  const key = prompt('Введите API-ключ Яндекс Карт (JS API 2.1):');
  if (key && key.trim()) {
    localStorage.setItem('krasguessr_ymaps_key', key.trim());
    return key.trim();
  }
  return null;
}

function loadYmaps(key) {
  return new Promise((resolve, reject) => {
    if (window.ymaps && window.ymaps.ready) return window.ymaps.ready(resolve);
    const script = document.createElement('script');
    script.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(key)}&lang=ru_RU`;
    script.onload = () => window.ymaps.ready(resolve);
    script.onerror = () => reject(new Error('Не удалось загрузить Яндекс.Карты'));
    document.head.appendChild(script);
  });
}

(async () => {
  const key = getApiKey();
  if (!key) {
    document.body.innerHTML = '<p style="padding:40px;font-family:sans-serif;">Не задан API-ключ Яндекс Карт. Добавьте его в <code>web/config.js</code>.</p>';
    return;
  }
  try {
    await loadYmaps(key);
  } catch (e) {
    document.body.innerHTML = `<p style="padding:40px;font-family:sans-serif;">Ошибка Яндекс.Карт: ${e.message}</p>`;
    return;
  }

  const game = new Game();
  await game.init();
})();