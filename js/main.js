// Enable fade-in animations (only when JS is available)
document.documentElement.classList.add('js');

// Dynamic year in footer
document.getElementById('year').textContent = new Date().getFullYear();

// Initialize GLightbox if loaded
if (typeof GLightbox !== 'undefined') {
  GLightbox({ selector: '.glightbox' });
}

// Fade-in on scroll
const observer = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); } });
}, { threshold: 0.1 });
document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));

// Mobile menu toggle
const toggle = document.querySelector('.nav-toggle');
const links = document.querySelector('.nav-links');
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
