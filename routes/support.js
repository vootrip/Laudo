const express = require("express");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// =================================================================
// LADO DO ENGENHEIRO — abrir e acompanhar seus próprios chamados
// =================================================================
router.use("/tickets", requireAuth);

// POST /support/tickets — abre um chamado. report_id e page_context
// são opcionais mas, quando vêm do botão de ajuda flutuante do app,
// já chegam preenchidos automaticamente (ver index.html).
router.post("/tickets", async (req, res) => {
  const { subject, message, report_id, page_context } = req.body;

  if (!subject || !message) {
    return res.status(400).json({ error: "subject e message são obrigatórios." });
  }

  try {
    // Se veio report_id, confirma que é mesmo um laudo do próprio
    // engenheiro (evita vazar contexto de outro tenant no ticket)
    let safeReportId = null;
    if (report_id) {
      const check = await pool.query(
        "SELECT id FROM reports WHERE id = $1 AND engineer_id = $2",
        [report_id, req.engineerId]
      );
      safeReportId = check.rows.length > 0 ? report_id : null;
    }

    const result = await pool.query(
      `INSERT INTO support_tickets (engineer_id, report_id, page_context, subject, message)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.engineerId, safeReportId, page_context || null, subject, message]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao abrir chamado." });
  }
});

// GET /support/tickets — histórico de chamados do próprio engenheiro
router.get("/tickets", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT st.*, r.title AS report_title
       FROM support_tickets st
       LEFT JOIN reports r ON r.id = st.report_id
       WHERE st.engineer_id = $1
       ORDER BY st.created_at DESC`,
      [req.engineerId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao listar chamados." });
  }
});

// =================================================================
// LADO ADMIN (você) — inbox simples pra responder, sem precisar de
// um sistema de login separado. Protegido por uma chave compartilhada
// (ADMIN_SECRET no .env), enviada no header x-admin-secret.
//
// Pragmático para fase solo-founder: se um dia tiver equipe de
// suporte, isso vira uma tabela de admins com login próprio — por
// ora, uma chave só sua já resolve.
// =================================================================
function requireAdminSecret(req, res, next) {
  const provided = req.headers["x-admin-secret"];
  if (!process.env.ADMIN_SECRET || provided !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: "Chave de admin ausente ou inválida." });
  }
  next();
}

// GET /support/admin/tickets?status=aberto — lista todos os chamados
// de todos os engenheiros, mais recentes primeiro
router.get("/admin/tickets", requireAdminSecret, async (req, res) => {
  const { status } = req.query;
  try {
    const params = [];
    let where = "";
    if (status) {
      params.push(status);
      where = `WHERE st.status = $${params.length}`;
    }
    const result = await pool.query(
      `SELECT st.*, e.name AS engineer_name, e.email AS engineer_email, r.title AS report_title
       FROM support_tickets st
       JOIN engineers e ON e.id = st.engineer_id
       LEFT JOIN reports r ON r.id = st.report_id
       ${where}
       ORDER BY (st.status = 'aberto') DESC, st.created_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao listar chamados." });
  }
});

// PATCH /support/admin/tickets/:id — responde e/ou muda o status
router.patch("/admin/tickets/:id", requireAdminSecret, async (req, res) => {
  const { admin_reply, status } = req.body;
  try {
    const result = await pool.query(
      `UPDATE support_tickets
       SET admin_reply = COALESCE($1, admin_reply),
           status = COALESCE($2, status),
           replied_at = CASE WHEN $1 IS NOT NULL THEN now() ELSE replied_at END,
           updated_at = now()
       WHERE id = $3
       RETURNING *`,
      [admin_reply || null, status || null, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Chamado não encontrado." });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao responder chamado." });
  }
});

module.exports = router;
