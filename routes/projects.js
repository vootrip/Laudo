const express = require("express");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// GET /projects — lista os projetos do engenheiro autenticado, com nome do cliente
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, c.name AS client_name
       FROM projects p JOIN clients c ON c.id = p.client_id
       WHERE p.engineer_id = $1
       ORDER BY p.created_at DESC`,
      [req.engineerId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao listar projetos." });
  }
});

// POST /projects — cria um novo projeto vinculado a um cliente existente
router.post("/", async (req, res) => {
  const { client_id, address, project_type } = req.body;
  if (!client_id || !address || !project_type) {
    return res.status(400).json({ error: "client_id, address e project_type são obrigatórios." });
  }
  try {
    const result = await pool.query(
      `INSERT INTO projects (engineer_id, client_id, address, project_type)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.engineerId, client_id, address, project_type]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar projeto." });
  }
});

module.exports = router;
