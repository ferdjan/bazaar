'use strict';

// Exige un utilisateur connecté.
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  req.session.returnTo = req.originalUrl;
  return res.redirect('/connexion');
}

// Exige un rôle admin.
function requireAdmin(req, res, next) {
  const user = req.session && req.session.user;
  if (!user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/connexion');
  }
  if (user.role !== 'admin') {
    return res.status(403).render('pages/403', { title: '403' });
  }
  return next();
}

module.exports = { requireAuth, requireAdmin };
