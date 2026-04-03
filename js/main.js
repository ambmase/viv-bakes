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
  toggle.addEventListener('click', () => {
    toggle.classList.toggle('open');
    links.classList.toggle('open');
  });

  links.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      toggle.classList.remove('open');
      links.classList.remove('open');
    });
  });
}

// Hide sticky contact bar on contact page
if (window.location.pathname.includes('contact')) {
  const stickyBar = document.querySelector('.sticky-contact');
  if (stickyBar) stickyBar.style.display = 'none';
}

// Hide sticky bar when scrolled to footer
const stickyBar = document.querySelector('.sticky-contact');
const footer = document.querySelector('footer');

if (stickyBar && footer) {
  const footerObserver = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      stickyBar.style.opacity = e.isIntersecting ? '0' : '1';
      stickyBar.style.pointerEvents = e.isIntersecting ? 'none' : 'auto';
    });
  }, { threshold: 0.1 });

  footerObserver.observe(footer);
  stickyBar.style.transition = 'opacity 0.3s ease';
}
