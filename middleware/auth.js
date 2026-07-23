const jwt = require("jsonwebtoken");

function requireAuth(req, res, next) {
  // Preferência: header Authorization (chamadas via fetch/api()). Fallback:
  // ?token= na query string — necessário para recursos carregados via
  // <img src>, <iframe src> ou abertos em nova aba (ex: foto do laudo, PDF
  // de pré-visualização), já que essas tags do navegador não conseguem
  // anexar um header de Authorization customizado.
  const authHeader = req.headers.authorization;
  let token = null;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: "Token de autenticação ausente." });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.engineerId = payload.engineerId;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token inválido ou expirado." });
  }
}

module.exports = { requireAuth };
