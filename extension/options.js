document.addEventListener('DOMContentLoaded', () => {
  const textarea = document.getElementById('config');
  const status = document.getElementById('status');
  chrome.storage.local.get('pagesConfig', (res) => {
    textarea.value = JSON.stringify(res.pagesConfig || {pages:[]}, null, 2);
  });

  document.getElementById('save').addEventListener('click', () => {
    try {
      const cfg = JSON.parse(textarea.value);
      chrome.storage.local.set({pagesConfig: cfg}, () => {
        status.textContent = 'Saved';
        setTimeout(() => status.textContent = '', 1000);
      });
    } catch (e) {
      status.textContent = 'Invalid JSON';
    }
  });
});
