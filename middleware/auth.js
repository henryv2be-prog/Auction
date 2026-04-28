function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  return next();
}

function requireRole(role) {
  return function roleGuard(req, res, next) {
    if (!req.session.user) {
      return res.redirect("/login");
    }

    if (req.session.user.role !== role) {
      return res.status(403).render("error", {
        title: "Forbidden",
        message: "You do not have permission to access this page.",
        user: req.session.user
      });
    }

    return next();
  };
}

module.exports = {
  requireAuth,
  requireRole
};
