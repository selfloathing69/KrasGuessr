export class MapView {
  constructor(containerId) {
    this.map = new ymaps.Map(containerId, {
      center: [56.0106, 92.8726],
      zoom: 12,
      controls: ['zoomControl', 'typeSelector']
    }, {
      yandexMapDisablePoiInteractivity: true,
      yandexMapType: 'driving',
      suppressMapOpenBlock: true
    });

    this.guessPlacemark = null;
    this._clickHandler = null;

    this.map.events.add('click', (e) => {
      if (this._clickHandler) this._clickHandler(e.get('coords'));
    });
  }

  onClick(fn) { this._clickHandler = fn; }

  clearAll() {
    this.map.geoObjects.removeAll();
    this.guessPlacemark = null;
  }

  setGuess(coords) {
    if (this.guessPlacemark) {
      this.guessPlacemark.geometry.setCoordinates(coords);
    } else {
      this.guessPlacemark = new ymaps.Placemark(coords, {}, {
        preset: 'islands#redDotIcon',
        interactive: false
      });
      this.map.geoObjects.add(this.guessPlacemark);
    }
  }

    addHintPolygon(polygons, fillColor, strokeColor) {
    if (!Array.isArray(polygons) || polygons.length === 0) return null;

    const objects = [];
    let totalPoints = 0;
    for (const ring of polygons) {
      if (!Array.isArray(ring) || ring.length < 3) continue;
      totalPoints += ring.length;
      try {
        const poly = new ymaps.Polygon([ring], {}, {
          fillColor, strokeColor,
          strokeWidth: 3, strokeStyle: 'solid',
          interactive: false
        });
        this.map.geoObjects.add(poly);
        objects.push(poly);
      } catch (e) {
        console.error('[addHintPolygon] ring failed:', ring.length, 'pts —', e);
      }
    }
    if (objects.length === 0) return null;

    console.log('[addHintPolygon] drew', objects.length, 'polygon(s), total pts:', totalPoints);

    try {
      const allPoints = polygons.flat();
      const bounds = ymaps.util.bounds.fromPoints(allPoints);
      this.map.setBounds(bounds, {
        checkZoomRange: true, zoomMargin: 30, duration: 500
      });
    } catch (e) {
      console.error('[addHintPolygon] setBounds failed:', e);
    }
    return objects;
  }

  addHintCircle(center, radius, fillColor, strokeColor) {
    const circle = new ymaps.Circle([center, radius], {}, {
      fillColor, strokeColor,
      strokeWidth: 2, strokeStyle: 'dash',
      interactive: false
    });
    this.map.geoObjects.add(circle);
    this.map.setBounds(circle.geometry.getBounds(), {
      checkZoomRange: true, zoomMargin: 40, duration: 500
    });
    return circle;
  }

    addAnswer(target, guess, nearestPoint) {

const safeName = String(target.name == null ? '' : target.name).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));

    this.map.geoObjects.add(new ymaps.Placemark(target.coords, {
      hintContent: safeName
    }, { preset: 'islands#greenDotIcon', interactive: false }));

 
    if (target.polygon && target.polygon.length >= 3) {
      this.map.geoObjects.add(new ymaps.Polygon([target.polygon], {}, {
        fillColor: '#10b98144',
        strokeColor: '#059669',
        strokeWidth: 2,
        interactive: false
      }));
    }

    const lineTo = nearestPoint || target.coords;

    this.map.geoObjects.add(new ymaps.Polyline([guess, lineTo], {}, {
      strokeColor: '#00000088',
      strokeWidth: 3,
      strokeStyle: 'shortdash',
      interactive: false
    }));

    if (nearestPoint) {
      this.map.geoObjects.add(new ymaps.Placemark(nearestPoint, {}, {
        preset: 'islands#blueDotIcon',
        interactive: false
      }));
    }

    this.map.setBounds(
      ymaps.util.bounds.fromPoints([guess, lineTo]),
      { checkZoomRange: true, zoomMargin: 60, duration: 400 }
    );
  }

  resetView(mode = 'krasnoyarsk') {
    if (mode === 'russia') {
      this.map.setCenter([62.0, 90.0], 3, { duration: 300 });
    } else {
      this.map.setCenter([56.0106, 92.8726], 12, { duration: 300 });
    }
  }
}