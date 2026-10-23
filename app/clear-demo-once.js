(() => {
  const marker = 'xingzhi-demo-cleared-2026-08-01';
  if (localStorage.getItem(marker)) return;
  localStorage.setItem('personal-research-workbench-v2', '[]');
  localStorage.setItem('personal-research-workbench-safe-v1', '[]');
  localStorage.setItem(marker, 'true');
  location.reload();
})();
