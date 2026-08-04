const { Pool } = require("pg");
require("dotenv").config();

// Provedores como Render, Supabase e Neon exigem SSL para conexões externas.
// Em Postgres local (ex: 127.0.0.1) isso normalmente não é necessário nem
// suportado, então só ativamos quando a URL não aponta para localhost.
const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || "");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

pool.on("error", (err) => {
  console.error("Erro inesperado no pool do Postgres:", err);
});

module.exports = pool;
