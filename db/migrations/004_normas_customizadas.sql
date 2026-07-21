-- ============================================================
-- Migração: normas customizadas por escritório + palavras-chave
-- para melhorar a seleção automática pela IA
-- ============================================================

ALTER TABLE technical_norms
    ADD COLUMN engineer_id UUID REFERENCES engineers(id) ON DELETE CASCADE,
        -- NULL = norma padrão do sistema (curada, visível para todos)
        -- preenchido = norma customizada, visível só para esse escritório
    ADD COLUMN keywords TEXT[] DEFAULT '{}';
        -- palavras-chave usadas para casar a norma com o texto da observação
        -- (além do item_category), melhorando a precisão da sugestão da IA

-- Sistema não deve permitir editar normas padrão (engineer_id IS NULL)
-- por engenheiros comuns — essa regra é aplicada na camada de aplicação
-- (rota da API), não no banco, para manter flexibilidade de um futuro
-- painel administrativo interno.

-- Preenchendo keywords nas normas padrão já existentes, para a busca
-- por palavra-chave funcionar desde já:
UPDATE technical_norms SET keywords = ARRAY['reforma', 'reboco', 'fissura', 'rachadura']
    WHERE code = 'NBR 16280';
UPDATE technical_norms SET keywords = ARRAY['manutenção', 'conservação', 'desgaste']
    WHERE code = 'NBR 5674';
UPDATE technical_norms SET keywords = ARRAY['desempenho', 'habitacional', 'acústico', 'térmico']
    WHERE code = 'NBR 15575';
UPDATE technical_norms SET keywords = ARRAY['perícia', 'pericial', 'cautelar']
    WHERE code = 'NBR 13752';
UPDATE technical_norms SET keywords = ARRAY['estrutural', 'concreto', 'viga', 'pilar', 'trinca']
    WHERE code = 'NBR 6118';
UPDATE technical_norms SET keywords = ARRAY['infiltração', 'umidade', 'impermeabilização', 'vazamento']
    WHERE code = 'NBR 9575';

CREATE INDEX idx_technical_norms_engineer ON technical_norms(engineer_id);
