// [PUSH-START] push-notif.js — Hapus file ini dan script tag-nya untuk menonaktifkan push notifications

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
      await fetch('/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'push_unsubscribe', data: { endpoint: existing.endpoint } })
      }).catch(() => {});
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
      const p256dh = btoa(String.fromCharCode(...new Uint8Array(sub.getKey('p256dh'))));
      const auth   = btoa(String.fromCharCode(...new Uint8Array(sub.getKey('auth'))));
      await fetch('/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'push_subscribe', data: { endpoint: sub.endpoint, p256dh, auth } })
      }).catch(() => {});
      showToast('Notifikasi push diaktifkan!');
      _updatePushToggle(true);
    }
  } catch (err) {
    console.error('Push toggle error:', err);
    showToast('Gagal mengatur notifikasi: ' + (err.message || err), 'error');
  }
};

function _updatePushToggle(active) {
  document.querySelectorAll('.push-notif-btn').forEach(btn => {
    btn.title = active ? 'Nonaktifkan push notification' : 'Aktifkan push notification';
    btn.classList.toggle('push-notif-active', active);
    const icon = btn.querySelector('i');
    if (icon) icon.className = active ? 'fa-solid fa-bell' : 'fa-solid fa-bell-slash';
  });
}

function _urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - base64.length % 4) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from([...atob(b64)].map(c => c.charCodeAt(0)));
}
// [PUSH-END]
