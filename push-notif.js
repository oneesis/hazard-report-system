// [PUSH-START] push-notif.js

const _PUSH_VAPID_PUBLIC_KEY = 'BD9x_6gtr7rpZqrNHKKpBVRe3vgbuhTNczPhfYl6g21ghRNkhChFYZj60N2_iAn3igXSUfk9UuCYuih5kV8PoIg';

async function initPushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const sw = await navigator.serviceWorker.ready;
    const existing = await sw.pushManager.getSubscription();
    _updatePushToggle(!!existing);
  } catch { /* ignore */ }
}

window.togglePushNotification = async function () {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    showToast('Browser ini tidak mendukung push notification.', 'error');
    return;
  }
  try {
    const sw = await navigator.serviceWorker.ready;
    const existing = await sw.pushManager.getSubscription();

    if (existing) {
      await existing.unsubscribe();
      await _pushApi('push_unsubscribe', { endpoint: existing.endpoint });
      showToast('Notifikasi push dinonaktifkan.');
      _updatePushToggle(false);
    } else {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        showToast('Izin notifikasi ditolak. Aktifkan di pengaturan browser.', 'error');
        return;
      }
      const sub = await sw.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _urlBase64ToUint8Array(_PUSH_VAPID_PUBLIC_KEY)
      });
      const res = await _pushApi('push_subscribe', {
        endpoint: sub.endpoint,
        p256dh: _bufToBase64(sub.getKey('p256dh')),
        auth:   _bufToBase64(sub.getKey('auth'))
      });
      if (res.status === 'success') {
        showToast('Notifikasi push diaktifkan!');
        _updatePushToggle(true);
      } else {
        showToast('Gagal simpan subscription: ' + (res.message || 'unknown'), 'error');
      }
    }
  } catch (err) {
    console.error('Push toggle error:', err);
    showToast('Error push: ' + (err.message || err), 'error');
  }
};

// Test push — panggil dari console: testPushNotification()
window.testPushNotification = async function () {
  try {
    const res = await _pushApi('push_test', {});
    showToast(res.message || 'Test push dikirim.', res.status === 'success' ? 'success' : 'error');
    console.log('[push test]', res);
  } catch (err) {
    showToast('Test push error: ' + (err.message || err), 'error');
  }
};

async function _pushApi(action, data) {
  const res = await fetch('/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, data })
  });
  return res.json().catch(() => ({ status: 'error', message: 'Response bukan JSON' }));
}

function _updatePushToggle(active) {
  document.querySelectorAll('.push-notif-btn').forEach(btn => {
    btn.title = active ? 'Nonaktifkan push notification' : 'Aktifkan push notification';
    btn.classList.toggle('push-notif-active', active);
    const icon = btn.querySelector('i');
    if (icon) icon.className = active ? 'fa-solid fa-bell' : 'fa-solid fa-bell-slash';
  });
}

// Lebih aman dari btoa(String.fromCharCode(...spread)) yang bisa stack overflow
function _bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str);
}

function _urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - base64.length % 4) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from([...atob(b64)].map(c => c.charCodeAt(0)));
}
// [PUSH-END]
