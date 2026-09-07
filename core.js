// 幸运商城核心业务逻辑（server 与 seed 脚本共用，避免逻辑重复）
const store = require('./store');

// 每份单价 = 商品总金额 ÷ 拆分总份数
function pricePerShare(totalAmount, totalShares) {
  return +(totalAmount / totalShares).toFixed(2);
}

function statusOf(p) {
  if (p.winningCode) return '已开奖';
  if (!p.onSale) return '待开售';
  return '进行中';
}

// 生成抽奖码：P{商品ID}-{6位全局递增序号}
function genCode(db, productId) {
  db.seq.code = (db.seq.code || 0) + 1;
  return 'P' + productId + '-' + String(db.seq.code).padStart(6, '0');
}

// 开奖：从该商品全部已发放抽奖码中随机抽取 1 个
function drawProduct(db, product) {
  db.seq.draw = (db.seq.draw || 0);
  const orders = db.orders.filter((o) => o.productId === product.id && o.status === 'paid');
  const pool = [];
  orders.forEach((o) => o.codes.forEach((c) => pool.push({ code: c, userId: o.userId, userName: o.userName })));
  if (pool.length === 0) return null;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  product.winningCode = pick.code;
  product.winningUserId = pick.userId;
  product.winningUserName = pick.userName;
  product.drawnAt = Date.now();
  db.seq.draw += 1;
  const draw = {
    id: 'D' + db.seq.draw, productId: product.id, productName: product.name,
    winningCode: pick.code, winningUserId: pick.userId, winningUserName: pick.userName,
    drawnAt: product.drawnAt, logistics: '', shipped: false
  };
  db.draws.push(draw);
  return draw;
}

// 下单（模拟支付）：分配抽奖码，售罄则自动开奖
function createOrder(db, product, user, shares, opts) {
  opts = opts || {};
  const codes = [];
  for (let i = 0; i < shares; i++) codes.push(genCode(db, product.id));
  db.seq.order = (db.seq.order || 0) + 1;
  const order = {
    id: 'O' + db.seq.order, productId: product.id, productName: product.name,
    userId: user.id, userName: user.name, shares,
    amount: +(shares * product.pricePerShare).toFixed(2),
    codes, status: 'paid', createdAt: opts.createdAt || Date.now(),
    logistics: '', shipped: false
  };
  product.soldShares += shares;
  db.orders.push(order);
  let draw = null;
  if (product.soldShares >= product.totalShares && !product.winningCode) {
    draw = drawProduct(db, product);
  }
  return { order, drawn: !!draw, draw };
}

// 写入一条账单流水（充值入账 / 下单扣款 / 后台调整）
function addBill(db, rec) {
  db.seq.bill = (db.seq.bill || 0) + 1;
  const bill = {
    id: 'BILL' + db.seq.bill,
    userId: rec.userId, userName: rec.userName || '',
    type: rec.type,                       // recharge | order | adjust
    amount: +(+rec.amount).toFixed(2),
    direction: rec.direction,             // in | out
    balance: +(rec.balance !== undefined ? rec.balance : 0).toFixed(2),
    refId: rec.refId || '', remark: rec.remark || '',
    createdAt: Date.now()
  };
  db.bills.push(bill);
  return bill;
}

module.exports = { store, pricePerShare, statusOf, genCode, drawProduct, createOrder, addBill };
