-- ============================================================
-- Schema MVP: Micro-SaaS de Geração de Laudos de Engenharia
-- Vertical inicial: Laudo de Vistoria
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------
-- Tenants: cada engenheiro/escritório é uma conta independente
-- ------------------------------------------------------------
CREATE TABLE engineers (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    crea_number     VARCHAR(50) NOT NULL,
    crea_region     VARCHAR(5)  NOT NULL,  -- ex: SP, RJ, MG
    company_name    VARCHAR(255),
    logo_url        TEXT,
    plan            VARCHAR(50) NOT NULL DEFAULT 'trial', -- trial|basico|pro
    stripe_customer_id  VARCHAR(100),
    asaas_customer_id   VARCHAR(100),
    subscription_status VARCHAR(50) DEFAULT 'trialing', -- trialing|active|past_due|canceled
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_engineers_email ON engineers(email);

-- ------------------------------------------------------------
-- Funcionários adicionais do mesmo escritório (multi-user por tenant)
-- ------------------------------------------------------------
CREATE TABLE engineer_team_members (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    engineer_id     UUID NOT NULL REFERENCES engineers(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    email           VARCHAR(255) NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    role            VARCHAR(50) NOT NULL DEFAULT 'member', -- owner|member
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(engineer_id, email)
);

-- ------------------------------------------------------------
-- Clientes do engenheiro (não confundir com tenant do SaaS)
-- ------------------------------------------------------------
CREATE TABLE clients (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    engineer_id     UUID NOT NULL REFERENCES engineers(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    document        VARCHAR(20),  -- CPF ou CNPJ
    phone           VARCHAR(20),
    email           VARCHAR(255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_clients_engineer ON clients(engineer_id);

-- ------------------------------------------------------------
-- Projetos: agrupador de laudos por obra/imóvel
-- ------------------------------------------------------------
CREATE TABLE projects (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    engineer_id     UUID NOT NULL REFERENCES engineers(id) ON DELETE CASCADE,
    client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
    address         TEXT NOT NULL,
    project_type    VARCHAR(50) NOT NULL, -- residencial|comercial|industrial
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_engineer ON projects(engineer_id);
CREATE INDEX idx_projects_client ON projects(client_id);

-- ------------------------------------------------------------
-- Templates de laudo (vistoria, ART, conclusão de obra...)
-- ------------------------------------------------------------
CREATE TABLE report_templates (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    engineer_id     UUID REFERENCES engineers(id) ON DELETE CASCADE, -- NULL = template padrão do sistema
    name            VARCHAR(255) NOT NULL,
    type            VARCHAR(50) NOT NULL, -- vistoria|art|conclusao_obra|laudo_estrutural
    structure_json  JSONB NOT NULL, -- define seções e campos do formulário
    default_norms   TEXT[],         -- ex: {'NBR 16280'}
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- Laudos (núcleo do produto)
-- ------------------------------------------------------------
CREATE TABLE reports (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    engineer_id         UUID NOT NULL REFERENCES engineers(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    template_id         UUID NOT NULL REFERENCES report_templates(id),
    title               VARCHAR(255) NOT NULL,
    raw_input_json      JSONB NOT NULL,           -- dados brutos preenchidos pelo engenheiro
    generated_content_json JSONB,                  -- texto estruturado gerado pela IA
    norm_references     TEXT[],                    -- normas citadas neste laudo específico
    status              VARCHAR(50) NOT NULL DEFAULT 'rascunho', -- rascunho|revisado|assinado
    pdf_url             TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    signed_at           TIMESTAMPTZ
);

CREATE INDEX idx_reports_engineer ON reports(engineer_id);
CREATE INDEX idx_reports_project ON reports(project_id);
CREATE INDEX idx_reports_status ON reports(status);

-- ------------------------------------------------------------
-- Fotos anexadas a um laudo
-- ------------------------------------------------------------
CREATE TABLE report_photos (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_id       UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    url             TEXT NOT NULL,
    caption         VARCHAR(255),
    display_order   INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_report_photos_report ON report_photos(report_id);

-- ------------------------------------------------------------
-- Assinaturas digitais (integração externa: Clicksign/D4Sign)
-- ------------------------------------------------------------
CREATE TABLE signatures (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_id           UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    provider            VARCHAR(50) NOT NULL, -- clicksign|d4sign|externo_manual
    provider_document_id VARCHAR(255), -- nulo quando provider = 'externo_manual'
    signature_status    VARCHAR(50) NOT NULL DEFAULT 'pendente', -- pendente|assinado|recusado
    signed_pdf_url      TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at        TIMESTAMPTZ
);

-- Nota sobre 'externo_manual': usado quando o engenheiro opta por assinar
-- o laudo fora do sistema (ex: PDF baixado e assinado via assinador.iti.br
-- com conta gov.br, gratuitamente) e depois faz upload do PDF já assinado
-- de volta. Não existe integração automática de API com serviços gov.br —
-- o catálogo oficial (Conecta gov.br) não oferece essa API para iniciativa
-- privada. Esse campo só registra que a assinatura veio de fora, mantendo
-- o arquivo final arquivado junto do laudo.

CREATE INDEX idx_signatures_report ON signatures(report_id);

-- ------------------------------------------------------------
-- Cobrança / assinatura SaaS
-- ------------------------------------------------------------
CREATE TABLE subscription_events (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    engineer_id     UUID NOT NULL REFERENCES engineers(id) ON DELETE CASCADE,
    gateway         VARCHAR(50) NOT NULL, -- stripe|asaas
    event_type      VARCHAR(100) NOT NULL, -- invoice.paid|invoice.failed|subscription.canceled
    payload_json    JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscription_events_engineer ON subscription_events(engineer_id);

-- ------------------------------------------------------------
-- Trigger simples de updated_at
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_engineers_updated_at
    BEFORE UPDATE ON engineers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_reports_updated_at
    BEFORE UPDATE ON reports
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
