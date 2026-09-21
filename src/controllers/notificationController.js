const { ok } = require('../utils/response');
const notificationService = require('../services/notificationService');

const typeFor = (authType) => (authType === 'marchand' ? 'marchand' : 'client');

async function list(req, res, next) {
  try {
    const items = await notificationService.listForUser(req.auth.id, typeFor(req.auth.type), {
      limit: req.query.limit ? Number(req.query.limit) : 50,
      offset: req.query.offset ? Number(req.query.offset) : 0,
    });
    ok(res, items);
  } catch (e) {
    next(e);
  }
}

async function markRead(req, res, next) {
  try {
    await notificationService.markRead(req.params.id, req.auth.id);
    ok(res, { updated: true });
  } catch (e) {
    next(e);
  }
}

async function markAllRead(req, res, next) {
  try {
    await notificationService.markAllRead(req.auth.id, typeFor(req.auth.type));
    ok(res, { updated: true });
  } catch (e) {
    next(e);
  }
}

module.exports = { list, markRead, markAllRead };
