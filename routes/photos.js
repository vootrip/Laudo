const express = require("express");
const multer = require("multer");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
const { assertEditable } = require("../middleware/reportGuards");
const { analyzePhotoWithAI } = require("../services/aiReportService");

const router = express.Router();
router.use(requireAuth);

// Limite de 2MB por foto — importante porque estamos guardando em base64
// direto no Postgres (ver nota abaixo). Isso mantém o uso de espaço do
// banco sob controle enquanto não migramos para um storage dedicado.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

/**
 * NOTA IMPORTANTE SOBRE ARMAZENAMENTO:
 * As fotos são convertidas para base64 e guardadas diretamente na coluna
 * `url` da tabela `report_photos` (como uma data URI). Isso funciona bem
 * para volume baixo de testes, mas não escala bem — o plano gratuito do
 * Neon tem só 0,5 GB de armazenamento total, e fotos em base64 ocupam
 * ~33% a mais de espaço que o arquivo original. Antes de ter uso real
 * com muitos clientes, migrar para um storage de objetos (S3, R2,
 * Supabase Storage) e guardar só a URL aqui é o próximo passo natural.
 */

// ---------------------------------------------------------------
// POST /reports/:id/photos — envia uma ou mais fotos para o laudo
// ---------------------------------------------------------------
router.post("/:id/photos", upload.array("photos", 10), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "Nenhuma foto enviada." });
  }

  try {
    // Confirma que o laudo pertence ao engenheiro autenticado E está
    // em status editável (fotos são conteúdo do laudo como qualquer outro)
    const reportCheck = await assertEditable(req, res, req.params.id);
    if (!reportCheck) return;

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

    await pool.query(
      `INSERT INTO report_events (report_id, event_type, event_label) VALUES ($1, 'fotos', $2)`,
      [req.params.id, `${inserted.length} foto(s) adicionada(s)`]
    );

    res.status(201).json(inserted);
  } catch (err) {
    console.error(err);
    if (err.message && err.message.includes("File too large")) {
      return res.status(400).json({ error: "Cada foto deve ter no máximo 2MB." });
    }
    res.status(500).json({ error: "Erro ao enviar fotos." });
  }
});

// ---------------------------------------------------------------
// GET /reports/:id/photos — lista as fotos do laudo (sem o base64
// completo na listagem, só metadados, para não pesar a resposta)
// ---------------------------------------------------------------
router.get("/:id/photos", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT rp.id, rp.caption, rp.display_order, rp.created_at,
              rp.ai_tags, rp.ai_suggested_caption, rp.ai_analyzed_at
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

// ---------------------------------------------------------------
// GET /reports/:id/photos/:photoId — retorna a imagem em si (para
// exibir como <img src="..."> no frontend)
// ---------------------------------------------------------------
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

// ---------------------------------------------------------------
// DELETE /reports/:id/photos/:photoId
// ---------------------------------------------------------------
router.delete("/:id/photos/:photoId", async (req, res) => {
  try {
    if (!(await assertEditable(req, res, req.params.id))) return;

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

// ---------------------------------------------------------------
// PATCH /reports/:id/photos/:photoId — edita a legenda (usado
// tanto manualmente quanto para aplicar a legenda sugerida pela IA)
// ---------------------------------------------------------------
router.patch("/:id/photos/:photoId", async (req, res) => {
  const { caption } = req.body;
  try {
    if (!(await assertEditable(req, res, req.params.id))) return;

    const result = await pool.query(
      `UPDATE report_photos
       SET caption = $1
       WHERE id = $2 AND report_id = $3
       AND report_id IN (SELECT id FROM reports WHERE engineer_id = $4)
       RETURNING id, caption`,
      [caption || null, req.params.photoId, req.params.id, req.engineerId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Foto não encontrada." });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao atualizar legenda." });
  }
});

// ---------------------------------------------------------------
// POST /reports/:id/photos/:photoId/analyze — análise sob demanda
// (clique do engenheiro, nunca automática): manda a foto pro Claude
// com visão, pede classificação de patologia visível e uma sugestão
// de legenda técnica — só com base no que é visualmente observável,
// sem inferir gravidade ou causa que a imagem sozinha não sustente.
// ---------------------------------------------------------------
router.post("/:id/photos/:photoId/analyze", async (req, res) => {
  try {
    const photoResult = await pool.query(
      `SELECT rp.url FROM report_photos rp
       JOIN reports r ON r.id = rp.report_id
       WHERE rp.id = $1 AND rp.report_id = $2 AND r.engineer_id = $3`,
      [req.params.photoId, req.params.id, req.engineerId]
    );
    if (photoResult.rows.length === 0) {
      return res.status(404).json({ error: "Foto não encontrada." });
    }

    const dataUri = photoResult.rows[0].url;
    const [meta, base64] = dataUri.split(",");
    const mimeMatch = meta.match(/data:(.*);base64/);
    const mediaType = mimeMatch ? mimeMatch[1] : "image/jpeg";

    const analysis = await analyzePhotoWithAI(base64, mediaType);

    const updated = await pool.query(
      `UPDATE report_photos
       SET ai_tags = $1, ai_suggested_caption = $2, ai_analyzed_at = now()
       WHERE id = $3
       RETURNING id, caption, ai_tags, ai_suggested_caption, ai_analyzed_at`,
      [analysis.tags, analysis.suggestedCaption, req.params.photoId]
    );

    res.json(updated.rows[0]);
  } catch (err) {
    console.error(err);
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    res.status(500).json({ error: "Erro ao analisar foto: " + err.message });
  }
});

module.exports = router;
