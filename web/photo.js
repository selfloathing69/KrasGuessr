export class PhotoViewer {
  constructor(els) {
    this.els = els;
    this.images = [];
    this.index = 0;
    this.fitMode = 'contain';

    // Fullscreen
    this.fsOpen = false;
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.dragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragStartTx = 0;
    this.dragStartTy = 0;

    this.initFullscreen();
  }

  // ---------- Photo strip ----------
  setImages(images) {
    this.images = Array.isArray(images) ? images : [];
    this.index = 0;
    this.render();
  }

  render() {
    const { photo, photoPrev, photoNext, photoCounter, placeholder, wrap } = this.els;
    const total = this.images.length;

    if (!total) {
      photo.style.display = 'none';
      placeholder.style.display = 'flex';
      photoPrev.style.display = 'none';
      photoNext.style.display = 'none';
      photoCounter.style.display = 'none';
      return;
    }

    placeholder.style.display = 'none';
    photo.style.display = 'block';

    if (total > 1) {
      photoPrev.style.display = 'flex';
      photoNext.style.display = 'flex';
      photoCounter.style.display = 'block';
      photoCounter.textContent = `${this.index + 1} / ${total}`;
    } else {
      photoPrev.style.display = 'none';
      photoNext.style.display = 'none';
      photoCounter.style.display = 'none';
    }

    photo.onerror = () => {
      const src = photo.src;
      if (src.includes('/L_height')) {
        photo.src = src.replace('/L_height', '/XXXL');
      }
    };

    photo.src = this.images[this.index];
    wrap.classList.toggle('mode-contain', this.fitMode === 'contain');
    wrap.classList.toggle('mode-cover',   this.fitMode === 'cover');
  }

  prev() {
    if (this.images.length < 2) return;
    this.index = (this.index - 1 + this.images.length) % this.images.length;
    this.render();
  }

  next() {
    if (this.images.length < 2) return;
    this.index = (this.index + 1) % this.images.length;
    this.render();
  }

  toggleFit() {
    this.fitMode = this.fitMode === 'contain' ? 'cover' : 'contain';
    this.render();
    this.els.fitToggle.textContent = this.fitMode === 'contain' ? 'Fit' : 'Fill';
  }

  // ---------- Fullscreen ----------
  isFullscreenOpen() { return this.fsOpen; }

  openFullscreen() {
    const src = this.els.photo.src;
    if (!src || this.images.length === 0) return;
    this.els.overlayImg.src = src;
    this.resetFs();
    this.els.overlay.classList.add('open');
    this.fsOpen = true;
  }

  closeFullscreen() {
    if (!this.fsOpen) return;
    this.els.overlay.classList.remove('open');
    this.els.overlay.classList.remove('grabbing');
    this.fsOpen = false;
    this.dragging = false;
  }

  resetFs() {
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.applyFs();
  }

  applyFs() {
    this.els.overlayImg.style.transform =
      `translate(-50%, -50%) translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
  }

  zoomFs(factor, cx, cy) {
    const newScale = Math.max(1, Math.min(10, this.scale * factor));
    if (newScale === this.scale) return;
    const ratio = newScale / this.scale;
    this.tx = cx - (cx - this.tx) * ratio;
    this.ty = cy - (cy - this.ty) * ratio;
    this.scale = newScale;
    this.clampFs();
    this.applyFs();
  }

  clampFs() {
    const rect = this.els.overlay.getBoundingClientRect();
    const maxTx = rect.width  * (this.scale - 1) / 2 + 100;
    const maxTy = rect.height * (this.scale - 1) / 2 + 100;
    this.tx = Math.max(-maxTx, Math.min(maxTx, this.tx));
    this.ty = Math.max(-maxTy, Math.min(maxTy, this.ty));
  }

  initFullscreen() {
    const ov  = this.els.overlay;
    const img = this.els.overlayImg;

    ov.addEventListener('wheel', (e) => {
      if (!this.fsOpen) return;
      e.preventDefault();
      const rect = ov.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top  - rect.height / 2;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      this.zoomFs(factor, cx, cy);
    }, { passive: false });

    ov.addEventListener('mousedown', (e) => {
      if (!this.fsOpen) return;
      if (e.button !== 0) return;
      this.dragging = true;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.dragStartTx = this.tx;
      this.dragStartTy = this.ty;
      ov.classList.add('grabbing');
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.dragging) return;
      this.tx = this.dragStartTx + (e.clientX - this.dragStartX);
      this.ty = this.dragStartTy + (e.clientY - this.dragStartY);
      this.clampFs();
      this.applyFs();
    });

    document.addEventListener('mouseup', () => {
      if (!this.dragging) return;
      this.dragging = false;
      ov.classList.remove('grabbing');
    });

    ov.addEventListener('contextmenu', (e) => {
      if (!this.fsOpen) return;
      e.preventDefault();
      this.closeFullscreen();
    });

    ov.addEventListener('dblclick', (e) => {
      if (!this.fsOpen) return;
      const rect = ov.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top  - rect.height / 2;
      if (this.scale > 1.2) {
        this.resetFs();
      } else {
        this.zoomFs(2, cx, cy);
      }
    });

    const zoomInBtn  = document.getElementById('fs-zoom-in');
    const zoomOutBtn = document.getElementById('fs-zoom-out');
    const resetBtn   = document.getElementById('fs-reset');
    const closeBtn   = document.getElementById('fs-close');

    if (zoomInBtn)  zoomInBtn.addEventListener('click',  (e) => { e.stopPropagation(); this.zoomFs(1.3, 0, 0); });
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', (e) => { e.stopPropagation(); this.zoomFs(1 / 1.3, 0, 0); });
    if (resetBtn)   resetBtn.addEventListener('click',   (e) => { e.stopPropagation(); this.resetFs(); });
    if (closeBtn)   closeBtn.addEventListener('click',   (e) => { e.stopPropagation(); this.closeFullscreen(); });
  }
}