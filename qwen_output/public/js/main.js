// Main page JavaScript
document.addEventListener('DOMContentLoaded', () => {
  console.log('Jal Jeevan KBC Quiz - Home Page Loaded');
  
  // Add ripple effect to buttons
  const buttons = document.querySelectorAll('.btn');
  buttons.forEach(btn => {
    btn.addEventListener('mouseenter', createRipple);
  });

  function createRipple(e) {
    const btn = e.currentTarget;
    const existingRipple = btn.querySelector('.ripple');
    if (existingRipple) existingRipple.remove();

    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.cssText = `
      position: absolute;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.3);
      width: 100px;
      height: 100px;
      left: ${e.offsetX - 50}px;
      top: ${e.offsetY - 50}px;
      animation: ripple-effect 0.6s ease-out;
      pointer-events: none;
    `;

    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  }

  // Add ripple animation CSS
  const style = document.createElement('style');
  style.textContent = `
    @keyframes ripple-effect {
      to {
        transform: scale(4);
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);
});
