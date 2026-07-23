-- ============================================================
-- Migração: diagnóstico estruturado por IA, hash de verificação,
-- biblioteca de patologias, análise de foto por IA, timeline de
-- eventos, e seed de report_templates (faltava desde a 001 —
-- o formulário "novo laudo" está sem opções no <select> hoje).
-- ============================================================

-- ------------------------------------------------------------
-- 1) Diagnóstico técnico estruturado (não só texto corrido).
-- Preenchido pela IA em /reports/:id/generate, editável pelo
-- engenheiro na revisão como o resto do conteúdo.
-- ------------------------------------------------------------
ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS probable_cause TEXT,
    ADD COLUMN IF NOT EXISTS risk_level VARCHAR(20),
    ADD COLUMN IF NOT EXISTS recommended_deadline_days INTEGER,
    ADD COLUMN IF NOT EXISTS art_required BOOLEAN;

ALTER TABLE reports
    ADD CONSTRAINT chk_reports_risk_level
    CHECK (risk_level IS NULL OR risk_level IN ('baixo', 'medio', 'alto', 'critico'));

COMMENT ON COLUMN reports.probable_cause IS
    'Causa provável da manifestação patológica, sugerida pela IA a partir da observação — editável.';
COMMENT ON COLUMN reports.risk_level IS
    'baixo|medio|alto|critico — classificação de risco sugerida pela IA, editável pelo engenheiro.';

-- ------------------------------------------------------------
-- 2) Hash de verificação — congelado no momento da assinatura
-- (mesmo ponto onde o snapshot imutável em report_versions é
-- criado), impresso no rodapé/última página do PDF como código
-- de conferência. Sem QR nem página pública por enquanto — só
-- o código em texto já cobre a necessidade agora.
-- ------------------------------------------------------------
ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS verification_hash VARCHAR(64);

ALTER TABLE report_versions
    ADD COLUMN IF NOT EXISTS verification_hash VARCHAR(64);

COMMENT ON COLUMN report_versions.verification_hash IS
    'SHA-256 do snapshot_json desta versão — permite conferir depois que o conteúdo não foi alterado após a assinatura.';

-- ------------------------------------------------------------
-- 3) Biblioteca de patologias — mesmo padrão de technical_norms
-- (engineer_id NULL = global, curada pelo sistema; preenchido =
-- customizada por escritório). Consultada pela IA (via keywords,
-- igual já acontece com normas) e pela busca manual do engenheiro.
-- ------------------------------------------------------------
CREATE TABLE pathologies (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    engineer_id         UUID REFERENCES engineers(id) ON DELETE CASCADE,
    name                VARCHAR(255) NOT NULL,
    category            VARCHAR(100) NOT NULL, -- fissura|infiltracao|corrosao|revestimento|estrutural|umidade|geral
    description         TEXT NOT NULL,
    probable_causes     TEXT[] DEFAULT '{}',
    norms               TEXT[] DEFAULT '{}',   -- códigos de norma, ex: {'NBR 6118','NBR 15575'}
    default_risk_level  VARCHAR(20),
    inspection_methods  TEXT,
    repair_methods      TEXT,
    keywords            TEXT[] DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pathologies_engineer ON pathologies(engineer_id);
CREATE INDEX idx_pathologies_category ON pathologies(category);

INSERT INTO pathologies (name, category, description, probable_causes, norms, default_risk_level, inspection_methods, repair_methods, keywords) VALUES

('Fissura por recalque diferencial', 'fissura',
 'Fissura diagonal, geralmente mais aberta em uma extremidade, associada a movimentação desigual da fundação.',
 ARRAY['Recalque diferencial de fundação', 'Solo com capacidade de suporte heterogênea', 'Sobrecarga não prevista em projeto'],
 ARRAY['NBR 6118', 'NBR 6122', 'NBR 13752'],
 'medio',
 'Inspeção visual, nível óptico/laser, fissurômetro para monitoramento de abertura ao longo do tempo.',
 'Monitoramento periódico da abertura; se progressiva, investigação geotécnica e reforço de fundação.',
 ARRAY['fissura diagonal', 'recalque', 'trinca diagonal']),

('Fissura por retração de argamassa', 'fissura',
 'Fissuras mapeadas (padrão de mapa) ou horizontais finas em reboco/revestimento, sem comprometimento estrutural.',
 ARRAY['Retração natural da argamassa na cura', 'Traço inadequado', 'Ausência de tela de reforço em interface de materiais diferentes'],
 ARRAY['NBR 13749', 'NBR 15575'],
 'baixo',
 'Inspeção visual da superfície do revestimento.',
 'Regularização da superfície, aplicação de tela de reforço se recorrente, repintura.',
 ARRAY['fissura mapeada', 'fissura superficial', 'reboco']),

('Trinca estrutural', 'estrutural',
 'Abertura maior que fissura (>0,5mm), atravessando a espessura da alvenaria/elemento estrutural.',
 ARRAY['Sobrecarga estrutural', 'Falha de dimensionamento', 'Deterioração de armadura', 'Recalque severo de fundação'],
 ARRAY['NBR 6118', 'NBR 8681'],
 'alto',
 'Inspeção visual, fissurômetro, pode exigir ensaio de esclerometria ou extração de testemunho.',
 'Avaliação estrutural complementar obrigatória antes de qualquer intervenção; pode exigir escoramento.',
 ARRAY['trinca estrutural', 'trinca profunda']),

('Infiltração por falha de impermeabilização', 'infiltracao',
 'Manchas de umidade, bolhas ou descolamento de pintura associadas a entrada de água por laje, terraço ou área molhada.',
 ARRAY['Manta/impermeabilização deteriorada ou ausente', 'Ralo entupido ou mal dimensionado', 'Fissura em laje permitindo passagem de água'],
 ARRAY['NBR 9575', 'NBR 9574'],
 'medio',
 'Inspeção visual, teste de estanqueidade (lâmina d''água), termografia se disponível.',
 'Remoção do revestimento afetado, reimpermeabilização completa da área, revisão do sistema de drenagem.',
 ARRAY['infiltração', 'mancha de umidade', 'goteira']),

('Umidade ascendente por capilaridade', 'umidade',
 'Umidade e eflorescência na base de paredes, geralmente até ~1m de altura, mais intensa em períodos chuvosos.',
 ARRAY['Ausência ou falha de impermeabilização da base/baldrame', 'Contato direto de alvenaria com solo úmido', 'Ausência de barreira capilar'],
 ARRAY['NBR 9575'],
 'baixo',
 'Inspeção visual, medição de umidade com higrômetro de contato.',
 'Execução de barreira química ou física contra umidade ascendente, revisão de impermeabilização da base.',
 ARRAY['umidade ascendente', 'capilaridade', 'eflorescência']),

('Corrosão de armadura com destacamento de cobrimento', 'corrosao',
 'Manchas de oxidação (ferrugem) na superfície do concreto, com fissuras ao longo da armadura e/ou destacamento do cobrimento.',
 ARRAY['Carbonatação do concreto', 'Cobrimento de armadura insuficiente', 'Exposição a cloretos (ambiente marinho)', 'Fissuração prévia permitindo entrada de umidade'],
 ARRAY['NBR 6118', 'NBR 12655'],
 'alto',
 'Inspeção visual, pacometria para localizar armadura, ensaio de carbonatação (fenolftaleína), potencial de corrosão.',
 'Remoção do concreto deteriorado, tratamento/passivação da armadura, reconstituição do cobrimento com argamassa polimérica.',
 ARRAY['corrosão', 'armadura exposta', 'ferrugem', 'destacamento']),

('Mofo e bolor por umidade/ventilação insuficiente', 'umidade',
 'Manchas escuras/esverdeadas em paredes e tetos, geralmente em ambientes com ventilação reduzida.',
 ARRAY['Ventilação insuficiente', 'Condensação por diferença de temperatura', 'Infiltração associada'],
 ARRAY['NBR 15575'],
 'baixo',
 'Inspeção visual, verificação de ventilação do ambiente, medição de umidade relativa do ar.',
 'Melhoria de ventilação, tratamento fungicida da superfície, eliminação da fonte de umidade se houver.',
 ARRAY['mofo', 'bolor', 'fungo']),

('Descolamento/destacamento de revestimento cerâmico', 'revestimento',
 'Perda de aderência de placas cerâmicas, som cavo ao percutir, podendo culminar em queda de peças.',
 ARRAY['Argamassa colante inadequada ou vencida', 'Ausência de junta de dilatação', 'Movimentação térmica da fachada', 'Base mal preparada'],
 ARRAY['NBR 13755', 'NBR 13754'],
 'medio',
 'Percussão (som cavo), inspeção visual de juntas de dilatação.',
 'Remoção das placas soltas, reexecução do assentamento com juntas de dilatação adequadas.',
 ARRAY['descolamento', 'destacamento', 'cerâmica solta', 'piso solto']);

-- ------------------------------------------------------------
-- 4) Análise de foto por IA (sob demanda, clique do engenheiro
-- — não é automática no upload).
-- ------------------------------------------------------------
ALTER TABLE report_photos
    ADD COLUMN IF NOT EXISTS ai_tags TEXT[],
    ADD COLUMN IF NOT EXISTS ai_suggested_caption TEXT,
    ADD COLUMN IF NOT EXISTS ai_analyzed_at TIMESTAMPTZ;

-- ------------------------------------------------------------
-- 5) Timeline de eventos do laudo (dashboard/histórico básico).
-- ------------------------------------------------------------
CREATE TABLE report_events (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_id       UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    event_type      VARCHAR(50) NOT NULL, -- criado|fotos|ia_gerado|revisao|assinado|entregue
    event_label     VARCHAR(255) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_report_events_report ON report_events(report_id, created_at);

-- Popula um evento "criado" pra todo laudo já existente, pra timeline
-- não aparecer vazia em laudos anteriores a essa migração.
INSERT INTO report_events (report_id, event_type, event_label, created_at)
SELECT id, 'criado', 'Laudo criado', created_at FROM reports;

-- ------------------------------------------------------------
-- 6) Seed de report_templates — ausente desde a migração 001.
-- O <select> de "novo laudo" no frontend depende de GET /templates
-- retornar pelo menos uma opção; hoje está vazio em produção.
-- type casa com section_templates.report_type (migração 006/008).
-- ------------------------------------------------------------
INSERT INTO report_templates (engineer_id, name, type, structure_json, default_norms) VALUES
(NULL, 'Vistoria Geral', 'geral', '{"sections": ["identificacao", "objetivo", "localizacao", "metodologia", "inspecao", "conclusao"]}', ARRAY['NBR 16280']),
(NULL, 'Muro / Contenção', 'muro', '{"sections": ["identificacao", "objetivo", "localizacao", "metodologia", "muro_alvenaria", "causas", "medidas_corretivas", "conclusao"]}', ARRAY['NBR 6122', 'NBR 11682']),
(NULL, 'Fissuras e Trincas', 'trinca', '{"sections": ["identificacao", "objetivo", "localizacao", "metodologia", "classificacao_fissuras", "causas", "conclusao"]}', ARRAY['NBR 6118', 'NBR 13752']),
(NULL, 'Infiltração e Umidade', 'infiltracao', '{"sections": ["identificacao", "objetivo", "localizacao", "metodologia", "origem_infiltracao", "conclusao"]}', ARRAY['NBR 9575', 'NBR 9574']);
