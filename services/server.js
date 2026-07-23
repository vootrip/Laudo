require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const reportRoutes = require("./routes/reports");
const normRoutes = require("./routes/norms");
const billingRoutes = require("./routes/billing");
const publicRoutes = require("./routes/public");
const clientRoutes = require("./routes/clients");
const projectRoutes = require("./routes/projects");
const templateRoutes = require("./routes/templates");
const photoRoutes = require("./routes/photos");
const reportStructureRoutes = require("./routes/reportStructure");
const processRoutes = require("./routes/processes");
const sectionTemplateRoutes = require("./routes/sectionTemplates");
const signatureRoutes = require("./routes/signatures");
const supportRoutes = require("./routes/support");

const app = express();

app.use(cors());

// IMPORTANTE: a rota de webhook do Stripe precisa vir ANTES do
// express.json() global, porque ela exige o corpo bruto (raw body)
// para validar a assinatura do Stripe corretamente. Por isso ela é
// registrada separadamente aqui, antes do parser JSON padrão.
app.use("/billing", billingRoutes);

app.use(express.json({ limit: "2mb" }));
// Limite elevado de 2MB (padrão do Express é 100kb) porque agora o campo
// de observação pode receber o texto de um laudo inteiro colado, não só
// uma frase curta — um laudo de ~15 páginas ainda fica bem abaixo disso.

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.use("/auth", authRoutes);
app.use("/reports", reportRoutes);
app.use("/norms", normRoutes);
app.use("/public", publicRoutes);
app.use("/clients", clientRoutes);
app.use("/projects", projectRoutes);
app.use("/templates", templateRoutes);
app.use("/reports", photoRoutes);
app.use("/reports", reportStructureRoutes);
app.use("/processes", processRoutes);
app.use("/section-templates", sectionTemplateRoutes);
app.use("/reports", signatureRoutes);
app.use("/support", supportRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Erro interno do servidor." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
