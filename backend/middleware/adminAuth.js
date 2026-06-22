function getAdminSecret() {
  return process.env.ADMIN_SECRET || "";
}

function getAdminPassword() {
  const secret = getAdminSecret();
  return process.env.ADMIN_PASSWORD || secret;
}

function verifyAdminPassword(password) {
  const secret = getAdminSecret();
  const expectedPassword = getAdminPassword();
  if (!secret || !expectedPassword) return false;
  return (
    typeof password === "string" &&
    password.length > 0 &&
    password === expectedPassword
  );
}

function requireAdmin(req, res, next) {
  const secret = getAdminSecret();
  if (!secret) {
    return res.status(503).json({ error: "Admin not configured" });
  }

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

module.exports = {
  getAdminSecret,
  verifyAdminPassword,
  requireAdmin,
};
