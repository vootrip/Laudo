const express = require("express");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// ---------------------------------------------------------------
// GET /dashboard/stats — indicadores básicos pro dashboard: total
// de laudos por status, tempo médio de criação até assinatura, e
// patologias mais frequentes (a partir das fotos já analisadas
// por IA — ver POST /reports/:id/photos/:photoId/analyze).
// ---------------------------------------------------------------
router.get("/stats", async (req, res) => {
  try {
    const [statusCounts, avgTurnaround, topPathologies, totalReports] = await Promise.all([
      pool.query(
        `SELECT status, COUNT(*)::int AS count
         FROM reports WHERE engineer_id = $1
         GROUP BY status`,
        [req.engineerId]
      ),
      pool.query(
        `SELECT AVG(EXTRACT(EPOCH FROM (signed_at - created_at)) / 86400.0) AS avg_days
         FROM reports
         WHERE engineer_id = $1 AND signed_at IS NOT NULL`,
        [req.engineerId]
      ),
      pool.query(
        `SELECT tag, COUNT(*)::int AS count
         FROM (
           SELECT unnest(rp.ai_tags) AS tag
           FROM report_photos rp
           JOIN reports r ON r.id = rp.report_id
           WHERE r.engineer_id = $1 AND rp.ai_tags IS NOT NULL
         ) tags
         GROUP BY tag
         ORDER BY count DESC
         LIMIT 5`,
        [req.engineerId]
      ),
      pool.query(`SELECT COUNT(*)::int AS count FROM reports WHERE engineer_id = $1`, [req.engineerId]),
    ]);

    const byStatus = {};
    statusCounts.rows.forEach((r) => { byStatus[r.status] = r.count; });

    res.json({
      total_reports: totalReports.rows[0].count,
      by_status: byStatus,
      avg_turnaround_days: avgTurnaround.rows[0].avg_days ? Math.round(avgTurnaround.rows[0].avg_days * 10) / 10 : null,
      top_pathologies: topPathologies.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao calcular indicadores." });
  }
});

module.exports = router;
