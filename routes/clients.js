const express = require("express");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// GET /clients — lista os clientes do engenheiro autenticado
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM clients WHERE engineer_id = $1 ORDER BY created_at DESC",
      [req.engineerId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao listar clientes." });
  }
});

// POST /clients — cria um novo cliente
router.post("/", async (req, res) => {
  const { name, document, phone, email } = req.body;
  if (!name) {
    return res.status(400).json({ error: "Campo 'name' é obrigatório." });
  }
  try {
    const result = await pool.query(
      `INSERT INTO clients (engineer_id, name, document, phone, email)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.engineerId, name, document || null, phone || null, email || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar cliente." });
  }
});

module.exports = router;
