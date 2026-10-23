(() => {
  const clock = document.getElementById('live-clock');
  if (!clock) return;
  const update = () => {
    clock.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  };
  update();
  window.setInterval(update, 1000);
})();
