function ok(res, data, meta) {
  return res.status(200).json({ success: true, data, meta: meta || undefined });
}

function created(res, data) {
  return res.status(201).json({ success: true, data });
}

function fail(res, statusCode, message, details) {
  return res.status(statusCode).json({ success: false, message, details: details || undefined });
}

module.exports = { ok, created, fail };
