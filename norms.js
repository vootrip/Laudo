const express = require("express");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// GET /templates — lista templates padrão do sistema + próprios do escritório
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM report_templates
       WHERE engineer_id IS NULL OR engineer_id = $1
       ORDER BY name`,
      [req.engineerId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao listar templates." });
  }
});

module.exports = router;
