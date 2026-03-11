/* ============================================
   YOURPASS BÉNIN — main.js
   Interactions, animations, état global
   ============================================ */

// ---- STATE GLOBAL ----
const YP = {
  cart: JSON.parse(localStorage.getItem('yp_cart') || '[]'),
  user: JSON.parse(localStorage.getItem('yp_user') || 'null'),
  wishlist: JSON.parse(localStorage.getItem('yp_wishlist') || '[]'),
  sereniteEnabled: false,

  saveCart() { localStorage.setItem('yp_cart', JSON.stringify(this.cart)); },
  saveUser() { localStorage.setItem('yp_user', JSON.stringify(this.user)); },
  saveWishlist() { localStorage.setItem('yp_wishlist', JSON.stringify(this.wishlist)); },

  addToCart(event) {
    const existing = this.cart.find(i => i.id === event.id);
    if (!existing) {
      this.cart.push({ ...event, qty: 1 });
      this.saveCart();
      updateCartBadge();
      showToast(`🎫 "${event.title}" ajouté !`, 'success');
      return true;
    }
    showToast('Déjà dans votre panier', 'info');
    return false;
  },

  toggleWishlist(id) {
    const idx = this.wishlist.indexOf(id);
    if (idx === -1) { this.wishlist.push(id); showToast('❤️ Ajouté aux favoris', 'success'); }
    else { this.wishlist.splice(idx, 1); showToast('Retiré des favoris', 'info'); }
    this.saveWishlist();
  },

  isWished(id) { return this.wishlist.includes(id); }
};

// ---- PAGE LOADER ----
window.addEventListener('load', () => {
  const loader = document.querySelector('.page-loader');
  if (loader) {
    setTimeout(() => {
      loader.classList.add('hidden');
      setTimeout(() => loader.remove(), 500);
    }, 1400);
  }
  initReveal();
  initNavbar();
  initParticles();
});

// ---- NAVBAR ----
function initNavbar() {
  const navbar = document.querySelector('.navbar');
  if (!navbar) return;

  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 40);
  });

  // Mobile menu
  const hamburger = document.querySelector('.hamburger');
  const mobileNav = document.querySelector('.mobile-nav');
  if (hamburger && mobileNav) {
    hamburger.addEventListener('click', () => {
      mobileNav.classList.toggle('open');
      const bars = hamburger.querySelectorAll('span');
      const isOpen = mobileNav.classList.contains('open');
      bars[0].style.transform = isOpen ? 'translateY(7px) rotate(45deg)' : '';
      bars[1].style.opacity = isOpen ? '0' : '';
      bars[2].style.transform = isOpen ? 'translateY(-7px) rotate(-45deg)' : '';
    });
    document.addEventListener('click', (e) => {
      if (!navbar.contains(e.target)) mobileNav.classList.remove('open');
    });
  }

  // Active link
  const links = navbar.querySelectorAll('.nav-links a, .mobile-nav a');
  links.forEach(link => {
    if (link.href === window.location.href) link.classList.add('active');
  });

  // Update wallet + auth state
  updateNavAuth();
  updateCartBadge();
}

function updateNavAuth() {
  const loginBtn = document.getElementById('nav-login');
  const userMenu = document.getElementById('nav-user');
  if (!loginBtn) return;
  if (YP.user) {
    loginBtn.style.display = 'none';
    if (userMenu) { userMenu.style.display = 'flex'; userMenu.querySelector('.username').textContent = YP.user.name; }
  }
}

function updateCartBadge() {
  const badge = document.querySelector('.cart-badge');
  if (badge) badge.textContent = YP.cart.length;
}

// ---- SCROLL REVEAL ----
function initReveal() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); } });
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
}

// ---- PARTICLES ----
function initParticles() {
  const container = document.querySelector('.hero-particles');
  if (!container) return;
  for (let i = 0; i < 18; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.cssText = `
      left: ${Math.random() * 100}%;
      top: ${50 + Math.random() * 50}%;
      animation-duration: ${4 + Math.random() * 6}s;
      animation-delay: ${Math.random() * 5}s;
      width: ${2 + Math.random() * 3}px;
      height: ${2 + Math.random() * 3}px;
      opacity: ${0.2 + Math.random() * 0.5};
    `;
    container.appendChild(p);
  }
}

// ---- TOAST NOTIFICATIONS ----
function showToast(message, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${message}</span>`;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

// ---- MODAL ----
function openModal(id) {
  const m = document.getElementById(id);
  if (m) { m.classList.add('active'); document.body.style.overflow = 'hidden'; }
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (m) { m.classList.remove('active'); document.body.style.overflow = ''; }
}
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) closeModal(e.target.id);
});

// ---- FILTER CHIPS ----
function initFilters() {
  document.querySelectorAll('[data-filter-group]').forEach(group => {
    const chips = group.querySelectorAll('.filter-chip');
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        chips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const filter = chip.dataset.filter;
        filterEvents(filter);
      });
    });
  });
}

function filterEvents(category) {
  const cards = document.querySelectorAll('.event-card[data-category]');
  cards.forEach(card => {
    const show = category === 'all' || card.dataset.category === category;
    card.style.opacity = show ? '1' : '0.3';
    card.style.transform = show ? '' : 'scale(0.95)';
  });
}

// ---- SEARCH ----
function initSearch() {
  const searchInput = document.querySelector('.hero-search input, #search-input');
  if (!searchInput) return;

  let debounce;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const q = e.target.value.toLowerCase().trim();
      if (q.length < 2) { filterEvents('all'); return; }
      document.querySelectorAll('.event-card[data-title]').forEach(card => {
        const match = card.dataset.title.toLowerCase().includes(q);
        card.style.opacity = match ? '1' : '0.3';
        card.style.transform = match ? '' : 'scale(0.95)';
      });
    }, 300);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = e.target.value.trim();
      if (q) window.location.href = `events.html?q=${encodeURIComponent(q)}`;
    }
  });
}

// ---- WISHLIST ----
function toggleWishlist(el, eventId) {
  YP.toggleWishlist(eventId);
  el.classList.toggle('liked');
  el.textContent = YP.isWished(eventId) ? '❤️' : '🤍';
}

// ---- SERENITE OPTION ----
function initSerenite() {
  const opt = document.querySelector('.serenite-option');
  if (!opt) return;
  opt.addEventListener('click', () => {
    YP.sereniteEnabled = !YP.sereniteEnabled;
    opt.classList.toggle('active', YP.sereniteEnabled);
    updateOrderSummary();
    showToast(
      YP.sereniteEnabled ? '🛡️ Option Sérénité activée !' : 'Option Sérénité désactivée',
      YP.sereniteEnabled ? 'success' : 'info'
    );
  });
}

function updateOrderSummary() {
  const sereniteEl = document.getElementById('serenite-total');
  const totalEl = document.getElementById('grand-total');
  if (!sereniteEl || !totalEl) return;
  const baseTotal = parseInt(totalEl.dataset.base || '0');
  const sereniteAmount = YP.sereniteEnabled ? 500 : 0;
  sereniteEl.textContent = YP.sereniteEnabled ? '+500 FCFA' : 'Gratuit';
  totalEl.textContent = (baseTotal + sereniteAmount).toLocaleString('fr-FR') + ' FCFA';
}

// ---- PAYMENT METHOD SELECTION ----
function initPaymentMethods() {
  document.querySelectorAll('.payment-method').forEach(method => {
    method.addEventListener('click', () => {
      document.querySelectorAll('.payment-method').forEach(m => m.classList.remove('active'));
      method.classList.add('active');
      showPaymentFields(method.dataset.method);
    });
  });
}

function showPaymentFields(method) {
  document.querySelectorAll('[data-payment-fields]').forEach(f => f.style.display = 'none');
  const fields = document.querySelector(`[data-payment-fields="${method}"]`);
  if (fields) fields.style.display = 'block';
}

// ---- QR CODE GENERATOR (simulated) ----
function generateQRCode(container, data) {
  // Simple QR visual placeholder — in prod, use a QR lib
  container.style.cssText = `
    display: grid;
    grid-template-columns: repeat(10, 1fr);
    gap: 2px;
    background: white;
    padding: 8px;
    border-radius: 10px;
  `;
  // Generate pseudo-QR pattern from data hash
  const seed = [...data].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  for (let i = 0; i < 100; i++) {
    const cell = document.createElement('div');
    const isDark = (seed * (i + 1) * 37) % 100 < 45
      || (i < 21 && (i % 10 === 0 || Math.floor(i/10) === 0 || Math.floor(i/10) === 2))
      || (i > 78 && (i % 10 === 0 || Math.floor(i/10) === 7 || Math.floor(i/10) === 9));
    cell.style.cssText = `background:${isDark ? '#0F0A1E' : 'white'}; border-radius:1px; aspect-ratio:1;`;
    container.appendChild(cell);
  }
}

// ---- COUNTDOWN TIMER ----
function initCountdown(el, targetDate) {
  if (!el) return;
  function update() {
    const diff = new Date(targetDate) - new Date();
    if (diff <= 0) { el.textContent = 'Événement commencé !'; return; }
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    el.innerHTML = `<span>${d}j</span> <span>${h}h</span> <span>${m}m</span>`;
  }
  update();
  setInterval(update, 60000);
}

// ---- COUNTER ANIMATION ----
function animateCounter(el, target, suffix = '') {
  let start = 0;
  const dur = 1800;
  const step = target / (dur / 16);
  const interval = setInterval(() => {
    start = Math.min(start + step, target);
    el.textContent = Math.floor(start).toLocaleString('fr-FR') + suffix;
    if (start >= target) clearInterval(interval);
  }, 16);
}

// ---- TABS ----
function initTabs() {
  document.querySelectorAll('[data-tabs]').forEach(tabGroup => {
    const tabs = tabGroup.querySelectorAll('[data-tab]');
    const panels = document.querySelectorAll('[data-panel]');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.dataset.tab;
        panels.forEach(p => {
          p.style.display = p.dataset.panel === target ? 'block' : 'none';
        });
      });
    });
  });
}

// ---- AUTH ----
function handleLogin(e) {
  e && e.preventDefault();
  const email = document.getElementById('login-email')?.value;
  const pwd = document.getElementById('login-pwd')?.value;
  if (!email || !pwd) { showToast('Remplissez tous les champs', 'error'); return; }
  // Simulate login
  YP.user = { name: email.split('@')[0], email };
  YP.saveUser();
  showToast('🎉 Connexion réussie !', 'success');
  setTimeout(() => window.location.href = 'index.html', 1200);
}

function handleRegister(e) {
  e && e.preventDefault();
  const name = document.getElementById('reg-name')?.value;
  const email = document.getElementById('reg-email')?.value;
  const pwd = document.getElementById('reg-pwd')?.value;
  if (!name || !email || !pwd) { showToast('Remplissez tous les champs', 'error'); return; }
  YP.user = { name, email };
  YP.saveUser();
  showToast('🎉 Compte créé avec succès !', 'success');
  setTimeout(() => window.location.href = 'index.html', 1200);
}

function handleLogout() {
  YP.user = null;
  localStorage.removeItem('yp_user');
  showToast('À bientôt !', 'info');
  setTimeout(() => window.location.reload(), 1000);
}

// ---- INIT ----
document.addEventListener('DOMContentLoaded', () => {
  initFilters();
  initSearch();
  initSerenite();
  initPaymentMethods();
  initTabs();

  // Counter animation on scroll
  const counterObserver = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        const el = e.target;
        animateCounter(el, parseInt(el.dataset.count), el.dataset.suffix || '');
        counterObserver.unobserve(el);
      }
    });
  });
  document.querySelectorAll('[data-count]').forEach(el => counterObserver.observe(el));

  // QR codes
  document.querySelectorAll('[data-qr]').forEach(el => {
    generateQRCode(el, el.dataset.qr);
  });

  // Countdowns
  document.querySelectorAll('[data-countdown]').forEach(el => {
    initCountdown(el, el.dataset.countdown);
  });
});
