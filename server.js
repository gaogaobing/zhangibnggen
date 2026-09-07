// H5 幸运商城 —— 后端服务（Node 内置 http，零依赖）
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const store = require('./store');
const core = require('./core');

const PORT = process.env.PORT || 3000;
const ADMIN_PASS = 'admin888';

/* ---------------- 工具函数 ---------------- */
function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); }
      catch (e) {
        const err = new Error('请求数据格式错误（JSON 解析失败）');
        err.status = 400;
        reject(err);
      }
    });
    req.on('error', reject);
  });
}
// 读取原始二进制（用于图片上传）
function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function extFromContentType(ct) {
  if (!ct) return '.png';
  if (/jpeg|jpg/.test(ct)) return '.jpg';
  if (/png/.test(ct)) return '.png';
  if (/webp/.test(ct)) return '.webp';
  if (/gif/.test(ct)) return '.gif';
  return '.png';
}
const statusOf = core.statusOf;
function publicProduct(p) {
  return {
    id: p.id, name: p.name, image: p.image, detail: p.detail,
    totalAmount: p.totalAmount, totalShares: p.totalShares,
    pricePerShare: p.pricePerShare, soldShares: p.soldShares,
    remainShares: p.totalShares - p.soldShares, status: statusOf(p),
    onSale: p.onSale, winningCode: p.winningCode || null,
    winningUserName: p.winningUserName || null, drawnAt: p.drawnAt || null,
    createdAt: p.createdAt
  };
}
const genCode = core.genCode;
const drawProduct = core.drawProduct;
function isAdmin(req) {
  return req.headers['x-admin-key'] === ADMIN_PASS;
}

/* ---------------- 路由处理 ---------------- */
async function handleApi(req, res, parsed) {
  const method = req.method;
  const p = parsed.pathname;
  const db = store.load();

  /* ===== 公开 / 用户接口 ===== */
  // 商品列表
  if (method === 'GET' && p === '/api/products') {
    return send(res, 200, { code: 0, data: db.products.map(publicProduct) });
  }
  // 商品详情
  let m = p.match(/^\/api\/products\/(\w+)$/);
  if (method === 'GET' && m) {
    const prod = db.products.find((x) => x.id === m[1]);
    if (!prod) return send(res, 404, { code: 1, msg: '商品不存在' });
    return send(res, 200, { code: 0, data: publicProduct(prod) });
  }
  // 商品参与记录
  m = p.match(/^\/api\/products\/(\w+)\/participants$/);
  if (method === 'GET' && m) {
    const list = db.orders
      .filter((o) => o.productId === m[1] && o.status === 'paid')
      .map((o) => ({ userName: o.userName, shares: o.shares, codes: o.codes.length, createdAt: o.createdAt }))
      .sort((a, b) => b.createdAt - a.createdAt);
    return send(res, 200, { code: 0, data: list });
  }
  // 商品往期中奖记录
  m = p.match(/^\/api\/products\/(\w+)\/winners$/);
  if (method === 'GET' && m) {
    const draws = db.draws.filter((d) => d.productId === m[1]);
    return send(res, 200, { code: 0, data: draws });
  }
  // 开奖结果
  m = p.match(/^\/api\/draws\/(\w+)$/);
  if (method === 'GET' && m) {
    const draw = db.draws.find((d) => d.productId === m[1]);
    return send(res, 200, { code: 0, data: draw || null });
  }
  // 全局中奖记录（往期中奖公示）
  if (method === 'GET' && p === '/api/winners') {
    return send(res, 200, { code: 0, data: db.draws.slice().sort((a, b) => b.drawnAt - a.drawnAt) });
  }
  // 首页轮播（仅启用的，按排序）
  if (method === 'GET' && p === '/api/banners') {
    const list = db.banners.filter((b) => b.enabled)
      .slice().sort((a, b) => (a.sort || 0) - (b.sort || 0));
    return send(res, 200, { code: 0, data: list });
  }
  // 首页设置（轮播间隔 / 公告）
  if (method === 'GET' && p === '/api/settings') {
    const s = db.settings;
    return send(res, 200, { code: 0, data: { bannerInterval: s.bannerInterval, notice: s.notice, noticeEnabled: s.noticeEnabled } });
  }
  // 商户收款账户（公开，仅返回已启用，供会员充值页展示收款码/账号）
  if (method === 'GET' && p === '/api/payees') {
    const labels = { wechat: '微信', alipay: '支付宝', bank: '银行卡' };
    const list = ['wechat', 'alipay', 'bank']
      .filter((k) => db.payees[k] && db.payees[k].enabled)
      .map((k) => ({
        method: k, label: labels[k],
        name: db.payees[k].name || labels[k],
        account: db.payees[k].account || '',
        qr: db.payees[k].qr || '',
        bankName: db.payees[k].bankName || '',
        holder: db.payees[k].holder || ''
      }));
    return send(res, 200, { code: 0, data: list });
  }
  // 注册/登录用户（按手机号）
  if (method === 'POST' && p === '/api/users') {
    const b = await readBody(req);
    if (!b.phone) return send(res, 400, { code: 1, msg: '缺少手机号' });
    let user = db.users.find((u) => u.phone === b.phone);
    if (!user) {
      db.seq.user = (db.seq.user || 0) + 1;
      user = { id: 'U' + db.seq.user, phone: b.phone, name: b.name || ('用户' + b.phone.slice(-4)), address: '', createdAt: Date.now() };
      db.users.push(user);
      store.save(db);
    } else if (b.name && !user.name) {
      user.name = b.name; store.save(db);
    }
    return send(res, 200, { code: 0, data: user });
  }
  // 用户详情 / 修改收货地址
  m = p.match(/^\/api\/users\/(\w+)$/);
  if (m) {
    const user = db.users.find((u) => u.id === m[1]);
    if (!user) return send(res, 404, { code: 1, msg: '用户不存在' });
    if (method === 'GET') return send(res, 200, { code: 0, data: user });
    if (method === 'PUT') {
      const b = await readBody(req);
      if (typeof b.address === 'string') user.address = b.address;
      if (b.name) user.name = b.name;
      store.save(db);
      return send(res, 200, { code: 0, data: user });
    }
  }
  // 下单购买（模拟支付）
  if (method === 'POST' && p === '/api/orders') {
    const b = await readBody(req);
    if (!b.productId || !b.userId || !b.shares)
      return send(res, 400, { code: 1, msg: '参数缺失（productId / userId / shares 必填）' });
    const prod = db.products.find((x) => x.id === b.productId);
    if (!prod) return send(res, 404, { code: 1, msg: '商品不存在' });
    const user = db.users.find((u) => u.id === b.userId);
    if (!user) return send(res, 400, { code: 1, msg: '请先登录' });
    if (!prod.onSale) return send(res, 400, { code: 1, msg: '商品尚未开售' });
    if (prod.winningCode) return send(res, 400, { code: 1, msg: '该商品已开奖' });
    const shares = parseInt(b.shares, 10);
    if (!shares || shares < 1) return send(res, 400, { code: 1, msg: '份数无效' });
    if (prod.soldShares + shares > prod.totalShares)
      return send(res, 400, { code: 1, msg: '剩余份数不足', remain: prod.totalShares - prod.soldShares });
    const amount = +(shares * prod.pricePerShare).toFixed(2);
    const payMethod = b.payMethod === 'balance' ? 'balance' : 'cash';
    if (payMethod === 'balance' && (user.balance || 0) < amount)
      return send(res, 400, { code: 1, msg: '余额不足，请先充值', balance: user.balance || 0, need: amount });
    const { order, drawn, draw } = core.createOrder(db, prod, user, shares);
    order.payMethod = payMethod;
    if (payMethod === 'balance') {
      user.balance = +((user.balance || 0) - amount).toFixed(2);
      core.addBill(db, { userId: user.id, userName: user.name, type: 'order', amount, direction: 'out', balance: user.balance, refId: order.id, remark: '参与「' + prod.name + '」' });
    }
    store.save(db);
    return send(res, 200, { code: 0, data: { order, drawn, draw, balance: user.balance || 0 } });
  }
  // 我的订单
  if (method === 'GET' && p === '/api/orders') {
    const uid = parsed.query.userId;
    const list = db.orders.filter((o) => o.userId === uid).sort((a, b) => b.createdAt - a.createdAt);
    return send(res, 200, { code: 0, data: list });
  }
  // 我的抽奖码
  if (method === 'GET' && p === '/api/my/codes') {
    const uid = parsed.query.userId;
    const codes = [];
    db.orders.filter((o) => o.userId === uid).forEach((o) => {
      const prod = db.products.find((x) => x.id === o.productId);
      const winning = prod && prod.winningCode;
      o.codes.forEach((c) => codes.push({
        code: c, productId: o.productId, productName: o.productName,
        isWin: winning === c
      }));
    });
    return send(res, 200, { code: 0, data: codes });
  }
  // 我的中奖记录
  if (method === 'GET' && p === '/api/my/wins') {
    const uid = parsed.query.userId;
    const list = db.draws.filter((d) => d.winningUserId === uid);
    return send(res, 200, { code: 0, data: list });
  }

  /* ===== 充值相关（用户侧） ===== */
  // 充值套餐（仅已启用的，按排序）
  if (method === 'GET' && p === '/api/recharge/plans') {
    const list = db.rechargePlans.filter((x) => x.enabled)
      .slice().sort((a, b) => (a.sort || 0) - (b.sort || 0))
      .map((x) => ({ id: x.id, name: x.name, amount: x.amount, bonus: x.bonus }));
    return send(res, 200, { code: 0, data: list });
  }
  // 创建充值单（发起支付申请，待商家确认到账后计入余额）
  if (method === 'POST' && p === '/api/recharge') {
    const b = await readBody(req);
    const user = db.users.find((u) => u.id === b.userId);
    if (!user) return send(res, 400, { code: 1, msg: '请先登录' });
    let amount, bonus = 0, planId = '';
    if (b.planId) {
      const plan = db.rechargePlans.find((x) => x.id === b.planId);
      if (!plan) return send(res, 400, { code: 1, msg: '套餐不存在' });
      amount = plan.amount; bonus = plan.bonus || 0; planId = plan.id;
    } else {
      amount = +b.amount; bonus = +(b.bonus || 0);
      if (!amount || amount < 1) return send(res, 400, { code: 1, msg: '充值金额无效' });
    }
    const method = ['wechat', 'alipay', 'bank'].includes(b.method) ? b.method : 'wechat';
    const gift = +(amount + bonus).toFixed(2);
    db.seq.recharge = (db.seq.recharge || 0) + 1;
    const rec = {
      id: 'R' + db.seq.recharge, userId: user.id, userName: user.name,
      planId, amount, bonus, gift, method,
      status: 'pending', createdAt: Date.now(), confirmedBy: '', confirmedAt: null
    };
    db.recharges.push(rec);
    store.save(db);
    return send(res, 200, { code: 0, data: { recharge: rec, balance: user.balance || 0 } });
  }
  // 我的充值记录
  if (method === 'GET' && p === '/api/my/recharges') {
    const uid = parsed.query.userId;
    const list = db.recharges.filter((r) => r.userId === uid).sort((a, b) => b.createdAt - a.createdAt);
    return send(res, 200, { code: 0, data: list });
  }
  // 我的账单流水
  if (method === 'GET' && p === '/api/my/bills') {
    const uid = parsed.query.userId;
    const list = db.bills.filter((x) => x.userId === uid).sort((a, b) => b.createdAt - a.createdAt);
    return send(res, 200, { code: 0, data: list });
  }
  // 我的余额
  if (method === 'GET' && p === '/api/my/balance') {
    const uid = parsed.query.userId;
    const user = db.users.find((u) => u.id === uid);
    if (!user) return send(res, 404, { code: 1, msg: '用户不存在' });
    return send(res, 200, { code: 0, data: { balance: user.balance || 0 } });
  }

  /* ===== 管理后台接口（需 x-admin-key） ===== */
  if (p.startsWith('/api/admin/')) {
    if (!isAdmin(req)) return send(res, 401, { code: 1, msg: '无权限' });
    // 统计
    if (method === 'GET' && p === '/api/admin/stats') {
      const gm = db.products.reduce((s, x) => s + x.soldShares * x.pricePerShare, 0);
      const stats = {
        productCount: db.products.length,
        userCount: db.users.length,
        orderCount: db.orders.length,
        totalSharesSold: db.products.reduce((s, x) => s + x.soldShares, 0),
        grossAmount: +db.products.reduce((s, x) => s + x.soldShares * x.pricePerShare, 0).toFixed(2),
        drawnCount: db.draws.length,
        shippedCount: db.draws.filter((d) => d.shipped).length
      };
      return send(res, 200, { code: 0, data: stats });
    }
    // 订单列表
    if (method === 'GET' && p === '/api/admin/orders') {
      return send(res, 200, { code: 0, data: db.orders.slice().sort((a, b) => b.createdAt - a.createdAt) });
    }
    // 商品列表（后台完整视图）
    if (method === 'GET' && p === '/api/admin/products') {
      return send(res, 200, { code: 0, data: db.products.map(publicProduct).sort((a, b) => b.createdAt - a.createdAt) });
    }
    // 用户列表
    if (method === 'GET' && p === '/api/admin/users') {
      return send(res, 200, { code: 0, data: db.users });
    }
    // 中奖记录
    if (method === 'GET' && p === '/api/admin/winners') {
      return send(res, 200, { code: 0, data: db.draws.slice().sort((a, b) => b.drawnAt - a.drawnAt) });
    }
    // 新增商品
    if (method === 'POST' && p === '/api/admin/products') {
      const b = await readBody(req);
      if (!b.name || !b.totalAmount || !b.totalShares)
        return send(res, 400, { code: 1, msg: '名称/总金额/份数必填' });
      const totalAmount = +b.totalAmount, totalShares = parseInt(b.totalShares, 10);
      if (totalShares < 1) return send(res, 400, { code: 1, msg: '份数必须大于0' });
      db.seq.product = (db.seq.product || 0) + 1;
      const prod = {
        id: 'P' + db.seq.product, name: b.name, image: b.image || '🎁', detail: b.detail || '',
        totalAmount, totalShares,
        pricePerShare: core.pricePerShare(totalAmount, totalShares),
        soldShares: 0, onSale: !!b.onSale, winningCode: '', winningUserId: '', winningUserName: '',
        drawnAt: null, createdAt: Date.now()
      };
      db.products.push(prod); store.save(db);
      return send(res, 200, { code: 0, data: publicProduct(prod) });
    }
    // 编辑商品
    m = p.match(/^\/api\/admin\/products\/(\w+)$/);
    if (method === 'PUT' && m) {
      const prod = db.products.find((x) => x.id === m[1]);
      if (!prod) return send(res, 404, { code: 1, msg: '商品不存在' });
      const b = await readBody(req);
      if (b.name) prod.name = b.name;
      if (b.image) prod.image = b.image;
      if (b.detail !== undefined) prod.detail = b.detail;
      if (b.totalAmount && b.totalShares) {
        prod.totalAmount = +b.totalAmount; prod.totalShares = parseInt(b.totalShares, 10);
        prod.pricePerShare = core.pricePerShare(prod.totalAmount, prod.totalShares);
      } else {
        if (b.totalAmount) { prod.totalAmount = +b.totalAmount; prod.pricePerShare = core.pricePerShare(prod.totalAmount, prod.totalShares); }
        if (b.totalShares) { prod.totalShares = parseInt(b.totalShares, 10); prod.pricePerShare = core.pricePerShare(prod.totalAmount, prod.totalShares); }
      }
      store.save(db);
      return send(res, 200, { code: 0, data: publicProduct(prod) });
    }
    // 上架/下架
    m = p.match(/^\/api\/admin\/products\/(\w+)\/toggle$/);
    if (method === 'POST' && m) {
      const prod = db.products.find((x) => x.id === m[1]);
      if (!prod) return send(res, 404, { code: 1, msg: '商品不存在' });
      if (prod.winningCode) return send(res, 400, { code: 1, msg: '已开奖商品不可上下架' });
      prod.onSale = !prod.onSale; store.save(db);
      return send(res, 200, { code: 0, data: publicProduct(prod) });
    }
    // 手动触发开奖
    m = p.match(/^\/api\/admin\/products\/(\w+)\/draw$/);
    if (method === 'POST' && m) {
      const prod = db.products.find((x) => x.id === m[1]);
      if (!prod) return send(res, 404, { code: 1, msg: '商品不存在' });
      if (prod.soldShares < prod.totalShares) return send(res, 400, { code: 1, msg: '份数未售罄，无法开奖' });
      if (prod.winningCode) return send(res, 400, { code: 1, msg: '已开奖' });
      const draw = drawProduct(db, prod); store.save(db);
      return send(res, 200, { code: 0, data: draw });
    }
    // 录入物流
    m = p.match(/^\/api\/admin\/draws\/(\w+)\/ship$/);
    if (method === 'POST' && m) {
      const draw = db.draws.find((d) => d.id === m[1]);
      if (!draw) return send(res, 404, { code: 1, msg: '记录不存在' });
      const b = await readBody(req);
      draw.logistics = b.logistics || ''; draw.shipped = !!b.logistics;
      store.save(db);
      return send(res, 200, { code: 0, data: draw });
    }
    /* ---- 首页管理：轮播 ---- */
    if (p === '/api/admin/banners' && method === 'GET') {
      return send(res, 200, { code: 0, data: db.banners.slice().sort((a, b) => (a.sort || 0) - (b.sort || 0)) });
    }
    if (p === '/api/admin/banners' && method === 'POST') {
      const b = await readBody(req);
      if (!b.title) return send(res, 400, { code: 1, msg: '轮播标题必填' });
      db.seq.banner = (db.seq.banner || 0) + 1;
      const maxSort = db.banners.reduce((s, x) => Math.max(s, x.sort || 0), 0);
      const item = {
        id: 'B' + db.seq.banner,
        title: b.title, subtitle: b.subtitle || '', btnText: b.btnText || '',
        emoji: b.emoji || '🎁',
        bg: b.bg || 'linear-gradient(120deg,#ff6b6b,#ff9a44)',
        link: b.link || '/', sort: +b.sort || (maxSort + 1),
        enabled: b.enabled !== false, createdAt: Date.now()
      };
      db.banners.push(item); store.save(db);
      return send(res, 200, { code: 0, data: item });
    }
    m = p.match(/^\/api\/admin\/banners\/(\w+)$/);
    if (m) {
      const item = db.banners.find((x) => x.id === m[1]);
      if (!item) return send(res, 404, { code: 1, msg: '轮播不存在' });
      if (method === 'PUT') {
        const b = await readBody(req);
        ['title', 'subtitle', 'btnText', 'emoji', 'bg', 'link'].forEach((k) => { if (b[k] !== undefined) item[k] = b[k]; });
        if (b.sort !== undefined) item.sort = +b.sort;
        if (b.enabled !== undefined) item.enabled = !!b.enabled;
        store.save(db);
        return send(res, 200, { code: 0, data: item });
      }
      if (method === 'DELETE') {
        db.banners = db.banners.filter((x) => x.id !== m[1]);
        store.save(db);
        return send(res, 200, { code: 0, data: item });
      }
    }
    // 轮播排序（上移 / 下移）
    m = p.match(/^\/api\/admin\/banners\/(\w+)\/move$/);
    if (method === 'POST' && m) {
      const b = await readBody(req);
      const list = db.banners.slice().sort((a, c) => (a.sort || 0) - (c.sort || 0));
      const idx = list.findIndex((x) => x.id === m[1]);
      if (idx < 0) return send(res, 404, { code: 1, msg: '轮播不存在' });
      const swap = b.dir === 'up' ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= list.length) return send(res, 400, { code: 1, msg: '已到边界' });
      const t = list[idx].sort; list[idx].sort = list[swap].sort; list[swap].sort = t;
      store.save(db);
      return send(res, 200, { code: 0, data: list });
    }
    /* ---- 首页管理：设置 ---- */
    if (p === '/api/admin/settings') {
      if (method === 'GET') return send(res, 200, { code: 0, data: db.settings });
      if (method === 'PUT') {
        const b = await readBody(req);
        if (b.bannerInterval !== undefined) {
          const v = parseInt(b.bannerInterval, 10);
          db.settings.bannerInterval = (v >= 1000 && v <= 20000) ? v : 3500;
        }
        if (b.notice !== undefined) db.settings.notice = b.notice;
        if (b.noticeEnabled !== undefined) db.settings.noticeEnabled = !!b.noticeEnabled;
        store.save(db);
        return send(res, 200, { code: 0, data: db.settings });
      }
    }
    /* ---- 收款账户配置 ---- */
    if (p === '/api/admin/payees') {
      if (method === 'GET') return send(res, 200, { code: 0, data: db.payees });
      if (method === 'PUT') {
        const b = await readBody(req);
        ['wechat', 'alipay', 'bank'].forEach((k) => {
          if (b[k] && typeof b[k] === 'object') {
            const cur = db.payees[k];
            if (b[k].enabled !== undefined) cur.enabled = !!b[k].enabled;
            if (b[k].name !== undefined) cur.name = b[k].name;
            if (b[k].account !== undefined) cur.account = b[k].account;
            if (b[k].qr !== undefined) cur.qr = b[k].qr;
            if (b[k].bankName !== undefined) cur.bankName = b[k].bankName;
            if (b[k].holder !== undefined) cur.holder = b[k].holder;
          }
        });
        store.save(db);
        return send(res, 200, { code: 0, data: db.payees });
      }
    }
    // 收款码图片上传（直接上传图片，后台文件存储，返回可访问 URL）
    if (p === '/api/admin/payees/upload' && method === 'POST') {
      const type = req.headers['x-payee-type'];
      if (!['wechat', 'alipay', 'bank'].includes(type))
        return send(res, 400, { code: 1, msg: '收款类型错误' });
      let buf;
      try { buf = await readRaw(req); } catch (e) { return send(res, 400, { code: 1, msg: '读取文件失败' }); }
      if (!buf.length) return send(res, 400, { code: 1, msg: '未收到图片' });
      if (buf.length > 3 * 1024 * 1024) return send(res, 400, { code: 1, msg: '图片需小于 3MB' });
      const ext = extFromContentType(req.headers['content-type']);
      const dir = path.join(__dirname, 'uploads', 'payees');
      fs.mkdirSync(dir, { recursive: true });
      const fileName = type + ext;
      fs.writeFileSync(path.join(dir, fileName), buf);
      // 旧格式图片清理（避免 wechat.png / wechat.jpg 并存）
      ['png', 'jpg', 'jpeg', 'webp', 'gif'].forEach((e) => {
        if ('.' + e === ext) return;
        const old = path.join(dir, type + '.' + e);
        if (fs.existsSync(old)) { try { fs.unlinkSync(old); } catch (_) {} }
      });
      return send(res, 200, { code: 0, data: { url: '/uploads/payees/' + fileName } });
    }
    /* ---- 删除商品 ---- */
    m = p.match(/^\/api\/admin\/products\/(\w+)$/);
    if (method === 'DELETE' && m) {
      const i = db.products.findIndex((x) => x.id === m[1]);
      if (i < 0) return send(res, 404, { code: 1, msg: '商品不存在' });
      const cnt = db.orders.filter((o) => o.productId === m[1]).length;
      if (cnt > 0) return send(res, 400, { code: 1, msg: '该商品已有 ' + cnt + ' 笔订单，不可删除（可改为下架）' });
      const [gone] = db.products.splice(i, 1);
      db.draws = db.draws.filter((d) => d.productId !== m[1]);
      store.save(db);
      return send(res, 200, { code: 0, data: gone });
    }

    /* ---- 充值管理：统计 ---- */
    if (method === 'GET' && p === '/api/admin/recharge/stats') {
      const recharges = db.recharges;
      const paids = recharges.filter((r) => r.status === 'paid');
      const totalRecharge = +paids.reduce((s, r) => s + (r.gift || r.amount), 0).toFixed(2);
      const totalBonus = +paids.reduce((s, r) => s + (r.bonus || 0), 0).toFixed(2);
      const stats = {
        planCount: db.rechargePlans.length,
        enabledPlanCount: db.rechargePlans.filter((x) => x.enabled).length,
        rechargeOrderCount: recharges.length,
        pendingCount: recharges.filter((r) => r.status === 'pending').length,
        totalRecharge,           // 实际到账（含赠送，仅已确认）
        totalBonus,              // 赠送总额（仅已确认）
        memberCount: db.users.length,
        totalBalance: +db.users.reduce((s, u) => s + (u.balance || 0), 0).toFixed(2),
        billCount: db.bills.length
      };
      return send(res, 200, { code: 0, data: stats });
    }
    /* ---- 充值管理：套餐 ---- */
    if (p === '/api/admin/recharge/plans' && method === 'GET') {
      return send(res, 200, { code: 0, data: db.rechargePlans.slice().sort((a, b) => (a.sort || 0) - (b.sort || 0)) });
    }
    if (p === '/api/admin/recharge/plans' && method === 'POST') {
      const b = await readBody(req);
      if (!b.name || !b.amount) return send(res, 400, { code: 1, msg: '名称与充值金额必填' });
      db.seq.plan = (db.seq.plan || 0) + 1;
      const maxSort = db.rechargePlans.reduce((s, x) => Math.max(s, x.sort || 0), 0);
      const plan = {
        id: 'PL' + db.seq.plan, name: b.name, amount: +b.amount,
        bonus: +(b.bonus || 0), enabled: b.enabled !== false,
        sort: +b.sort || (maxSort + 1), createdAt: Date.now()
      };
      db.rechargePlans.push(plan); store.save(db);
      return send(res, 200, { code: 0, data: plan });
    }
    m = p.match(/^\/api\/admin\/recharge\/plans\/(\w+)$/);
    if (m && (method === 'PUT' || method === 'DELETE')) {
      const plan = db.rechargePlans.find((x) => x.id === m[1]);
      if (!plan) return send(res, 404, { code: 1, msg: '套餐不存在' });
      if (method === 'PUT') {
        const b = await readBody(req);
        if (b.name) plan.name = b.name;
        if (b.amount !== undefined) plan.amount = +b.amount;
        if (b.bonus !== undefined) plan.bonus = +(b.bonus || 0);
        if (b.sort !== undefined) plan.sort = +b.sort;
        if (b.enabled !== undefined) plan.enabled = !!b.enabled;
        store.save(db);
        return send(res, 200, { code: 0, data: plan });
      }
      db.rechargePlans = db.rechargePlans.filter((x) => x.id !== m[1]);
      store.save(db);
      return send(res, 200, { code: 0, data: plan });
    }
    m = p.match(/^\/api\/admin\/recharge\/plans\/(\w+)\/toggle$/);
    if (method === 'POST' && m) {
      const plan = db.rechargePlans.find((x) => x.id === m[1]);
      if (!plan) return send(res, 404, { code: 1, msg: '套餐不存在' });
      plan.enabled = !plan.enabled; store.save(db);
      return send(res, 200, { code: 0, data: plan });
    }
    /* ---- 充值管理：充值订单 ---- */
    if (p === '/api/admin/recharges' && method === 'GET') {
      const list = db.recharges.slice().sort((a, b) => b.createdAt - a.createdAt)
        .map((r) => Object.assign({}, r, { userPhone: (db.users.find((u) => u.id === r.userId) || {}).phone || '' }));
      return send(res, 200, { code: 0, data: list });
    }
    m = p.match(/^\/api\/admin\/recharges\/(\w+)\/confirm$/);
    if (method === 'POST' && m) {
      const rec = db.recharges.find((x) => x.id === m[1]);
      if (!rec) return send(res, 404, { code: 1, msg: '充值单不存在' });
      if (rec.status === 'paid') return send(res, 400, { code: 1, msg: '该笔已确认到账' });
      const user = db.users.find((u) => u.id === rec.userId);
      rec.status = 'paid'; rec.confirmedBy = 'admin'; rec.confirmedAt = Date.now();
      if (user) {
        const gift = +(rec.gift || rec.amount).toFixed(2);
        user.balance = +((user.balance || 0) + gift).toFixed(2);
        core.addBill(db, { userId: user.id, userName: user.name, type: 'recharge', amount: gift, direction: 'in', balance: user.balance, refId: rec.id, remark: '后台确认充值到账' });
      }
      store.save(db);
      return send(res, 200, { code: 0, data: rec });
    }
    /* ---- 充值管理：会员余额调整 ---- */
    m = p.match(/^\/api\/admin\/users\/(\w+)\/balance$/);
    if (method === 'POST' && m) {
      const user = db.users.find((u) => u.id === m[1]);
      if (!user) return send(res, 404, { code: 1, msg: '用户不存在' });
      const b = await readBody(req);
      const delta = +b.delta;
      if (!delta) return send(res, 400, { code: 1, msg: '调整金额无效' });
      const before = user.balance || 0;
      const after = +(before + delta).toFixed(2);
      if (after < 0) return send(res, 400, { code: 1, msg: '余额不能为负' });
      user.balance = after;
      core.addBill(db, { userId: user.id, userName: user.name, type: 'adjust', amount: Math.abs(delta), direction: delta > 0 ? 'in' : 'out', balance: user.balance, refId: '', remark: b.remark || (delta > 0 ? '后台充值' : '后台扣减') });
      store.save(db);
      return send(res, 200, { code: 0, data: { id: user.id, balance: user.balance } });
    }
    return send(res, 404, { code: 1, msg: '接口不存在' });
  }

  return send(res, 404, { code: 1, msg: '接口不存在' });
}

/* ---------------- 静态文件 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.gif': 'image/gif'
};
function serveStatic(req, res, parsed) {
  let p = decodeURIComponent(parsed.pathname);
  let baseDir;
  if (p === '/admin' || p === '/admin/') { p = '/admin/index.html'; }
  if (p.startsWith('/admin/')) baseDir = path.join(__dirname, 'admin');
  else if (p.startsWith('/uploads/')) baseDir = path.join(__dirname, 'uploads');
  else baseDir = path.join(__dirname, 'public');

  let rel;
  if (p.startsWith('/uploads/')) rel = p.replace(/^\/uploads\//, '');
  else rel = p.replace(/^\/admin\//, '');
  if (rel === '' || rel === 'admin') rel = 'index.html';
  // 防目录穿越
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(baseDir, safe);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // SPA 回退（仅 public / admin）
    if (baseDir === path.join(__dirname, 'public') || baseDir === path.join(__dirname, 'admin'))
      filePath = path.join(baseDir, 'index.html');
    else return sendText(res, 404, 'Not Found');
  }
  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (err, data) => {
    if (err) return sendText(res, 404, 'Not Found');
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

/* ---------------- 种子数据 ---------------- */
function init() {
  const db = store.load();
  let changed = store.ensureBanners(db);
  if (store.ensureRechargePlans(db)) changed = true;
  if (db.products.length > 0) {
    if (changed) store.save(db);
    return;
  }
  const samples = [
    { name: 'iPhone 16 抽奖', image: '📱', detail: '全新国行 iPhone 16 256G，公平抽奖，百分百必有一人中奖。', totalAmount: 5999, totalShares: 100, onSale: true },
    { name: 'AirPods Pro 抽奖', image: '🎧', detail: 'Apple AirPods Pro 2 主动降噪耳机，低门槛参与。', totalAmount: 1299, totalShares: 50, onSale: true },
    { name: '京东 E 卡 ¥500', image: '💳', detail: '500 元京东 E 卡，5 元一份，人人都能玩。', totalAmount: 500, totalShares: 100, onSale: true },
    { name: 'Switch 游戏机（预热）', image: '🎮', detail: '任天堂 Switch OLED，即将开售，敬请期待。', totalAmount: 2399, totalShares: 80, onSale: false }
  ];
  samples.forEach((s) => {
    db.seq.product = (db.seq.product || 0) + 1;
    db.products.push({
      id: 'P' + db.seq.product, name: s.name, image: s.image, detail: s.detail,
      totalAmount: s.totalAmount, totalShares: s.totalShares,
      pricePerShare: core.pricePerShare(s.totalAmount, s.totalShares),
      soldShares: 0, onSale: s.onSale, winningCode: '', winningUserId: '', winningUserName: '',
      drawnAt: null, createdAt: Date.now()
    });
  });
  store.save(db);
  console.log('[seed] 已注入示例商品');
}

/* ---------------- 启动 ---------------- */
// 上线性加固：单请求异常不应拖垮整个服务
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  if (parsed.pathname.startsWith('/api/')) {
    try { await handleApi(req, res, parsed); }
    catch (e) {
      console.error(e);
      send(res, e && e.status ? e.status : 500, { code: 1, msg: e && e.status ? e.message : '服务器错误' });
    }
    return;
  }
  serveStatic(req, res, parsed);
});

init();
server.listen(PORT, () => {
  console.log('🎉 幸运商城已启动：');
  console.log('   H5 首页:  http://localhost:' + PORT + '/');
  console.log('   管理后台: http://localhost:' + PORT + '/admin   (密码 admin888)');
});
