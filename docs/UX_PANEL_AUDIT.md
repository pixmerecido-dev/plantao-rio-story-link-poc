# Revisão do painel para operação jornalística

## Inventário e destino das funções

| Antes | Agora | Categoria | Acesso |
| --- | --- | --- | --- |
| Dashboard | Visão geral: próximos, publicados, alertas e métricas reais | A editorial | Operador/Administrador |
| RSS/Feed | Novas matérias: preview local, título, enviar, ignorar, abrir | A editorial | Ambos |
| Configuração RSS | Configurações: habilitado, intervalo, auto-enfileirar | B administrativa | Administrador |
| Fila | Fila de Stories: horário, conta, estado e ações | A editorial | Ambos |
| Criação manual/detalhes internos do job | Ferramentas da fila, detalhes técnicos | B/C | Administrador |
| Automação/calendário | Agenda: programação e preferências legíveis | A/B | Consulta por ambos; configuração pelo administrador |
| Políticas/limites avançados | Ferramentas da agenda | B | Administrador |
| Contas | Conta esperada, observada, resultado e data | A/B | Consulta/verificação por ambos; cadastro pelo administrador |
| Publicações | Publicados: busca, paginação, imagem, conta e data | A | Ambos |
| Configuração do Story | Texto do link, estilo, tamanho, posição e restaurar padrão | A | Ambos |
| Limites/destinos/diagnóstico do preview | Seções administrativas da configuração | B/C | Administrador |
| Erros/eventos misturados | Alertas editoriais; Logs técnicos separados | A/C | Alertas por ambos; logs pelo administrador |
| Sistema/Appium/ADB | Sistema e diagnósticos avançados | C técnica | Administrador |

Nenhuma função de backend foi removida. Publicar agora continua desabilitado no
painel; agendar/enfileirar não conecta esta alteração ao Instagram. APIs locais,
ingestão, download, deduplicação, scheduler, mídia, gestos de layout, Link Sticker,
publicação com clique único e Facebook crosspost permanecem preservados.

## Linguagem e estados

READY → Pronto; QUEUED → Na fila; SCHEDULED → Agendado;
PUBLISHING → Publicando; SUCCESS → Publicado; FAILED → Erro;
PAUSED → Pausado; CANCELLED → Cancelado.

RSS, SHA-256, MIME, Appium, ADB, cron, polling, resource-id e códigos de estado
ficam nos controles administrativos e logs. A tela diária mostra matéria,
horário, conta, imagem e ação. Títulos novos vêm do feed; registros antigos podem
usar o nome legível do endereço como fallback, mantendo a URL original.

## Preview integral

Um único transform escala o objeto inteiro: texto, ícone, fundo, padding, gap,
altura de linha e raio. A largura deriva do conteúdo; a fonte local Barlow
Condensed é carregada sem serviço externo. O tamanho não recalcula uma fonte
mínima durante cada escala. Atualização de texto, estilo e sliders é imediata.
O teste de navegador verificou proporções a 100%, 76% e 50%, inclusive no mobile.
É uma prévia aproximada; não substitui a captura e validação nativa do motor.

## Identidade da conta

A aba do próprio perfil usa `com.instagram.android:id/profile_tab`, observado no
XML fornecido. Não foi inventado um resource-id de username. O diagnóstico busca
candidatos visíveis no cabeçalho do próprio perfil selecionado, confirma pacote,
seleção, bounds, valor vivo pelo Appium e uma segunda hierarquia. IDs observados
com semântica de nome podem ser reconhecidos; candidatos ambíguos exigem seleção
na lista administrativa. Elementos ocultos, overlays, diálogos e nome divergente
não comprovam identidade.

Persistimos conta esperada, detectada, horário, match, candidatos e evidência.
Antes do comando real end-to-end, a mesma sessão normaliza para Home, verifica o
perfil ao vivo e retorna à Home antes de preparar o job. Resultado em cache não
basta. Sem prova recente ou com divergência, aborta antes da criação/publicação.
O diagnóstico isolado não descarta edição aberta, não altera login e não publica.

Esse caminho foi validado com hierarquias e sessões simuladas no cloud. A leitura
do username real precisa ser executada no Windows com Instagram/Appium; não há
emulador no cloud. Não se afirma vínculo Facebook ou entrega sem evidência.

## Papéis e histórico

Operador/Administrador são perfis de apresentação, sem autenticação nova nesta
etapa. O servidor segue local e mantém proteções de origem e requisições. Não
expor o painel publicamente como se a seleção de papel fosse uma barreira de acesso.

Publicados mostra SUCCESS real do motor, não Story antigo ou simples retorno à
Home. URL do Story indisponível não é inventada. A conta importada exige confirmação
registrada no resumo; preferência manual não vira identidade observada. Datas sem
published_at são identificadas como data do registro. Preview usa mídia local,
sem novo download. Alertas explicam ações; detalhes internos ficam separados.

## Verificação

Typecheck, build e 404 testes automatizados aprovados. Navegador local verificou
rotas, papéis, estado vazio, divergência de conta, edição, escala integral e mobile,
com dados de demonstração isolados. Nenhuma publicação real foi executada.
