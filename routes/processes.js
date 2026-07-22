const express = require("express");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// GET /processes — lista processos do engenheiro autenticado
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, c.name AS client_name,
              (SELECT COUNT(*) FROM reports r WHERE r.process_id = p.id) AS report_count
       FROM processes p
       JOIN clients c ON c.id = p.client_id
       WHERE p.engineer_id = $1
       ORDER BY p.created_at DESC`,
      [req.engineerId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao listar processos." });
  }
});

// POST /processes
router.post("/", async (req, res) => {
  const { client_id, process_reference, description } = req.body;
  if (!client_id) {
    return res.status(400).json({ error: "client_id é obrigatório." });
  }
  try {
    const result = await pool.query(
      `INSERT INTO processes (engineer_id, client_id, process_reference, description)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.engineerId, client_id, process_reference || null, description || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar processo." });
  }
});

// GET /processes/:id — detalhe + laudos vinculados (útil para
// retomar contexto quando o mesmo caso volta meses depois)
router.get("/:id", async (req, res) => {
  try {
    const processResult = await pool.query(
      `SELECT p.*, c.name AS client_name
       FROM processes p JOIN clients c ON c.id = p.client_id
       WHERE p.id = $1 AND p.engineer_id = $2`,
      [req.params.id, req.engineerId]
    );
    if (processResult.rows.length === 0) {
      return res.status(404).json({ error: "Processo não encontrado." });
    }

    const reportsResult = await pool.query(
      `SELECT id, title, status, created_at, signed_at
       FROM reports WHERE process_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );

    res.json({ ...processResult.rows[0], reports: reportsResult.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar processo." });
  }
});

// PATCH /processes/:id
router.patch("/:id", async (req, res) => {
  const { process_reference, description } = req.body;
  try {
    const result = await pool.query(
      `UPDATE processes
       SET process_reference = COALESCE($1, process_reference),
           description = COALESCE($2, description),
           updated_at = now()
       WHERE id = $3 AND engineer_id = $4
       RETURNING *`,
      [process_reference, description, req.params.id, req.engineerId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Processo não encontrado." });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao editar processo." });
  }
});

// DELETE /processes/:id — laudos vinculados não são apagados
// (process_id fica NULL neles, ON DELETE SET NULL no schema)
router.delete("/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM processes WHERE id = $1 AND engineer_id = $2 RETURNING id`,
      [req.params.id, req.engineerId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Processo não encontrado." });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao remover processo." });
  }
});

module.exports = router;
