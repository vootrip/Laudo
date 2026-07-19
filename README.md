# Backend — MVP de laudos de engenharia

Backend em Node.js/Express que implementa o núcleo do produto: cadastro de
engenheiros, criação de laudos, geração de texto técnico via IA (Claude),
importação de documentos existentes, e preparação para assinatura digital.

## Por que isso não roda "ao vivo" aqui na conversa

Este código foi escrito e revisado, mas não foi executado neste ambiente —
o ambiente de chat não tem acesso à internet nem a um banco Postgres real.
Para rodar de verdade, você precisa de:

1. **Node.js 18+** instalado na sua máquina ou servidor.
2. **Um banco Postgres** — pode ser local, ou gratuito/pago em serviços como
   Supabase, Neon ou Railway.
3. **Uma chave de API da Anthropic** — crie em https://console.anthropic.com
   (isso é separado do seu acesso ao Claude.ai; é uma chave de uso pago por
   token, para o SEU produto chamar a IA).

## Passo a passo para rodar localmente

```bash
# 1. Instalar dependências
npm install

# 2. Configurar variáveis de ambiente
cp .env.example .env
# edite o .env preenchendo DATABASE_URL, JWT_SECRET e ANTHROPIC_API_KEY

# 3. Rodar as migrações (cria as tabelas e popula as normas técnicas)
npm run migrate

# 4. Iniciar o servidor
npm start
```

O servidor sobe em `http://localhost:3000` (ou na porta que você definir em `PORT`).

## Testando as rotas principais (exemplo com curl)

```bash
# Cadastrar um engenheiro
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Maria Silva","email":"maria@teste.com","password":"senha123","crea_number":"12345","crea_region":"SP"}'

# Login (retorna um token)
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"maria@teste.com","password":"senha123"}'

# Criar um laudo (troque SEU_TOKEN pelo token retornado no login)
# Nota: você precisa ter um project_id e template_id válidos já criados
# no banco (o MVP ainda não tem rota para criar projeto/cliente — ver
# "Próximos passos" abaixo).
curl -X POST http://localhost:3000/reports \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SEU_TOKEN" \
  -d '{"project_id":"...","template_id":"...","title":"Laudo de vistoria - Rua X"}'

# Gerar o texto técnico com IA
curl -X POST http://localhost:3000/reports/ID_DO_LAUDO/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SEU_TOKEN" \
  -d '{"observation":"parede da sala com rachadura de uns 20cm perto da janela","item_categories":["paredes"]}'
```

## O que já está implementado

- Cadastro e login de engenheiros (JWT)
- Criação de laudos em rascunho
- Geração de texto técnico via IA, com seleção de normas candidatas
- Edição/revisão manual do texto gerado
- Importação de documento existente (.docx/.pdf) com extração de texto
- Schema completo com histórico auditável (o que veio da IA vs. o que foi editado manualmente)

## O que ainda falta (próximos passos naturais)

- Rotas de CRUD para `clients` e `projects` (hoje só existem no banco, sem rota própria)
- Geração do PDF final do laudo (nenhuma lib de PDF foi conectada ainda)
- Integração real com D4Sign (o esqueleto está em `integracao_d4sign.js`, ainda não plugado nas rotas)
- Integração com Stripe/Asaas para cobrança recorrente da assinatura do SaaS
- Upload do documento original para um storage real (S3/R2) — hoje o texto é extraído mas o arquivo em si não é persistido
- Testes automatizados (nenhum teste foi escrito ainda)

## Sobre o modelo de IA usado

O código usa `claude-sonnet-4-6` como exemplo. Antes de rodar em produção,
vale conferir em https://docs.claude.com qual modelo tem a melhor relação
custo-benefício para essa tarefa — como discutimos antes, um modelo mais
leve provavelmente já é suficiente e mais barato para reformulação de texto.
