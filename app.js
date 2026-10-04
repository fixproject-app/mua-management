// =====================================================================
// app.js — Bridal MUA Manager
// =====================================================================

// ── Konfigurasi Supabase ──
const SUPABASE_URL = 'https://xxxxx.supabase.co';
const SUPABASE_ANON_KEY = 'xxxxxxxxxxxxxxxxxxxx'; // anon/public key, AMAN dipakai di frontend

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentProfile = null;
let appConfig = {};
let cache = { clients: [], bookings: [], packages: [], teamMembers: [], addOns: [] };
let calendarCursor = new Date();
let activeBookingId = null;
let wizardState = { step: 1, clientId: null, packageId: null };

// ── Helper: Loading Overlay ──
function showLoading() { document.getElementById('loading-overlay').classList.remove('d-none'); }
function hideLoading() { document.getElementById('loading-overlay').classList.add('d-none'); }

// ── Helper: Toast Notifikasi ──
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast-item toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// ── Helper: Wrapper Supabase Call ──
async function callSupabase(promise, successMessage) {
  showLoading();
  try {
    const { data, error } = await promise;
    if (error) throw error;
    if (successMessage) showToast(successMessage, 'success');
    return { success: true, data };
  } catch (error) {
    showToast(error.message || 'Terjadi kesalahan.', 'error');
    return { success: false, data: null, message: error.message };
  } finally {
    hideLoading();
  }
}

// ── Helper: format ──
function formatRupiah(n) {
  n = Number(n) || 0;
  return 'Rp ' + n.toLocaleString('id-ID');
}
function formatTanggal(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── CRUD Helpers generik ──
async function getAllData(table, orderBy = 'created_at', ascending = false) {
  return callSupabase(supabase.from(table).select('*').order(orderBy, { ascending }));
}
async function addRecord(table, record, successMessage = 'Data berhasil ditambahkan.') {
  return callSupabase(supabase.from(table).insert(record).select().single(), successMessage);
}
async function updateRecord(table, id, updates, successMessage = 'Data berhasil diperbarui.') {
  return callSupabase(supabase.from(table).update(updates).eq('id', id).select().single(), successMessage);
}
async function deleteRecord(table, id, successMessage = 'Data berhasil dihapus.') {
  return callSupabase(supabase.from(table).delete().eq('id', id), successMessage);
}

// ── Konfirmasi dialog generik ──
function confirmAction(message, onConfirm) {
  document.getElementById('confirm-message').textContent = message;
  const modalEl = document.getElementById('modal-confirm');
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  const btn = document.getElementById('confirm-ok-btn');
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.addEventListener('click', async () => { modal.hide(); await onConfirm(); });
  modal.show();
}

// =====================================================================
// AUTH
// =====================================================================
function toggleAuthMode() {
  document.getElementById('login-form').classList.toggle('d-none');
  document.getElementById('signup-form').classList.toggle('d-none');
}

async function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!email || !password) return showToast('Email dan password wajib diisi.', 'error');
  await callSupabase(supabase.auth.signInWithPassword({ email, password }));
}

async function handleSignup() {
  const nama = document.getElementById('signup-nama').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  if (!nama || !email || password.length < 6) return showToast('Lengkapi form dengan benar (password min. 6 karakter).', 'error');
  const result = await callSupabase(
    supabase.auth.signUp({ email, password, options: { data: { nama_lengkap: nama } } }),
    'Pendaftaran berhasil!'
  );
  if (result.success) toggleAuthMode();
}

async function signOut() {
  await supabase.auth.signOut();
}

supabase.auth.onAuthStateChange((event, session) => {
  if (session) {
    document.getElementById('section-login').classList.add('d-none');
    document.getElementById('app-shell').classList.remove('d-none');
    loadCurrentProfile(session.user.id).then(() => bootstrapApp());
  } else {
    document.getElementById('app-shell').classList.add('d-none');
    document.getElementById('section-login').classList.remove('d-none');
  }
});

async function loadCurrentProfile(userId) {
  const result = await callSupabase(supabase.from('profiles').select('*').eq('id', userId).single());
  if (result.success) currentProfile = result.data;
  return result;
}

// =====================================================================
// BOOTSTRAP — dipanggil setelah login sukses
// =====================================================================
async function bootstrapApp() {
  await loadAppConfig();
  await Promise.all([loadClients(), loadPackages(), loadTeamMembers(), loadAddOns()]);
  setupRealtime();
  navigateTo('dashboard');
}

async function loadAppConfig() {
  const result = await getAllData('app_config', 'key', true);
  if (result.success) {
    appConfig = {};
    result.data.forEach(row => appConfig[row.key] = row.value);
    document.querySelectorAll('[id^="cfg-"]').forEach(el => {
      const key = el.id.replace('cfg-', '');
      if (appConfig[key] !== undefined) el.value = appConfig[key];
    });
    if (appConfig.app_name) document.title = appConfig.app_name;
  }
}

async function saveAppConfig() {
  const keys = ['app_name', 'business_name', 'business_whatsapp', 'business_address',
    'wa_template_reminder_h7', 'wa_template_reminder_h3', 'wa_template_reminder_h1', 'wa_template_konfirmasi_dp'];
  const rows = keys.map(key => ({ key, value: document.getElementById('cfg-' + key)?.value || '' }));
  const result = await callSupabase(supabase.from('app_config').upsert(rows), 'Pengaturan berhasil disimpan.');
  if (result.success) loadAppConfig();
}

// =====================================================================
// SPA ROUTING
// =====================================================================
function navigateTo(sectionId) {
  document.querySelectorAll('.app-section').forEach(el => el.classList.add('d-none'));
  document.getElementById(`section-${sectionId}`)?.classList.remove('d-none');
  document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
  document.querySelectorAll(`.nav-link[data-section="${sectionId}"]`).forEach(el => el.classList.add('active'));

  const loaders = {
    dashboard: loadDashboardData,
    clients: renderClientTable,
    bookings: renderBookingTable,
    paket: renderPaketGrid,
    kalender: renderCalendar,
    checklist: loadChecklistSection,
    keuangan: loadFinanceSection,
    galeri: loadGaleriGlobal,
    team: renderTeamGrid,
    laporan: loadLaporan,
    pengaturan: loadAppConfig
  };
  if (loaders[sectionId]) loaders[sectionId]();
}

// =====================================================================
// DARK MODE
// =====================================================================
function toggleDarkMode() {
  const isDark = document.body.getAttribute('data-theme') === 'dark';
  const theme = isDark ? 'light' : 'dark';
  document.body.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  const icon = document.getElementById('theme-icon');
  if (icon) icon.className = theme === 'dark' ? 'bi bi-sun' : 'bi bi-moon-stars';
}
(function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  document.addEventListener('DOMContentLoaded', () => {
    document.body.setAttribute('data-theme', saved);
    const icon = document.getElementById('theme-icon');
    if (icon) icon.className = saved === 'dark' ? 'bi bi-sun' : 'bi bi-moon-stars';
  });
})();

// =====================================================================
// REALTIME — Dashboard (bookings & payments)
// =====================================================================
function subscribeRealtime(table, onChange) {
  return supabase.channel(`realtime:${table}`)
    .on('postgres_changes', { event: '*', schema: 'public', table }, onChange)
    .subscribe();
}
function setupRealtime() {
  subscribeRealtime('bookings', () => {
    loadClients();
    if (!document.getElementById('section-dashboard').classList.contains('d-none')) loadDashboardData();
    if (!document.getElementById('section-bookings').classList.contains('d-none')) renderBookingTable();
  });
  subscribeRealtime('payments', () => {
    if (!document.getElementById('section-dashboard').classList.contains('d-none')) loadDashboardData();
    if (!document.getElementById('section-keuangan').classList.contains('d-none')) loadFinanceSection();
  });
}

// =====================================================================
// MASTER DATA LOADERS (cache lokal untuk dropdown dsb.)
// =====================================================================
async function loadClients() {
  const r = await getAllData('clients');
  if (r.success) cache.clients = r.data;
  return r;
}
async function loadPackages() {
  const r = await getAllData('packages');
  if (r.success) cache.packages = r.data;
  return r;
}
async function loadTeamMembers() {
  const r = await getAllData('team_members');
  if (r.success) cache.teamMembers = r.data;
  return r;
}
async function loadAddOns() {
  const r = await getAllData('add_ons');
  if (r.success) cache.addOns = r.data;
  return r;
}
function findClient(id) { return cache.clients.find(c => c.id === id); }
function findPackage(id) { return cache.packages.find(p => p.id === id); }
function findTeamMember(id) { return cache.teamMembers.find(t => t.id === id); }

// =====================================================================
// DASHBOARD
// =====================================================================
let chartOmzet = null;

async function loadDashboardData() {
  const [bookingsRes, paymentsRes] = await Promise.all([
    getAllData('bookings'),
    getAllData('payments')
  ]);
  if (!bookingsRes.success || !paymentsRes.success) return;
  const bookings = bookingsRes.data;
  const payments = paymentsRes.data;

  const now = new Date();
  const bulanIni = payments.filter(p => {
    const d = new Date(p.tanggal_bayar);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const omzetBulanIni = bulanIni.reduce((s, p) => s + Number(p.jumlah), 0);
  const bookingAktif = bookings.filter(b => !['selesai', 'batal'].includes(b.status)).length;
  const piutang = bookings.reduce((s, b) => s + Number(b.sisa_pembayaran || 0), 0);
  const todayStr = now.toISOString().slice(0, 10);
  const bookingHariIni = bookings.filter(b => b.tanggal_acara === todayStr).length;

  document.getElementById('kpi-omzet').textContent = formatRupiah(omzetBulanIni);
  document.getElementById('kpi-booking-aktif').textContent = bookingAktif;
  document.getElementById('kpi-piutang').textContent = formatRupiah(piutang);
  document.getElementById('kpi-hari-ini').textContent = bookingHariIni;

  // Chart: omzet per bulan (12 bulan terakhir)
  const bulanLabels = [];
  const omzetPerBulan = [];
  const bookingPerBulan = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    bulanLabels.push(d.toLocaleDateString('id-ID', { month: 'short', year: '2-digit' }));
    const total = payments.filter(p => {
      const pd = new Date(p.tanggal_bayar);
      return pd.getMonth() === d.getMonth() && pd.getFullYear() === d.getFullYear();
    }).reduce((s, p) => s + Number(p.jumlah), 0);
    omzetPerBulan.push(total);
    const cnt = bookings.filter(b => {
      const bd = new Date(b.tanggal_acara);
      return bd.getMonth() === d.getMonth() && bd.getFullYear() === d.getFullYear();
    }).length;
    bookingPerBulan.push(cnt);
  }
  renderChartOmzet(bulanLabels, omzetPerBulan, bookingPerBulan);

  // Insight sederhana
  const topBulanIdx = omzetPerBulan.indexOf(Math.max(...omzetPerBulan));
  const insight = omzetBulanIni > 0
    ? `Omzet bulan ini ${formatRupiah(omzetBulanIni)}. Bulan dengan omzet tertinggi dalam setahun terakhir: ${bulanLabels[topBulanIdx]} (${formatRupiah(omzetPerBulan[topBulanIdx])}). Ada ${piutang > 0 ? formatRupiah(piutang) + ' piutang yang masih berjalan.' : 'tidak ada piutang tertunda saat ini.'}`
    : `Belum ada pemasukan tercatat bulan ini. Ada ${bookingAktif} booking aktif yang sedang berjalan.`;
  document.getElementById('ai-insight').textContent = insight;

  // Jadwal terdekat
  const mendatang = bookings
    .filter(b => new Date(b.tanggal_acara) >= new Date(todayStr) && b.status !== 'batal')
    .sort((a, b) => new Date(a.tanggal_acara) - new Date(b.tanggal_acara))
    .slice(0, 5);
  const listEl = document.getElementById('dashboard-jadwal-list');
  if (mendatang.length === 0) {
    listEl.innerHTML = `<div class="empty-state"><i class="bi bi-calendar-x"></i>Tidak ada jadwal mendatang.</div>`;
  } else {
    listEl.innerHTML = mendatang.map(b => {
      const client = findClient(b.client_id);
      return `<div class="d-flex justify-content-between align-items-center py-2" style="border-bottom:1px solid var(--border-color);">
        <div>
          <div class="fw-semibold">${client ? client.nama_lengkap : '-'}</div>
          <div class="text-secondary" style="font-size:12px;">${formatTanggal(b.tanggal_acara)} · ${b.booking_number}</div>
        </div>
        <button class="btn btn-outline-mua btn-sm" onclick="openBookingDetail('${b.id}')">Lihat</button>
      </div>`;
    }).join('');
  }
}

function renderChartOmzet(labels, omzetData, bookingData) {
  const ctx = document.getElementById('chart-omzet');
  if (!ctx) return;
  if (chartOmzet) chartOmzet.destroy();
  chartOmzet = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        { type: 'bar', label: 'Omzet', data: omzetData, backgroundColor: '#B76E79', borderRadius: 6, yAxisID: 'y' },
        { type: 'line', label: 'Jumlah Booking', data: bookingData, borderColor: '#CBA477', backgroundColor: '#CBA477', tension: 0.3, yAxisID: 'y1' }
      ]
    },
    options: {
      responsive: true,
      scales: {
        y: { beginAtZero: true, position: 'left' },
        y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false } }
      }
    }
  });
}

// =====================================================================
// CLIENTS
// =====================================================================
function renderClientTable() {
  const search = (document.getElementById('client-search')?.value || '').toLowerCase();
  const filtered = cache.clients.filter(c =>
    c.nama_lengkap.toLowerCase().includes(search) || (c.no_whatsapp || '').includes(search)
  );
  const tbody = document.getElementById('clients-tbody');
  if (!tbody) return;
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i class="bi bi-people"></i>Belum ada data client.</div></td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map(c => `
    <tr>
      <td class="text-tabular">${c.client_number}</td>
      <td>${c.nama_lengkap}</td>
      <td>${c.no_whatsapp}</td>
      <td><span class="chip ${c.status === 'aktif' ? 'chip-success' : c.status === 'batal' ? 'chip-danger' : 'chip-info'}">${c.status}</span></td>
      <td>${formatTanggal(c.created_at)}</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="openClientModal(false,'${c.id}')"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-ghost btn-sm" onclick="deleteClient('${c.id}')"><i class="bi bi-trash text-danger"></i></button>
      </td>
    </tr>`).join('');
}

function openClientModal(fromWizard = false, id = null) {
  document.getElementById('client-id').value = id || '';
  ['nama_lengkap', 'nama_panggilan', 'no_whatsapp', 'nama_pasangan', 'email', 'instagram', 'catatan'].forEach(f => document.getElementById('client-' + f).value = '');
  document.getElementById('client-sumber_info').value = 'Instagram';
  document.getElementById('modal-client-title').textContent = id ? 'Edit Client' : 'Client Baru';
  if (id) {
    const c = findClient(id);
    if (c) Object.keys(c).forEach(k => { const el = document.getElementById('client-' + k); if (el) el.value = c[k] || ''; });
  }
  document.getElementById('modal-client').dataset.fromWizard = fromWizard ? '1' : '0';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-client')).show();
}

async function saveClient() {
  const id = document.getElementById('client-id').value;
  const nama = document.getElementById('client-nama_lengkap').value.trim();
  const wa = document.getElementById('client-no_whatsapp').value.trim();
  if (!nama || !wa) return showToast('Nama dan No. WhatsApp wajib diisi.', 'error');
  if (!/^[0-9+][0-9]{7,15}$/.test(wa)) return showToast('Format No. WhatsApp tidak valid.', 'error');

  const payload = {
    nama_lengkap: nama,
    nama_panggilan: document.getElementById('client-nama_panggilan').value.trim(),
    no_whatsapp: wa,
    nama_pasangan: document.getElementById('client-nama_pasangan').value.trim(),
    email: document.getElementById('client-email').value.trim(),
    instagram: document.getElementById('client-instagram').value.trim(),
    sumber_info: document.getElementById('client-sumber_info').value,
    catatan: document.getElementById('client-catatan').value.trim()
  };

  const result = id ? await updateRecord('clients', id, payload) : await addRecord('clients', payload);
  if (result.success) {
    await loadClients();
    renderClientTable();
    bootstrap.Modal.getInstance(document.getElementById('modal-client')).hide();
    const fromWizard = document.getElementById('modal-client').dataset.fromWizard === '1';
    if (fromWizard) {
      populateWizardClientSelect();
      document.getElementById('wiz-client-id').value = result.data.id;
    }
  }
}

function deleteClient(id) {
  confirmAction('Hapus client ini? Data booking terkait juga akan terhapus.', async () => {
    const r = await deleteRecord('clients', id);
    if (r.success) { await loadClients(); renderClientTable(); }
  });
}

// =====================================================================
// PACKAGES
// =====================================================================
function renderPaketGrid() {
  const grid = document.getElementById('paket-grid');
  if (cache.packages.length === 0) {
    grid.innerHTML = `<div class="col-12"><div class="empty-state"><i class="bi bi-box-seam"></i>Belum ada paket.</div></div>`;
    return;
  }
  grid.innerHTML = cache.packages.map(p => `
    <div class="col-12 col-md-4">
      <div class="card-mua h-100">
        <div class="d-flex justify-content-between align-items-start mb-2">
          <h3 style="font-size:17px;">${p.nama_paket}</h3>
          <span class="chip ${p.is_active ? 'chip-success' : 'chip-danger'}">${p.is_active ? 'Aktif' : 'Nonaktif'}</span>
        </div>
        <div class="kpi-value text-tabular mb-1" style="font-size:20px;">${formatRupiah(p.harga)}</div>
        <div class="text-secondary mb-2" style="font-size:13px;">${p.durasi_jam ? p.durasi_jam + ' jam' : ''}</div>
        <p class="text-secondary" style="font-size:13px;">${p.deskripsi || ''}</p>
        <button class="btn btn-outline-mua btn-sm" onclick="openPackageModal('${p.id}')"><i class="bi bi-pencil"></i> Edit</button>
      </div>
    </div>`).join('');
}

function openPackageModal(id = null) {
  document.getElementById('paket-id').value = id || '';
  ['nama_paket', 'harga', 'durasi_jam', 'deskripsi'].forEach(f => document.getElementById('paket-' + f).value = '');
  if (id) {
    const p = findPackage(id);
    if (p) Object.keys(p).forEach(k => { const el = document.getElementById('paket-' + k); if (el) el.value = p[k] || ''; });
  }
  bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-paket')).show();
}

async function savePackage() {
  const id = document.getElementById('paket-id').value;
  const nama = document.getElementById('paket-nama_paket').value.trim();
  const harga = Number(document.getElementById('paket-harga').value);
  if (!nama || harga < 0) return showToast('Nama paket dan harga (tidak boleh negatif) wajib diisi.', 'error');
  const payload = {
    nama_paket: nama,
    harga,
    durasi_jam: Number(document.getElementById('paket-durasi_jam').value) || null,
    deskripsi: document.getElementById('paket-deskripsi').value.trim()
  };
  const result = id ? await updateRecord('packages', id, payload) : await addRecord('packages', payload);
  if (result.success) {
    await loadPackages();
    renderPaketGrid();
    bootstrap.Modal.getInstance(document.getElementById('modal-paket')).hide();
  }
}

// =====================================================================
// BOOKINGS — Tabel
// =====================================================================
function renderBookingTable() {
  const tbody = document.getElementById('bookings-tbody');
  getAllData('bookings').then(r => {
    if (!r.success) return;
    cache.bookings = r.data;
    if (cache.bookings.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><i class="bi bi-calendar-x"></i>Belum ada booking.</div></td></tr>`;
      return;
    }
    const statusChip = { booking_baru: 'chip-info', dp_diterima: 'chip-warning', siap_hari_h: 'chip-warning', selesai: 'chip-success', batal: 'chip-danger' };
    const bayarChip = { belum_bayar: 'chip-danger', dp: 'chip-warning', lunas: 'chip-success' };
    tbody.innerHTML = cache.bookings.map(b => {
      const client = findClient(b.client_id);
      const pkg = findPackage(b.package_id);
      return `<tr style="cursor:pointer;" onclick="openBookingDetail('${b.id}')">
        <td class="text-tabular">${b.booking_number}</td>
        <td>${client ? client.nama_lengkap : '-'}</td>
        <td>${formatTanggal(b.tanggal_acara)}</td>
        <td>${pkg ? pkg.nama_paket : '-'}</td>
        <td><span class="chip ${statusChip[b.status] || 'chip-info'}">${b.status.replace(/_/g, ' ')}</span></td>
        <td><span class="chip ${bayarChip[b.status_pembayaran] || 'chip-info'}">${b.status_pembayaran.replace(/_/g, ' ')}</span></td>
        <td onclick="event.stopPropagation()"><button class="btn btn-ghost btn-sm" onclick="openBookingDetail('${b.id}')"><i class="bi bi-eye"></i></button></td>
      </tr>`;
    }).join('');
  });
}

// =====================================================================
// BOOKING WIZARD (5 langkah)
// =====================================================================
function openBookingWizard() {
  wizardState = { step: 1, clientId: null, packageId: null };
  populateWizardClientSelect();
  populateWizardPackageSelect();
  populateWizardTeamSelect();
  document.getElementById('wiz-tanggal_acara').value = '';
  document.getElementById('wiz-jam_mulai').value = '';
  document.getElementById('wiz-jam_selesai').value = '';
  document.getElementById('wiz-lokasi_nama').value = '';
  document.getElementById('wiz-lokasi_maps_url').value = '';
  document.getElementById('wiz-catatan').value = '';
  document.getElementById('wiz-bentrok-warning').classList.add('d-none');
  showWizardStep(1);
  bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-booking-wizard')).show();
}

function populateWizardClientSelect() {
  const sel = document.getElementById('wiz-client-id');
  sel.innerHTML = '<option value="">-- Pilih Client --</option>' +
    cache.clients.map(c => `<option value="${c.id}">${c.nama_lengkap} (${c.no_whatsapp})</option>`).join('');
}
function populateWizardPackageSelect() {
  const sel = document.getElementById('wiz-package-id');
  sel.innerHTML = '<option value="">-- Pilih Paket --</option>' +
    cache.packages.filter(p => p.is_active).map(p => `<option value="${p.id}">${p.nama_paket} — ${formatRupiah(p.harga)}</option>`).join('');
}
function populateWizardTeamSelect() {
  const sel = document.getElementById('wiz-team_member_id');
  sel.innerHTML = '<option value="">-- Pilih Team MUA --</option>' +
    cache.teamMembers.filter(t => t.is_active).map(t => `<option value="${t.id}">${t.nama_lengkap} (${t.peran})</option>`).join('');
}
function updateWizardHarga() {
  const pkg = findPackage(document.getElementById('wiz-package-id').value);
  document.getElementById('wiz-harga_paket').value = pkg ? pkg.harga : '';
}

function showWizardStep(n) {
  wizardState.step = n;
  document.querySelectorAll('.wizard-step').forEach(el => el.classList.add('d-none'));
  document.getElementById(`wizard-step-${n}`).classList.remove('d-none');
  document.getElementById('wiz-btn-back').style.visibility = n === 1 ? 'hidden' : 'visible';
  document.getElementById('wiz-btn-next').textContent = n === 5 ? 'Simpan Booking' : 'Lanjut';
  document.getElementById('wizard-steps-indicator').innerHTML =
    ['Client', 'Paket & Jadwal', 'Lokasi & Team', 'Konfirmasi Harga', 'Ringkasan']
      .map((label, i) => `<span class="${i + 1 === n ? 'fw-bold' : 'text-secondary'}">${i + 1}. ${label}</span>`).join('');
  if (n === 5) renderWizardSummary();
}

function wizardBack() { if (wizardState.step > 1) showWizardStep(wizardState.step - 1); }

async function wizardNext() {
  const s = wizardState.step;
  if (s === 1) {
    if (!document.getElementById('wiz-client-id').value) return showToast('Pilih client terlebih dahulu.', 'error');
  }
  if (s === 2) {
    if (!document.getElementById('wiz-package-id').value) return showToast('Pilih paket terlebih dahulu.', 'error');
    if (!document.getElementById('wiz-tanggal_acara').value) return showToast('Tanggal acara wajib diisi.', 'error');
  }
  if (s === 3) {
    const teamId = document.getElementById('wiz-team_member_id').value;
    const tgl = document.getElementById('wiz-tanggal_acara').value;
    const jamMulai = document.getElementById('wiz-jam_mulai').value || '00:00';
    const jamSelesai = document.getElementById('wiz-jam_selesai').value || '23:59';
    if (teamId) {
      const r = await callSupabase(supabase.rpc('cek_jadwal_bentrok', {
        p_team_member_id: teamId, p_tanggal: tgl, p_jam_mulai: jamMulai, p_jam_selesai: jamSelesai, p_booking_id: null
      }));
      const warnEl = document.getElementById('wiz-bentrok-warning');
      if (r.success && r.data && r.data.length > 0) {
        warnEl.textContent = `⚠️ Jadwal bentrok dengan booking ${r.data[0].booking_number} (${r.data[0].client_nama}).`;
        warnEl.classList.remove('d-none');
      } else {
        warnEl.classList.add('d-none');
      }
    }
  }
  if (s === 5) { await submitBookingWizard(); return; }
  showWizardStep(s + 1);
}

function renderWizardSummary() {
  const client = findClient(document.getElementById('wiz-client-id').value);
  const pkg = findPackage(document.getElementById('wiz-package-id').value);
  const team = findTeamMember(document.getElementById('wiz-team_member_id').value);
  document.getElementById('wiz-summary').innerHTML = `
    <p><strong>Client:</strong> ${client ? client.nama_lengkap : '-'}</p>
    <p><strong>Paket:</strong> ${pkg ? pkg.nama_paket + ' — ' + formatRupiah(pkg.harga) : '-'}</p>
    <p><strong>Tanggal:</strong> ${formatTanggal(document.getElementById('wiz-tanggal_acara').value)} (${document.getElementById('wiz-jam_mulai').value || '-'} - ${document.getElementById('wiz-jam_selesai').value || '-'})</p>
    <p><strong>Lokasi:</strong> ${document.getElementById('wiz-lokasi_nama').value || '-'}</p>
    <p><strong>Team MUA:</strong> ${team ? team.nama_lengkap : '-'}</p>`;
}

async function submitBookingWizard() {
  const payload = {
    client_id: document.getElementById('wiz-client-id').value,
    package_id: document.getElementById('wiz-package-id').value,
    tanggal_acara: document.getElementById('wiz-tanggal_acara').value,
    jam_mulai: document.getElementById('wiz-jam_mulai').value || null,
    jam_selesai: document.getElementById('wiz-jam_selesai').value || null,
    lokasi_nama: document.getElementById('wiz-lokasi_nama').value.trim(),
    lokasi_maps_url: document.getElementById('wiz-lokasi_maps_url').value.trim(),
    team_member_id: document.getElementById('wiz-team_member_id').value || null,
    catatan: document.getElementById('wiz-catatan').value.trim()
  };
  const result = await addRecord('bookings', payload, 'Booking berhasil dibuat.');
  if (result.success) {
    await callSupabase(supabase.rpc('generate_booking_checklist', { p_booking_id: result.data.id }));
    bootstrap.Modal.getInstance(document.getElementById('modal-booking-wizard')).hide();
    renderBookingTable();
    openBookingDetail(result.data.id);
  }
}

// =====================================================================
// BOOKING DETAIL — pusat informasi (tabs)
// =====================================================================
async function openBookingDetail(id) {
  activeBookingId = id;
  navigateTo('booking-detail');
  await refreshBookingDetailHeader();
  switchBdTab('info');
}

async function refreshBookingDetailHeader() {
  const r = await callSupabase(supabase.from('bookings').select('*').eq('id', activeBookingId).single());
  if (!r.success) return;
  cache.activeBooking = r.data;
  document.getElementById('bd-booking-number').textContent = r.data.booking_number;
}

function switchBdTab(tab) {
  document.querySelectorAll('.bd-tab').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  document.querySelectorAll('.bd-panel').forEach(el => el.classList.add('d-none'));
  document.getElementById(`bd-panel-${tab}`).classList.remove('d-none');
  const loaders = {
    info: renderBdInfo, dirias: renderBdDirias, gaun: renderBdGaun,
    pembayaran: renderBdPembayaran, checklist: renderBdChecklist,
    packing: renderBdPacking, galeri: renderBdGaleri
  };
  loaders[tab]();
}

function renderBdInfo() {
  const b = cache.activeBooking;
  const client = findClient(b.client_id);
  const pkg = findPackage(b.package_id);
  const team = findTeamMember(b.team_member_id);
  const statusOptions = ['booking_baru', 'dp_diterima', 'siap_hari_h', 'selesai', 'batal'];
  document.getElementById('bd-panel-info').innerHTML = `
    <div class="row g-3">
      <div class="col-12 col-md-6">
        <div class="card-mua">
          <h3 style="font-size:15px;" class="mb-2">Data Client</h3>
          <p class="mb-1"><strong>${client ? client.nama_lengkap : '-'}</strong></p>
          <p class="text-secondary mb-1" style="font-size:13px;"><i class="bi bi-whatsapp"></i> ${client ? client.no_whatsapp : '-'}</p>
          <p class="text-secondary mb-0" style="font-size:13px;">Pasangan: ${client?.nama_pasangan || '-'}</p>
        </div>
      </div>
      <div class="col-12 col-md-6">
        <div class="card-mua">
          <h3 style="font-size:15px;" class="mb-2">Info Acara</h3>
          <p class="mb-1">Tanggal: <strong>${formatTanggal(b.tanggal_acara)}</strong> (${b.jam_mulai || '-'} - ${b.jam_selesai || '-'})</p>
          <p class="mb-1">Paket: ${pkg ? pkg.nama_paket : '-'} (${formatRupiah(b.harga_paket)})</p>
          <p class="mb-1">Lokasi: ${b.lokasi_nama || '-'}</p>
          <p class="mb-0">Team MUA: ${team ? team.nama_lengkap : '-'}</p>
        </div>
      </div>
      <div class="col-12">
        <div class="card-mua">
          <h3 style="font-size:15px;" class="mb-2">Status Booking</h3>
          <select class="form-select mb-2" style="max-width:260px;" id="bd-status-select" onchange="updateBookingStatus(this.value)">
            ${statusOptions.map(s => `<option value="${s}" ${s === b.status ? 'selected' : ''}>${s.replace(/_/g, ' ')}</option>`).join('')}
          </select>
          <p class="text-secondary" style="font-size:13px;">Total Booking: <strong class="text-tabular">${formatRupiah(b.total_booking)}</strong> · Terbayar: <strong class="text-tabular">${formatRupiah(b.total_dibayar)}</strong> · Sisa: <strong class="text-tabular">${formatRupiah(b.sisa_pembayaran)}</strong></p>
          <textarea class="form-control" id="bd-catatan" placeholder="Catatan booking...">${b.catatan || ''}</textarea>
          <button class="btn btn-outline-mua btn-sm mt-2" onclick="saveBdCatatan()">Simpan Catatan</button>
        </div>
      </div>
    </div>`;
}

async function updateBookingStatus(newStatus) {
  let alasan = null;
  if (newStatus === 'batal') {
    alasan = prompt('Alasan pembatalan booking (wajib diisi):');
    if (!alasan) { showToast('Pembatalan dibatalkan, alasan wajib diisi.', 'error'); renderBdInfo(); return; }
  }
  const result = await updateRecord('bookings', activeBookingId, { status: newStatus, alasan_batal: alasan }, 'Status booking diperbarui.');
  if (result.success) { await refreshBookingDetailHeader(); renderBdInfo(); renderBookingTable(); }
}

async function saveBdCatatan() {
  const catatan = document.getElementById('bd-catatan').value;
  await updateRecord('bookings', activeBookingId, { catatan }, 'Catatan disimpan.');
}

async function renderBdDirias() {
  const [persons, parents, inLaws, guests] = await Promise.all([
    callSupabase(supabase.from('makeup_persons').select('*').eq('booking_id', activeBookingId)),
    callSupabase(supabase.from('parents').select('*').eq('booking_id', activeBookingId)),
    callSupabase(supabase.from('in_laws').select('*').eq('booking_id', activeBookingId)),
    callSupabase(supabase.from('reception_guests').select('*').eq('booking_id', activeBookingId))
  ]);
  const total = (persons.data?.length || 0) + (parents.data?.length || 0) + (inLaws.data?.length || 0) + (guests.data?.length || 0);
  const renderList = (title, table, rows, fields) => `
    <div class="card-mua mb-3">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <h3 style="font-size:15px;">${title}</h3>
        <button class="btn btn-outline-mua btn-sm" onclick="addDiriasRow('${table}')"><i class="bi bi-plus-lg"></i> Tambah</button>
      </div>
      ${rows && rows.length ? rows.map(r => `
        <div class="d-flex justify-content-between align-items-center py-1" style="border-bottom:1px solid var(--border-color);">
          <span>${r.nama} ${r.jenis_layanan ? '— <span class=\"text-secondary\">' + r.jenis_layanan + '</span>' : ''}</span>
          <button class="btn btn-ghost btn-sm" onclick="deleteDiriasRow('${table}','${r.id}')"><i class="bi bi-trash text-danger"></i></button>
        </div>`).join('') : '<p class="text-secondary mb-0" style="font-size:13px;">Belum ada data.</p>'}
    </div>`;
  document.getElementById('bd-panel-dirias').innerHTML = `
    <p class="mb-3">Total orang yang dirias: <strong class="text-tabular">${total}</strong></p>
    ${renderList('Pengantin / Orang Utama', 'makeup_persons', persons.data, [])}
    ${renderList('Orang Tua', 'parents', parents.data, [])}
    ${renderList('Besan', 'in_laws', inLaws.data, [])}
    ${renderList('Penerima Tamu', 'reception_guests', guests.data, [])}`;
}

async function addDiriasRow(table) {
  const nama = prompt('Nama:');
  if (!nama) return;
  const jenis_layanan = prompt('Jenis layanan (makeup/hairdo/hijab):') || '';
  const payload = { booking_id: activeBookingId, nama, jenis_layanan };
  if (table === 'makeup_persons') payload.jenis = 'lainnya';
  const r = await addRecord(table, payload);
  if (r.success) renderBdDirias();
}
async function deleteDiriasRow(table, id) {
  const r = await deleteRecord(table, id);
  if (r.success) renderBdDirias();
}

async function renderBdGaun() {
  const r = await callSupabase(supabase.from('dresses').select('*, dress_accessories(*)').eq('booking_id', activeBookingId));
  const dresses = r.data || [];
  const statusOrder = ['belum_disiapkan', 'sudah_disiapkan', 'sudah_dibawa', 'dipakai', 'sudah_dikembalikan'];
  document.getElementById('bd-panel-gaun').innerHTML = `
    <div class="d-flex justify-content-end mb-2"><button class="btn btn-primary btn-sm" onclick="addDress()"><i class="bi bi-plus-lg"></i> Tambah Gaun</button></div>
    ${dresses.length === 0 ? '<div class="empty-state"><i class="bi bi-bag-heart"></i>Belum ada data gaun.</div>' : dresses.map(d => `
      <div class="card-mua mb-3">
        <div class="d-flex justify-content-between align-items-start">
          <div><h3 style="font-size:15px;">${d.jenis_gaun}</h3><p class="text-secondary mb-1" style="font-size:13px;">Kode: ${d.kode_gaun || '-'} · Warna: ${d.warna || '-'}</p></div>
          <span class="chip chip-info">${d.status.replace(/_/g, ' ')}</span>
        </div>
        <select class="form-select form-select-sm" style="max-width:220px;" onchange="updateDressStatus('${d.id}', this.value)">
          ${statusOrder.map(s => `<option value="${s}" ${s === d.status ? 'selected' : ''}>${s.replace(/_/g, ' ')}</option>`).join('')}
        </select>
      </div>`).join('')}`;
}
async function addDress() {
  const jenis_gaun = prompt('Jenis gaun:');
  if (!jenis_gaun) return;
  const r = await addRecord('dresses', { booking_id: activeBookingId, jenis_gaun });
  if (r.success) renderBdGaun();
}
async function updateDressStatus(id, status) {
  const r = await updateRecord('dresses', id, { status }, 'Status gaun diperbarui.');
  if (r.success) renderBdGaun();
}

async function renderBdPembayaran() {
  const r = await callSupabase(supabase.from('payments').select('*').eq('booking_id', activeBookingId).order('tanggal_bayar', { ascending: false }));
  const payments = r.data || [];
  const b = cache.activeBooking;
  const pct = b.total_booking > 0 ? Math.min(100, Math.round((b.total_dibayar / b.total_booking) * 100)) : 0;
  document.getElementById('bd-panel-pembayaran').innerHTML = `
    <div class="card-mua mb-3">
      <div class="d-flex justify-content-between mb-2"><span>Progres Pembayaran</span><strong>${pct}%</strong></div>
      <div class="progress mb-2"><div class="progress-bar" style="width:${pct}%"></div></div>
      <p class="text-secondary mb-0" style="font-size:13px;">Total: ${formatRupiah(b.total_booking)} · Terbayar: ${formatRupiah(b.total_dibayar)} · Sisa: ${formatRupiah(b.sisa_pembayaran)}</p>
    </div>
    <div class="d-flex justify-content-between mb-2"><h3 style="font-size:15px;">Riwayat Pembayaran</h3>
      <button class="btn btn-vip btn-sm" onclick="openPaymentModal()"><i class="bi bi-plus-lg"></i> Catat Pembayaran</button>
    </div>
    ${payments.length === 0 ? '<div class="empty-state"><i class="bi bi-cash"></i>Belum ada pembayaran.</div>' :
      `<div class="table-responsive-mua"><table class="table-mua"><thead><tr><th>Tanggal</th><th>Jenis</th><th>Jumlah</th><th>Metode</th><th>Bukti</th></tr></thead><tbody>
        ${payments.map(p => `<tr>
          <td>${formatTanggal(p.tanggal_bayar)}</td>
          <td><span class="chip chip-info">${p.jenis_pembayaran}</span></td>
          <td class="text-tabular">${formatRupiah(p.jumlah)}</td>
          <td>${p.metode || '-'}</td>
          <td>${p.bukti_transfer_url ? `<button class="btn btn-ghost btn-sm" onclick="openPreview('bukti-transfer','${p.bukti_transfer_url}')"><i class="bi bi-image"></i></button>` : '-'}</td>
        </tr>`).join('')}
      </tbody></table></div>`}`;
}

function openPaymentModal() {
  document.getElementById('payment-booking-id').value = activeBookingId;
  document.getElementById('payment-jumlah').value = '';
  document.getElementById('payment-catatan').value = '';
  document.getElementById('payment-bukti').value = '';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-payment')).show();
}

async function savePayment() {
  const jumlah = Number(document.getElementById('payment-jumlah').value);
  if (!jumlah || jumlah <= 0) return showToast('Jumlah pembayaran harus lebih dari 0.', 'error');
  const b = cache.activeBooking;
  if (jumlah > b.sisa_pembayaran) {
    if (!confirm(`Jumlah melebihi sisa pembayaran (${formatRupiah(b.sisa_pembayaran)}). Lanjutkan?`)) return;
  }
  let buktiUrl = null;
  const file = document.getElementById('payment-bukti').files[0];
  if (file) buktiUrl = await uploadFile('bukti-transfer', file);

  const payload = {
    booking_id: activeBookingId,
    jenis_pembayaran: document.getElementById('payment-jenis').value,
    jumlah,
    metode: document.getElementById('payment-metode').value,
    bukti_transfer_url: buktiUrl,
    catatan: document.getElementById('payment-catatan').value.trim()
  };
  const result = await addRecord('payments', payload, 'Pembayaran berhasil dicatat.');
  if (result.success) {
    bootstrap.Modal.getInstance(document.getElementById('modal-payment')).hide();
    await refreshBookingDetailHeader();
    renderBdPembayaran();
    renderBdInfo();
  }
}

async function renderBdChecklist() {
  const r = await callSupabase(supabase.from('booking_checklists').select('*').eq('booking_id', activeBookingId).order('kategori'));
  renderChecklistPanel('bd-panel-checklist', r.data || [], activeBookingId);
}

async function renderBdPacking() {
  const r = await callSupabase(supabase.from('packing_photos').select('*').eq('booking_id', activeBookingId).order('created_at', { ascending: false }));
  const photos = r.data || [];
  document.getElementById('bd-panel-packing').innerHTML = `
    <div class="d-flex justify-content-between mb-2"><h3 style="font-size:15px;">Foto Packing</h3>
      <label class="btn btn-primary btn-sm mb-0"><i class="bi bi-camera"></i> Upload Foto<input type="file" accept="image/*" hidden onchange="uploadPackingPhoto(this)"></label>
    </div>
    <div class="gallery-grid">${photos.map(p => `<img src="${getPublicUrl('packing', p.foto_url)}" onclick="openPreview('packing','${p.foto_url}')" />`).join('')}</div>
    ${photos.length === 0 ? '<div class="empty-state"><i class="bi bi-camera"></i>Belum ada foto packing.</div>' : ''}`;
}
async function uploadPackingPhoto(input) {
  const file = input.files[0];
  if (!file) return;
  const path = await uploadFile('packing', file);
  if (path) {
    await addRecord('packing_photos', { booking_id: activeBookingId, foto_url: path }, 'Foto packing diupload.');
    renderBdPacking();
  }
}

async function renderBdGaleri() {
  const r = await callSupabase(supabase.from('galleries').select('*').eq('booking_id', activeBookingId).order('created_at', { ascending: false }));
  const photos = r.data || [];
  document.getElementById('bd-panel-galeri').innerHTML = `
    <div class="d-flex justify-content-between mb-2"><h3 style="font-size:15px;">Galeri Booking Ini</h3>
      <button class="btn btn-primary btn-sm" onclick="openGalleryUploadModal('${activeBookingId}')"><i class="bi bi-upload"></i> Upload</button>
    </div>
    <div class="gallery-grid">${photos.map(p => `<img src="${getPublicUrl('galeri', p.foto_url)}" onclick="openPreview('galeri','${p.foto_url}')" />`).join('')}</div>
    ${photos.length === 0 ? '<div class="empty-state"><i class="bi bi-images"></i>Belum ada foto galeri.</div>' : ''}`;
}

function sendWhatsApp() {
  const b = cache.activeBooking;
  const client = findClient(b.client_id);
  if (!client) return;
  let template = appConfig.wa_template_reminder_h7 || 'Halo {nama_client}, terkait booking {nomor_booking}.';
  const msg = template
    .replace('{nama_client}', client.nama_lengkap)
    .replace('{tanggal_acara}', formatTanggal(b.tanggal_acara))
    .replace('{nomor_booking}', b.booking_number)
    .replace('{jumlah_dp}', formatRupiah(b.total_dibayar));
  const phone = client.no_whatsapp.replace(/^0/, '62').replace(/\D/g, '');
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
}
function openMapsLocation() {
  const b = cache.activeBooking;
  if (b.lokasi_maps_url) window.open(b.lokasi_maps_url, '_blank');
  else showToast('Link lokasi belum diisi untuk booking ini.', 'error');
}

// =====================================================================
// CHECKLIST HARI H (halaman mandiri)
// =====================================================================
function loadChecklistSection() {
  const sel = document.getElementById('checklist-booking-select');
  sel.innerHTML = '<option value="">-- Pilih Booking --</option>' +
    cache.bookings.filter(b => b.status !== 'batal').map(b => {
      const c = findClient(b.client_id);
      return `<option value="${b.id}">${b.booking_number} — ${c ? c.nama_lengkap : ''}</option>`;
    }).join('');
  document.getElementById('checklist-content').innerHTML = '<div class="empty-state"><i class="bi bi-check2-square"></i>Pilih booking untuk menampilkan checklist.</div>';
}
async function loadChecklistForBooking(bookingId) {
  if (!bookingId) return;
  const r = await callSupabase(supabase.from('booking_checklists').select('*').eq('booking_id', bookingId).order('kategori'));
  renderChecklistPanel('checklist-content', r.data || [], bookingId);
}
function renderChecklistPanel(containerId, items, bookingId) {
  const total = items.length;
  const done = items.filter(i => i.status !== 'belum_disiapkan').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const kategoris = [...new Set(items.map(i => i.kategori))];
  const statusCycle = ['belum_disiapkan', 'sudah_disiapkan', 'sudah_dibawa'];
  document.getElementById(containerId).innerHTML = `
    <div class="card-mua mb-3">
      <div class="d-flex justify-content-between mb-2"><span>Progress (${done}/${total} item)</span><strong>${pct}%</strong></div>
      <div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
    </div>
    ${kategoris.length === 0 ? '<div class="empty-state"><i class="bi bi-check2-square"></i>Checklist belum ter-generate.</div>' : kategoris.map(kat => `
      <div class="card-mua mb-2">
        <h3 style="font-size:14px; text-transform:capitalize;" class="mb-2">${kat}</h3>
        ${items.filter(i => i.kategori === kat).map(i => `
          <div class="d-flex justify-content-between align-items-center py-1" style="border-bottom:1px solid var(--border-color);">
            <span>${i.nama_item}</span>
            <select class="form-select form-select-sm" style="width:160px;" onchange="updateChecklistItemStatus('${i.id}', this.value, '${bookingId}', '${containerId}')">
              ${statusCycle.map(s => `<option value="${s}" ${s === i.status ? 'selected' : ''}>${s.replace(/_/g, ' ')}</option>`).join('')}
            </select>
          </div>`).join('')}
      </div>`).join('')}
    <div class="text-end mt-2"><button class="btn btn-outline-mua btn-sm" onclick="addCustomChecklistItem('${bookingId}','${containerId}')"><i class="bi bi-plus-lg"></i> Item Tambahan</button></div>`;
}
async function updateChecklistItemStatus(id, status, bookingId, containerId) {
  const r = await updateRecord('booking_checklists', id, { status });
  if (r.success) {
    const fresh = await callSupabase(supabase.from('booking_checklists').select('*').eq('booking_id', bookingId).order('kategori'));
    renderChecklistPanel(containerId, fresh.data || [], bookingId);
  }
}
async function addCustomChecklistItem(bookingId, containerId) {
  const nama = prompt('Nama item tambahan:');
  if (!nama) return;
  const kategori = prompt('Kategori (makeup/hairdo/hijab/pengantin/gaun/peralatan/kebersihan):', 'peralatan');
  await addRecord('booking_checklists', { booking_id: bookingId, kategori, nama_item: nama });
  const fresh = await callSupabase(supabase.from('booking_checklists').select('*').eq('booking_id', bookingId).order('kategori'));
  renderChecklistPanel(containerId, fresh.data || [], bookingId);
}

// =====================================================================
// KALENDER
// =====================================================================
function shiftCalendarMonth(delta) {
  calendarCursor.setMonth(calendarCursor.getMonth() + delta);
  renderCalendar();
}
async function renderCalendar() {
  const r = await getAllData('schedules', 'tanggal', true);
  const schedules = r.success ? r.data : [];
  document.getElementById('kalender-label').textContent = calendarCursor.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
  const year = calendarCursor.getFullYear(), month = calendarCursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let html = '';
  for (let i = 0; i < startOffset; i++) html += '<div></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const events = schedules.filter(s => s.tanggal === dateStr);
    html += `<div class="calendar-day ${events.length ? 'has-event' : ''}" onclick="showDayEvents('${dateStr}')">
      <div class="day-num">${d}</div>
      ${events.map(() => '<span class="event-dot"></span>').join('')}
    </div>`;
  }
  document.getElementById('kalender-grid').innerHTML = html;
}
function showDayEvents(dateStr) {
  const bookingsOnDay = cache.bookings.filter(b => b.tanggal_acara === dateStr);
  if (bookingsOnDay.length === 0) return showToast('Tidak ada jadwal di tanggal ini.', 'error');
  if (bookingsOnDay.length === 1) openBookingDetail(bookingsOnDay[0].id);
  else navigateTo('bookings');
}

// =====================================================================
// KEUANGAN
// =====================================================================
function switchFinanceTab(tab) {
  document.querySelectorAll('.fin-tab').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  document.getElementById('finance-pemasukan-panel').classList.toggle('d-none', tab !== 'pemasukan');
  document.getElementById('finance-pengeluaran-panel').classList.toggle('d-none', tab !== 'pengeluaran');
}
async function loadFinanceSection() {
  const [paymentsRes, expensesRes] = await Promise.all([getAllData('payments'), getAllData('expenses')]);
  const payments = paymentsRes.success ? paymentsRes.data : [];
  const expenses = expensesRes.success ? expensesRes.data : [];
  const totalMasuk = payments.reduce((s, p) => s + Number(p.jumlah), 0);
  const totalKeluar = expenses.reduce((s, e) => s + Number(e.nominal), 0);
  document.getElementById('fin-pemasukan').textContent = formatRupiah(totalMasuk);
  document.getElementById('fin-pengeluaran').textContent = formatRupiah(totalKeluar);
  document.getElementById('fin-profit').textContent = formatRupiah(totalMasuk - totalKeluar);
  document.getElementById('fin-piutang').textContent = formatRupiah(cache.bookings.reduce((s, b) => s + Number(b.sisa_pembayaran || 0), 0));

  document.getElementById('pemasukan-tbody').innerHTML = payments.map(p => {
    const b = cache.bookings.find(bk => bk.id === p.booking_id);
    return `<tr><td>${formatTanggal(p.tanggal_bayar)}</td><td>${b ? b.booking_number : '-'}</td><td>${p.jenis_pembayaran}</td><td class="text-tabular">${formatRupiah(p.jumlah)}</td><td>${p.metode || '-'}</td></tr>`;
  }).join('') || '<tr><td colspan="5"><div class="empty-state">Belum ada data.</div></td></tr>';

  document.getElementById('pengeluaran-tbody').innerHTML = expenses.map(e =>
    `<tr><td>${formatTanggal(e.tanggal)}</td><td>${e.kategori}</td><td class="text-tabular">${formatRupiah(e.nominal)}</td><td>${e.keterangan || '-'}</td></tr>`
  ).join('') || '<tr><td colspan="4"><div class="empty-state">Belum ada data.</div></td></tr>';
}
function openExpenseModal() {
  document.getElementById('expense-tanggal').value = new Date().toISOString().slice(0, 10);
  document.getElementById('expense-nominal').value = '';
  document.getElementById('expense-keterangan').value = '';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-expense')).show();
}
async function saveExpense() {
  const nominal = Number(document.getElementById('expense-nominal').value);
  if (!nominal || nominal < 0) return showToast('Nominal pengeluaran tidak valid.', 'error');
  const payload = {
    tanggal: document.getElementById('expense-tanggal').value,
    kategori: document.getElementById('expense-kategori').value,
    nominal,
    keterangan: document.getElementById('expense-keterangan').value.trim()
  };
  const result = await addRecord('expenses', payload, 'Pengeluaran berhasil dicatat.');
  if (result.success) { bootstrap.Modal.getInstance(document.getElementById('modal-expense')).hide(); loadFinanceSection(); }
}

// =====================================================================
// GALERI (global)
// =====================================================================
async function loadGaleriGlobal() {
  const r = await getAllData('galleries');
  const grid = document.getElementById('galeri-global-grid');
  if (!r.success || r.data.length === 0) {
    grid.innerHTML = `<div class="empty-state"><i class="bi bi-images"></i>Belum ada foto galeri.</div>`;
    return;
  }
  grid.innerHTML = r.data.map(p => `<img src="${getPublicUrl('galeri', p.foto_url)}" onclick="openPreview('galeri','${p.foto_url}')" />`).join('');
}
function openGalleryUploadModal(bookingId = null) {
  const sel = document.getElementById('gallery-client-id');
  sel.innerHTML = cache.clients.map(c => `<option value="${c.id}">${c.nama_lengkap}</option>`).join('');
  document.getElementById('modal-gallery-upload').dataset.bookingId = bookingId || '';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-gallery-upload')).show();
}
async function saveGalleryPhoto() {
  const file = document.getElementById('gallery-file').files[0];
  if (!file) return showToast('Pilih file foto terlebih dahulu.', 'error');
  const path = await uploadFile('galeri', file);
  if (!path) return;
  const bookingId = document.getElementById('modal-gallery-upload').dataset.bookingId || null;
  const payload = {
    client_id: document.getElementById('gallery-client-id').value,
    booking_id: bookingId,
    kategori: document.getElementById('gallery-kategori').value,
    foto_url: path,
    keterangan: document.getElementById('gallery-keterangan').value.trim()
  };
  const result = await addRecord('galleries', payload, 'Foto berhasil diupload.');
  if (result.success) {
    bootstrap.Modal.getInstance(document.getElementById('modal-gallery-upload')).hide();
    if (bookingId) renderBdGaleri(); else loadGaleriGlobal();
  }
}

// =====================================================================
// TEAM MUA
// =====================================================================
function renderTeamGrid() {
  const grid = document.getElementById('team-grid');
  if (cache.teamMembers.length === 0) {
    grid.innerHTML = `<div class="col-12"><div class="empty-state"><i class="bi bi-person-badge"></i>Belum ada anggota team.</div></div>`;
    return;
  }
  grid.innerHTML = cache.teamMembers.map(t => `
    <div class="col-6 col-md-3">
      <div class="card-mua text-center">
        <div class="avatar-tile avatar-circle mx-auto mb-2" style="width:56px;height:56px;font-size:20px;">${t.nama_lengkap.charAt(0)}</div>
        <h3 style="font-size:14px;">${t.nama_lengkap}</h3>
        <span class="chip chip-info">${t.peran.replace(/_/g, ' ')}</span>
        <div class="mt-2"><button class="btn btn-ghost btn-sm" onclick="openTeamModal('${t.id}')"><i class="bi bi-pencil"></i></button></div>
      </div>
    </div>`).join('');
}
function openTeamModal(id = null) {
  document.getElementById('team-id').value = id || '';
  document.getElementById('team-nama_lengkap').value = '';
  document.getElementById('team-no_whatsapp').value = '';
  if (id) {
    const t = findTeamMember(id);
    if (t) { document.getElementById('team-nama_lengkap').value = t.nama_lengkap; document.getElementById('team-peran').value = t.peran; document.getElementById('team-no_whatsapp').value = t.no_whatsapp || ''; }
  }
  bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-team')).show();
}
async function saveTeamMember() {
  const id = document.getElementById('team-id').value;
  const nama = document.getElementById('team-nama_lengkap').value.trim();
  if (!nama) return showToast('Nama wajib diisi.', 'error');
  const payload = { nama_lengkap: nama, peran: document.getElementById('team-peran').value, no_whatsapp: document.getElementById('team-no_whatsapp').value.trim() };
  const result = id ? await updateRecord('team_members', id, payload) : await addRecord('team_members', payload);
  if (result.success) { await loadTeamMembers(); renderTeamGrid(); bootstrap.Modal.getInstance(document.getElementById('modal-team')).hide(); }
}

// =====================================================================
// LAPORAN
// =====================================================================
let chartLaporanOmzet = null, chartLaporanPaket = null;
async function loadLaporan() {
  const [paymentsRes, bookingsRes] = await Promise.all([getAllData('payments'), getAllData('bookings')]);
  const payments = paymentsRes.success ? paymentsRes.data : [];
  const bookings = bookingsRes.success ? bookingsRes.data : [];
  const now = new Date();
  const labels = [], omzet = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    labels.push(d.toLocaleDateString('id-ID', { month: 'short' }));
    omzet.push(payments.filter(p => { const pd = new Date(p.tanggal_bayar); return pd.getMonth() === d.getMonth() && pd.getFullYear() === d.getFullYear(); }).reduce((s, p) => s + Number(p.jumlah), 0));
  }
  if (chartLaporanOmzet) chartLaporanOmzet.destroy();
  chartLaporanOmzet = new Chart(document.getElementById('chart-laporan-omzet'), {
    type: 'line', data: { labels, datasets: [{ label: 'Omzet 6 Bulan Terakhir', data: omzet, borderColor: '#B76E79', backgroundColor: 'rgba(183,110,121,0.15)', fill: true, tension: 0.3 }] }
  });

  const paketCount = {};
  bookings.forEach(b => { const p = findPackage(b.package_id); const nm = p ? p.nama_paket : 'Lainnya'; paketCount[nm] = (paketCount[nm] || 0) + 1; });
  if (chartLaporanPaket) chartLaporanPaket.destroy();
  chartLaporanPaket = new Chart(document.getElementById('chart-laporan-paket'), {
    type: 'doughnut', data: { labels: Object.keys(paketCount), datasets: [{ data: Object.values(paketCount), backgroundColor: ['#B76E79', '#CBA477', '#9C5A66', '#D98C96', '#8C6E70'] }] }
  });
}

// =====================================================================
// FILE UPLOAD & MODAL PREVIEW
// =====================================================================
async function uploadFile(bucket, file) {
  const path = `${currentProfile?.id || 'umum'}/${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
  const result = await callSupabase(supabase.storage.from(bucket).upload(path, file), 'File berhasil diupload.');
  return result.success ? path : null;
}
function getPublicUrl(bucket, path) {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}
async function openPreview(bucket, path) {
  let url;
  if (bucket === 'bukti-transfer') {
    const r = await callSupabase(supabase.storage.from(bucket).createSignedUrl(path, 60));
    url = r.success ? r.data.signedUrl : '';
  } else {
    url = getPublicUrl(bucket, path);
  }
  document.getElementById('preview-img').src = url;
  document.getElementById('preview-download').href = url;
  bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-preview')).show();
}
