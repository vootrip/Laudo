const express = require("express");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// ---------------------------------------------------------------
// GET /norms — lista normas do sistema (padrão) + normas próprias
// do escritório do engenheiro autenticado
// ---------------------------------------------------------------
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, code, title, scope_summary, applies_to, status,
              keywords, engineer_id, official_source_url
       FROM technical_norms
       WHERE engineer_id IS NULL OR engineer_id = $1
       ORDER BY (engineer_id IS NULL) DESC, code`,
      [req.engineerId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao listar normas." });
  }
});

// ---------------------------------------------------------------
// POST /norms — cadastra uma norma customizada do próprio escritório
// (nunca cria norma do sistema — engineer_id sempre é o do usuário logado)
// ---------------------------------------------------------------
router.post("/", async (req, res) => {
  const { code, title, scope_summary, applies_to, keywords } = req.body;

  if (!code || !title || !scope_summary || !applies_to) {
    return res.status(400).json({ error: "code, title, scope_summary e applies_to são obrigatórios." });
  }

  try {
    const result = await pool.query(
      `INSERT INTO technical_norms (code, title, scope_summary, applies_to, keywords, engineer_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'vigente')
       RETURNING *`,
      [code, title, scope_summary, applies_to, keywords || [], req.engineerId]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Já existe uma norma com esse código." });
    }
    console.error(err);
    res.status(500).json({ error: "Erro ao cadastrar norma." });
  }
});

// ---------------------------------------------------------------
// PATCH /norms/:id — edita uma norma PRÓPRIA do escritório.
// Normas padrão do sistema (engineer_id IS NULL) nunca podem ser
// editadas por aqui — isso é intencional: a curadoria do catálogo
// padrão é responsabilidade do time do produto, não do engenheiro
// individual, para manter consistência entre todos os clientes.
// ---------------------------------------------------------------
router.patch("/:id", async (req, res) => {
  const { title, scope_summary, applies_to, keywords, status } = req.body;

  try {
    const result = await pool.query(
      `UPDATE technical_norms
       SET title = COALESCE($1, title),
           scope_summary = COALESCE($2, scope_summary),
           applies_to = COALESCE($3, applies_to),
           keywords = COALESCE($4, keywords),
           status = COALESCE($5, status)
       WHERE id = $6 AND engineer_id = $7
       RETURNING *`,
      [title, scope_summary, applies_to, keywords, status, req.params.id, req.engineerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Norma não encontrada, ou é uma norma padrão do sistema (não editável).",
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao editar norma." });
  }
});

// ---------------------------------------------------------------
// DELETE /norms/:id — remove uma norma PRÓPRIA do escritório
// (mesma proteção: nunca remove norma padrão do sistema)
// ---------------------------------------------------------------
router.delete("/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM technical_norms WHERE id = $1 AND engineer_id = $2 RETURNING id`,
      [req.params.id, req.engineerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Norma não encontrada, ou é uma norma padrão do sistema (não removível).",
      });
    }

    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao remover norma." });
  }
});

module.exports = router;
