// H5 公共 JS：用户态 + API 封装
const API = '/api';
function getUID() { return localStorage.getItem('lm_uid') || ''; }
function setUID(id) { localStorage.setItem('lm_uid', id); }

async function api(path, opts = {}) {
  opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
  const r = await fetch(API + path, opts);
  const j = await r.json();
  if (j.code !== 0) throw new Error(j.msg || '请求失败');
  return j.data;
}
function money(n) { return '¥' + (n * 1).toFixed(2); }
function fmtTime(t) {
  if (!t) return '';
  const d = new Date(t);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function statusTag(s) {
  if (s === '进行中') return '<span class="tag sale">进行中</span>';
  if (s === '待开售') return '<span class="tag wait">待开售</span>';
  return '<span class="tag done">已开奖</span>';
}
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}
function maskName(n) {
  if (!n) return '匿名';
  return n.length <= 1 ? n : n[0] + '***' + n[n.length - 1];
}
// 确保登录（按手机号），返回 user
async function ensureLogin() {
  let uid = getUID();
  if (uid) {
    try { return await api('/users/' + uid); } catch (e) {}
  }
  const phone = prompt('请输入手机号登录/注册：');
  if (!phone) location.reload();
  const name = prompt('请输入昵称（可留空）：') || '';
  const user = await api('/users', { method: 'POST', body: { phone, name } });
  setUID(user.id);
  return user;
}
