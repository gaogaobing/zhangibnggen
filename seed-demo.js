// 生成演示数据：重置数据库 → 写入示例商品 → 模拟多用户参与
// 结果：P1/P2 进行中（部分售出）、P3 已开奖（售罄自动开奖 + 物流）、P4 待开售
// 用法：node seed-demo.js
const core = require('./core');
const store = core.store;

const db = store.load();
db.products = []; db.users = []; db.orders = []; db.draws = []; db.banners = [];
db.rechargePlans = []; db.recharges = []; db.bills = [];
db.settings = Object.assign({}, store.DEFAULT_SETTINGS);
db.seq = { product: 0, order: 0, user: 0, code: 0, draw: 0, banner: 0, plan: 0, recharge: 0, bill: 0 };
store.ensureBanners(db);       // 注入 3 条默认首页轮播
store.ensureRechargePlans(db); // 注入默认充值套餐

// 1. 示例商品
const samples = [
  { name: 'iPhone 16 抽奖', image: '📱', detail: '全新国行 iPhone 16 256G，公平抽奖，份数售罄后系统自动开奖。\n支持全国联保，正品保障。', totalAmount: 5999, totalShares: 100, onSale: true },
  { name: 'AirPods Pro 抽奖', image: '🎧', detail: 'Apple AirPods Pro 2 主动降噪耳机，低门槛参与，人人都有机会。', totalAmount: 1299, totalShares: 50, onSale: true },
  { name: '京东 E 卡 ¥500', image: '💳', detail: '500 元京东 E 卡，5 元一份，买得多中奖概率更高。', totalAmount: 500, totalShares: 100, onSale: true },
  { name: 'Switch 游戏机（预热中）', image: '🎮', detail: '任天堂 Switch OLED 主机，即将开售，敬请期待。', totalAmount: 2399, totalShares: 80, onSale: false }
];
samples.forEach((s) => {
  db.seq.product += 1;
  db.products.push({
    id: 'P' + db.seq.product, name: s.name, image: s.image, detail: s.detail,
    totalAmount: s.totalAmount, totalShares: s.totalShares,
    pricePerShare: core.pricePerShare(s.totalAmount, s.totalShares),
    soldShares: 0, onSale: s.onSale, winningCode: '', winningUserId: '', winningUserName: '',
    drawnAt: null, createdAt: Date.now()
  });
});

// 2. 示例用户
const people = [
  { name: '张伟', phone: '13800000001', address: '浙江省台州市椒江区安康路 315 号' },
  { name: '李娜', phone: '13800000002', address: '浙江省杭州市西湖区文三路 88 号' },
  { name: '王强', phone: '13800000003', address: '上海市浦东新区世纪大道 100 号' },
  { name: '刘洋', phone: '13800000004', address: '广东省深圳市南山区科技园 A 座' },
  { name: '陈静', phone: '13800000005', address: '北京市朝阳区建国路 66 号' }
];
people.forEach((p) => {
  db.seq.user += 1;
  db.users.push({ id: 'U' + db.seq.user, phone: p.phone, name: p.name, address: p.address, balance: 0, createdAt: Date.now() });
});

const rnd = (n) => Math.floor(Math.random() * n);
const ago = (min) => Date.now() - rnd(min * 60 * 1000) - 60 * 1000;

// 2.5 演示充值：给前 3 位用户充点余额 + 充值记录 + 流水
const plan = db.rechargePlans.find((x) => x.amount === 100);
[['U1', 100], ['U2', 300], ['U3', 30]].forEach(([uid, amt]) => {
  const u = db.users.find((x) => x.id === uid);
  const gift = amt + (plan && amt === plan.amount ? plan.bonus : 0);
  db.seq.recharge += 1;
  const rec = { id: 'R' + db.seq.recharge, userId: u.id, userName: u.name, planId: plan.id, amount: amt, bonus: gift - amt, gift, method: 'wechat', status: 'paid', createdAt: ago(60 * 24), confirmedBy: 'system', confirmedAt: ago(60 * 24) };
  db.recharges.push(rec);
  u.balance = +((u.balance || 0) + gift).toFixed(2);
  core.addBill(db, { userId: u.id, userName: u.name, type: 'recharge', amount: gift, direction: 'in', balance: u.balance, refId: rec.id, remark: '账户充值' });
});

// 3. 模拟参与：按目标份数随机下单
function participate(productId, targetShares) {
  const prod = db.products.find((p) => p.id === productId);
  let left = Math.min(targetShares, prod.totalShares - prod.soldShares);
  while (left > 0) {
    const user = db.users[rnd(db.users.length)];
    const shares = Math.min(left, 1 + rnd(6));
    core.createOrder(db, prod, user, shares, { createdAt: ago(60 * 24) });
    left -= shares;
  }
}

participate('P3', 100);   // 售罄 → 自动开奖
participate('P1', 67);    // 进行中
participate('P2', 24);    // 进行中
// P4 保持待开售，0 参与

// 4. 为已开奖的 P3 录入物流
const d = db.draws.find((x) => x.productId === 'P3');
if (d) { d.logistics = '顺丰速运 SF1234567890'; d.shipped = true; }

store.save(db);

console.log('✅ 演示数据已生成\n');
console.log('商品状态：');
db.products.forEach((p) => {
  console.log(`  ${p.image} ${p.name}  总价 ¥${p.totalAmount} / ${p.totalShares}份 = ¥${p.pricePerShare}/份 | 已售 ${p.soldShares} | ${core.statusOf(p)}${p.winningCode ? ' 中奖码 ' + p.winningCode + ' → ' + p.winningUserName : ''}`);
});
console.log(`\n用户 ${db.users.length} 人 | 订单 ${db.orders.length} 笔 | 开奖 ${db.draws.length} 次 | 轮播 ${db.banners.length} 条 | 充值套餐 ${db.rechargePlans.length} 个 | 充值记录 ${db.recharges.length} 笔`);
if (d) console.log(`P3 中奖：${d.winningUserName}（${d.winningCode}）物流：${d.logistics}`);
