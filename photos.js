const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db/pool");

const router = express.Router();

// ---------------------------------------------------------------
// POST /auth/register — cadastro de um novo engenheiro (tenant)
// ---------------------------------------------------------------
router.post("/register", async (req, res) => {
  const { name, email, password, crea_number, crea_region, company_name } = req.body;

  if (!name || !email || !password || !crea_number || !crea_region) {
    return res.status(400).json({ error: "Campos obrigatórios ausentes." });
  }

  try {
    const existing = await pool.query("SELECT id FROM engineers WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "E-mail já cadastrado." });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO engineers (name, email, password_hash, crea_number, crea_region, company_name)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, email, plan`,
      [name, email, passwordHash, crea_number, crea_region, company_name || null]
    );

    const engineer = result.rows[0];
    const token = jwt.sign({ engineerId: engineer.id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.status(201).json({ engineer, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar conta." });
  }
});

// ---------------------------------------------------------------
// POST /auth/login
// ---------------------------------------------------------------
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query("SELECT * FROM engineers WHERE email = $1", [email]);
    const engineer = result.rows[0];

    if (!engineer) {
      return res.status(401).json({ error: "E-mail ou senha inválidos." });
    }

    const validPassword = await bcrypt.compare(password, engineer.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: "E-mail ou senha inválidos." });
    }

    const token = jwt.sign({ engineerId: engineer.id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.json({
      engineer: { id: engineer.id, name: engineer.name, email: engineer.email, plan: engineer.plan },
      token,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao fazer login." });
  }
});

module.exports = router;
