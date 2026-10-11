// Cron harian (07.30 WITA): notifikasi PWA kuis pengganti Safety Talk yang
// tertunda — kuis yang baru terbit di quiz-she setelah absensi disimpan, atau
// peserta yang baru kembali onsite dari cuti. Logika ada di api/index.js
// (kirimNotifKuisST); sekali per orang per sesi.
const api = require('./index.js');

module.exports = async (req, res) => {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`)
    return res.status(401).json({ error: 'Unauthorized' });
  try {
    res.json(await api.cronKuisST());
  } catch (e) {
    console.error('[cron-kuis-st]', e.message);
    res.status(500).json({ status: 'error', message: e.message });
  }
};
