const express = require("express");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// ---------------------------------------------------------------
// GET /pathologies?q=fissura — busca por nome, categoria ou
// palavra-chave (globais + customizadas do escritório)
// ---------------------------------------------------------------
router.get("/", async (req, res) => {
  const { q, category } = req.query;
  try {
    const conditions = ["(engineer_id IS NULL OR engineer_id = $1)"];
    const params = [req.engineerId];

    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      conditions.push(
        `(LOWER(name) LIKE $${params.length} OR LOWER(description) LIKE $${params.length} OR EXISTS (SELECT 1 FROM unnest(keywords) k WHERE LOWER(k) LIKE $${params.length}))`
      );
    }
    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }

    const result = await pool.query(
      `SELECT id, engineer_id, name, category, description, probable_causes, norms,
              default_risk_level, inspection_methods, repair_methods
       FROM pathologies
       WHERE ${conditions.join(" AND ")}
       ORDER BY (engineer_id IS NULL) DESC, name`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar patologias." });
  }
});

// ---------------------------------------------------------------
// GET /pathologies/categories — lista de categorias existentes,
// pra popular um filtro no frontend sem hardcode
// ---------------------------------------------------------------
router.get("/categories", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT category FROM pathologies
       WHERE engineer_id IS NULL OR engineer_id = $1
       ORDER BY category`,
      [req.engineerId]
    );
    res.json(result.rows.map((r) => r.category));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao listar categorias." });
  }
});

// ---------------------------------------------------------------
// POST /pathologies — cria uma patologia customizada do escritório
// ---------------------------------------------------------------
router.post("/", async (req, res) => {
  const { name, category, description, probable_causes, norms, default_risk_level, inspection_methods, repair_methods, keywords } = req.body;

  if (!name || !category || !description) {
    return res.status(400).json({ error: "name, category e description são obrigatórios." });
  }

  try {
    const result = await pool.query(
      `INSERT INTO pathologies
         (engineer_id, name, category, description, probable_causes, norms, default_risk_level, inspection_methods, repair_methods, keywords)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        req.engineerId,
        name,
        category,
        description,
        probable_causes || [],
        norms || [],
        default_risk_level || null,
        inspection_methods || null,
        repair_methods || null,
        keywords || [],
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar patologia." });
  }
});

module.exports = router;
