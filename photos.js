const express = require("express");
const multer = require("multer");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// Limite de 2MB por foto — importante porque estamos guardando em base64
// direto no Postgres (ver nota abaixo). Isso mantém o uso de espaço do
// banco sob controle enquanto não migramos para um storage dedicado.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

router.post("/:id/photos", upload.array("photos", 10), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "Nenhuma foto enviada." });
  }

  try {
    const reportCheck = await pool.query(
      "SELECT id FROM reports WHERE id = $1 AND engineer_id = $2",
      [req.params.id, req.engineerId]
    );
    if (reportCheck.rows.length === 0) {
      return res.status(404).json({ error: "Laudo não encontrado." });
    }

    const captions = Array.isArray(req.body.captions) ? req.body.captions : [req.body.captions];
    const inserted = [];

    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const base64 = file.buffer.toString("base64");
      const dataUri = `data:${file.mimetype};base64,${base64}`;
      const caption = captions[i] || null;

      const result = await pool.query(
        `INSERT INTO report_photos (report_id, url, caption, display_order)
         VALUES ($1, $2, $3, (SELECT COALESCE(MAX(display_order), -1) + 1 FROM report_photos WHERE report_id = $1))
         RETURNING id, caption, display_order, created_at`,
        [req.params.id, dataUri, caption]
      );
      inserted.push(result.rows[0]);
    }

    res.status(201).json(inserted);
  } catch (err) {
    console.error(err);
    if (err.message && err.message.includes("File too large")) {
      return res.status(400).json({ error: "Cada foto deve ter no máximo 2MB." });
    }
    res.status(500).json({ error: "Erro ao enviar fotos." });
  }
});

router.get("/:id/photos", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT rp.id, rp.caption, rp.display_order, rp.created_at
       FROM report_photos rp
       JOIN reports r ON r.id = rp.report_id
       WHERE rp.report_id = $1 AND r.engineer_id = $2
       ORDER BY rp.display_order`,
      [req.params.id, req.engineerId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao listar fotos." });
  }
});

router.get("/:id/photos/:photoId", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT rp.url FROM report_photos rp
       JOIN reports r ON r.id = rp.report_id
       WHERE rp.id = $1 AND rp.report_id = $2 AND r.engineer_id = $3`,
      [req.params.photoId, req.params.id, req.engineerId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Foto não encontrada." });
    }

    const dataUri = result.rows[0].url;
    const [meta, base64] = dataUri.split(",");
    const mimeMatch = meta.match(/data:(.*);base64/);
    const mimetype = mimeMatch ? mimeMatch[1] : "image/jpeg";

    res.setHeader("Content-Type", mimetype);
    res.send(Buffer.from(base64, "base64"));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao carregar foto." });
  }
});

router.delete("/:id/photos/:photoId", async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM report_photos
       WHERE id = $1 AND report_id = $2
       AND report_id IN (SELECT id FROM reports WHERE engineer_id = $3)
       RETURNING id`,
      [req.params.photoId, req.params.id, req.engineerId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Foto não encontrada." });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao remover foto." });
  }
});

module.exports = router;
