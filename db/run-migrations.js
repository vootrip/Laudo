/**
 * Roda todos os arquivos .sql da pasta migrations, em ordem alfabética
 * (por isso os arquivos são numerados: 001_, 002_, 003_...).
 * Uso: npm run migrate
 */
const fs = require("fs");
const path = require("path");
const pool = require("./pool");

async function runMigrations() {
  const dir = path.join(__dirname, "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    console.log(`Rodando migração: ${file}`);
    try {
      await pool.query(sql);
      console.log(`  OK: ${file}`);
    } catch (err) {
      console.error(`  ERRO em ${file}:`, err.message);
      process.exit(1);
    }
  }

  console.log("Todas as migrações rodaram com sucesso.");
  await pool.end();
}

runMigrations();
