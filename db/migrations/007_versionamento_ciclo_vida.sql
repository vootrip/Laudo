-- ============================================================
-- Migração: versionamento e ciclo de vida completo do laudo
--
-- Cobre a seção 2 da especificação:
--   2.1 Status expandido (rascunho → em_revisao → assinado →
--       entregue → complementado/retificado)
--   2.2 Versionamento com snapshot imutável a cada assinatura
--   2.3 Processo/Caso como entidade acima do laudo
--
-- Regra central: um laudo com status 'assinado' ou 'entregue'
-- NUNCA é editado diretamente pelas rotas de conteúdo (isso é
-- garantido na camada de aplicação — ver helper assertEditable
-- em routes/reportStructure.js e routes/reports.js). Para
-- corrigir, o engenheiro precisa "destravar para revisão"
-- explicitamente (volta para em_revisao) e assinar de novo, o
-- que gera uma nova linha em report_versions preservando a
-- anterior intacta.
-- ============================================================

-- ------------------------------------------------------------
-- Correção de bug pré-existente: routes/reports.js já lê/grava
-- as colunas art_number e technical_opinion_json desde os fluxos
-- de criação, geração por IA e importação de documento — mas
-- nenhuma migração anterior chegou a criá-las. Isso quebra esses
-- fluxos em produção com "column does not exist". Corrigindo
-- aqui porque o versionamento depende de conseguir ler essas
-- colunas no snapshot.
-- ------------------------------------------------------------
ALTER TABLE reports
    ADD COLUMN art_number VARCHAR(50),
    ADD COLUMN technical_opinion_json JSONB;

-- ------------------------------------------------------------
-- 2.3 Processo/Caso — agrupador de laudos recorrentes do mesmo
-- cliente/caso (ex: processo judicial, sinistro de seguradora)
-- ------------------------------------------------------------
CREATE TABLE processes (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    engineer_id          UUID NOT NULL REFERENCES engineers(id) ON DELETE CASCADE,
    client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
    process_reference      VARCHAR(100),  -- número de processo judicial, se houver
    description            TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_processes_engineer ON processes(engineer_id);
CREATE INDEX idx_processes_client ON processes(client_id);

CREATE TRIGGER trg_processes_updated_at
    BEFORE UPDATE ON processes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE reports
    ADD COLUMN process_id UUID REFERENCES processes(id) ON DELETE SET NULL;
    -- opcional: nem todo laudo pertence a um processo formal

CREATE INDEX idx_reports_process ON reports(process_id);

-- ------------------------------------------------------------
-- 2.2 Versionamento — snapshot completo e imutável do laudo no
-- momento de cada assinatura. version_number 1 = primeira
-- assinatura; 2, 3... = retificações/complementações posteriores.
-- ------------------------------------------------------------
CREATE TABLE report_versions (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_id            UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    version_number         INTEGER NOT NULL,
    snapshot_json           JSONB NOT NULL,   -- cópia completa: campos do laudo + seções + subseções + normas + custos
    change_summary           TEXT,            -- obrigatório na app a partir da versão 2 em diante
    signed_pdf_url             TEXT,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(report_id, version_number)
);

CREATE INDEX idx_report_versions_report ON report_versions(report_id);

ALTER TABLE reports
    ADD COLUMN current_version_id UUID REFERENCES report_versions(id);
    -- nulo até a primeira assinatura; aponta sempre para a versão vigente

-- ------------------------------------------------------------
-- 2.1 Status expandido. Valores aceitos agora:
--   rascunho | em_revisao | assinado | entregue | complementado | retificado
-- Migra os laudos existentes: 'revisado' (valor legado usado até
-- aqui pelo fluxo PATCH /review) passa a significar 'em_revisao',
-- que é semanticamente o mesmo passo do ciclo de vida.
-- ------------------------------------------------------------
UPDATE reports SET status = 'em_revisao' WHERE status = 'revisado';

ALTER TABLE reports
    ADD CONSTRAINT chk_reports_status CHECK (
        status IN ('rascunho', 'em_revisao', 'assinado', 'entregue', 'complementado', 'retificado')
    );

COMMENT ON COLUMN reports.status IS
    'Ciclo de vida: rascunho -> em_revisao -> assinado -> entregue -> (opcional) complementado/retificado. '
    'Conteúdo só é editável em rascunho ou em_revisao — ver assertEditable() na camada de aplicação.';

COMMENT ON COLUMN reports.current_version_id IS
    'Aponta para a versão vigente em report_versions. Só é preenchido a partir da primeira assinatura.';
