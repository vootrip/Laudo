-- ============================================================
-- Migração: biblioteca inicial de seções técnicas reutilizáveis
-- (templates globais, engineer_id NULL). O texto sobre muro de
-- alvenaria é adaptado do laudo real usado como gabarito do
-- produto — conteúdo técnico-educativo genérico, não específico
-- de nenhum caso, exatamente o tipo de seção que deve vir pronta
-- para o engenheiro só aplicar e ajustar.
-- ============================================================

INSERT INTO section_templates (engineer_id, report_type, section_title, default_content_text) VALUES

(NULL, 'muro', 'Muro Alvenaria',
'O muro é uma estrutura vertical que pode ser construído com tijolos assentados com argamassa, posicionada exatamente sobre a linha limite (divisa) entre dois terrenos privados ou públicos. Exige fundação geralmente com estacas (feita com trado) e vigas baldrame para evitar recalques e garantir estabilidade, dado que o esforço principal está na base. A estrutura é feita de pilares e vigas de amarração para garantir a estabilidade dos tijolos principalmente para alturas superiores a 1,80m. A impermeabilização da viga baldrame e das primeiras fiadas é crucial para evitar a subida de água por capilaridade do solo. Importante salientar que o muro de divisa é projetado apenas para resistir ao seu peso próprio, não sendo indicado para suportar impulso do solo.'),

(NULL, 'muro', 'Identificação da Divisa do Muro',
'O muro em questão faz parte da delimitação da propriedade particular junto ao imóvel vizinho, [descrever aqui a natureza do imóvel vizinho — residência, escola, propriedade pública/privada — e a localização específica do muro no terreno].'),

(NULL, 'trinca', 'Fissuras e Trincas em Alvenaria',
'Fissuras e trincas em alvenaria podem ter origem térmica, higroscópica (variação de umidade), estrutural (recalque de fundação) ou por sobrecarga. A classificação correta depende da orientação (horizontal, vertical, diagonal), abertura (capilar, fissura ou trinca), e do padrão de propagação observado. Fissuras superficiais de revestimento (reboco) tendem a não indicar comprometimento estrutural, ao contrário de trincas que atravessam a alvenaria estrutural, que exigem investigação aprofundada.'),

(NULL, 'infiltracao', 'Infiltração e Umidade',
'A infiltração de água em edificações pode ter origem em falhas de impermeabilização, capilaridade do solo, condensação ou vazamento em instalações hidráulicas. A identificação da origem correta é essencial antes de qualquer intervenção corretiva, já que tratamentos superficiais sem resolver a causa raiz tendem a mascarar o problema temporariamente e permitir seu retorno.'),

(NULL, 'geral', 'Metodologia de Análise',
'Para elaboração deste laudo foi utilizado registro fotográfico das condições do ambiente vistoriado, sendo base para a análise qualitativa da situação atual. A vistoria compreendeu a observação visual. [Ajustar aqui caso tenham sido realizadas análises laboratoriais, testes ou ensaios complementares.]');
