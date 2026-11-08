// Enable JS-dependent styles
document.documentElement.classList.add('js');

// Dynamic year in footer
const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

// Initialize GLightbox if loaded
if (typeof GLightbox !== 'undefined') {
  GLightbox({ selector: '.glightbox' });
}

// Fade-in on scroll
const observer = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('visible');
      observer.unobserve(e.target);
    }
  });
}, { threshold: 0.1 });

document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));

// Hero card entrance animation
const heroCards = document.querySelectorAll('.hero-card');
if (heroCards.length) {
  // Small delay to let the page paint first
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      heroCards.forEach(card => card.classList.add('visible'));
    });
  });
}

// Mobile menu toggle
const toggle = document.querySelector('.nav-toggle');
const links = document.querySelector('.nav-links');

if (toggle && links) {
  const setOpen = (open) => {
    toggle.classList.toggle('open', open);
    links.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
  };

  toggle.addEventListener('click', () => {
    setOpen(!toggle.classList.contains('open'));
  });

  links.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => setOpen(false));
  });
}

// Hide sticky bar when scrolled to footer
const stickyBar = document.querySelector('.sticky-contact');
const footer = document.querySelector('footer');

if (stickyBar && footer) {
  const footerObserver = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      stickyBar.classList.toggle('sticky-contact--hidden', e.isIntersecting);
    });
  }, { threshold: 0.1 });

  footerObserver.observe(footer);
}
