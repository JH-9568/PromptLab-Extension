const STORAGE_USER_ID_KEY = 'promptlab_user_id';

function createId(prefix) {
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${id}`;
}

chrome.storage.local.get([STORAGE_USER_ID_KEY], (result) => {
  const existingUserId = result[STORAGE_USER_ID_KEY];
  const userId = existingUserId || createId('anon');

  if (!existingUserId) {
    chrome.storage.local.set({ [STORAGE_USER_ID_KEY]: userId });
  }

  document.querySelector('#user-id').textContent = userId;
});
