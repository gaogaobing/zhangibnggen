// 轻量级 JSON 文件数据存储层（无原生依赖，保证任意环境可直接运行）
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// 充值套餐默认数据（后台未配置时使用）
const DEFAULT_RECHARGE_PLANS = [
  { name: '充值 ¥30', amount: 30, bonus: 0, enabled: true, sort: 1 },
  { name: '充值 ¥100', amount: 100, bonus: 8, enabled: true, sort: 2 },
  { name: '充值 ¥300', amount: 300, bonus: 30, enabled: true, sort: 3 },
  { name: '充值 ¥500', amount: 500, bonus: 60, enabled: true, sort: 4 }
];

// 首页轮播默认数据（后台未配置时使用）
const DEFAULT_BANNERS = [
  { title: '新人专享 首单立减', subtitle: '注册即领 5 元无门槛参与券', btnText: '立即领取 →', emoji: '🎁',
    bg: 'linear-gradient(120deg,#ff6b6b,#ff9a44)', link: '/mine.html', sort: 1, enabled: true },
  { title: '幸运抽奖 100% 必中', subtitle: '每期必出一位中奖者，公平公正', btnText: '去看看 →', emoji: '🎉',
    bg: 'linear-gradient(120deg,#7c5cff,#4facfe)', link: '/', sort: 2, enabled: true },
  { title: '邀请好友 赢好礼', subtitle: '好友参与你得奖励，上不封顶', btnText: '邀请好友 →', emoji: '👫',
    bg: 'linear-gradient(120deg,#11998e,#38ef7d)', link: '/mine.html', sort: 3, enabled: true }
];

const DEFAULT_SETTINGS = {
  bannerInterval: 3500,      // 轮播自动播放间隔（毫秒）
  notice: '🎉 幸运商城上线啦，每期必出一位中奖者，公平公正公开',
  noticeEnabled: true
};

// 商户收款账户默认结构（后台配置；会员充值按所选方式看到对应收款码/账号）
function defaultPayees() {
  return {
    wechat: { enabled: true, name: '微信收款', account: '', qr: '' },
    alipay: { enabled: true, name: '支付宝收款', account: '', qr: '' },
    bank:   { enabled: true, name: '银行卡收款', account: '', qr: '', bankName: '', holder: '' }
  };
}

function emptyDB() {
  return {
    products: [], users: [], orders: [], draws: [], banners: [],
    rechargePlans: [], recharges: [], bills: [],
    settings: Object.assign({}, DEFAULT_SETTINGS),
    payees: defaultPayees(),
    seq: { product: 0, order: 0, user: 0, code: 0, draw: 0, banner: 0, plan: 0, recharge: 0, bill: 0 }
  };
}

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify(emptyDB(), null, 2));
}

function load() {
  ensure();
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  // 向后兼容：补齐旧版本缺失的字段
  const base = emptyDB();
  ['products', 'users', 'orders', 'draws', 'banners', 'rechargePlans', 'recharges', 'bills'].forEach((k) => {
    if (!Array.isArray(db[k])) db[k] = base[k];
  });
  db.seq = Object.assign({}, base.seq, db.seq || {});
  db.settings = Object.assign({}, base.settings, db.settings || {});
  // 向后兼容：收款账户（缺字段补齐）
  db.payees = Object.assign({ wechat: {}, alipay: {}, bank: {} }, db.payees || {});
  ['wechat', 'alipay', 'bank'].forEach((k) => { db.payees[k] = Object.assign({}, base.payees[k], db.payees[k] || {}); });
  // 向后兼容：旧用户补齐余额字段
  db.users.forEach((u) => { if (typeof u.balance !== 'number') u.balance = 0; });
  return db;
}

function save(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// 若后台从未配置过轮播，注入默认轮播（保证后台有内容可管、前台不空屏）
function ensureBanners(db) {
  if (db.banners.length > 0) return false;
  db.banners = DEFAULT_BANNERS.map((b, i) => {
    db.seq.banner = i + 1;
    return Object.assign({ id: 'B' + (i + 1), createdAt: Date.now() }, b);
  });
  return true;
}

// 若后台从未配置过充值套餐，注入默认套餐
function ensureRechargePlans(db) {
  if (db.rechargePlans.length > 0) return false;
  db.rechargePlans = DEFAULT_RECHARGE_PLANS.map((pl, i) => {
    db.seq.plan = i + 1;
    return Object.assign({ id: 'PL' + (i + 1), createdAt: Date.now() }, pl);
  });
  return true;
}

module.exports = { load, save, ensureBanners, ensureRechargePlans, DEFAULT_BANNERS, DEFAULT_RECHARGE_PLANS, DEFAULT_SETTINGS, DB_FILE, DATA_DIR };
