# Operação local sem terminal

## Primeiro uso no Windows

Pré-requisitos instalados uma vez pelo administrador: Node.js LTS >=22.19,
Android Studio/SDK com platform-tools e emulator, um AVD funcional, Instagram
instalado e login feito manualmente. O sistema não instala Instagram, não pede
senha e não concede permissões da conta ou da câmera automaticamente.

Atualize o checkout pela interface do GitHub Desktop (Fetch/Pull origin, main).
Depois dê duplo clique em **PlantaoRioStories.vbs** na raiz do projeto. Também é
possível usar “Executar com PowerShell” em scripts/windows/create-shortcut.ps1
para criar o atalho **Plantão Rio Stories** na Área de Trabalho. Um instalador
.exe, empacotamento do Node e atualização automática não fazem parte desta etapa.
Se políticas da organização desabilitarem Windows Script Host/PowerShell, o
administrador deverá autorizar esses scripts ou usar a inicialização técnica.

O launcher identifica Node, confere a instalação existente, reinstala somente se incompleta/divergente, compila,
inicia o backend oculto e abre o navegador. Duplo clique reutiliza o backend
identificado por /api/runtime, além de mutex do launcher e backend.lock.
Depois de reiniciar o PC, abra novamente o atalho. Não é necessário abrir CMD
na operação diária. Atualização de código/dependências é tarefa administrativa.

## Aceitação local, sem publicação

1. Abra o atalho e acesse **Diagnóstico**.
2. Clique **Preparar sistema**. Aguarde Banco, Android, Emulador, Conexão e
   Instagram disponíveis. Painel disponível é diferente de motor preparado.
3. Se houver mais de um AVD, o administrador escolhe um nome sugerido na lista
   em Diagnóstico. SDK é encontrado por configuração salva, local.properties,
   instalação padrão do Android Studio e, por último, variáveis existentes.
   Um projeto Android externo pode ser indicado por ANDROID_LOCAL_PROPERTIES.
4. Abra **Contas**, cadastre o username esperado como Administrador e clique
   **Verificar conta**. A identidade vem do próprio perfil observado ao vivo,
   nunca do nome cadastrado. Se o username não puder ser identificado, escolha
   um candidato real em Configurações e verifique novamente. Uma edição aberta
   é preservada pelo diagnóstico de conta; volte manualmente à Home se solicitado.
5. Em **Configuração do Story**, ajuste e **salve** texto, estilo, tamanho e posição.
6. Clique **Testar no Instagram**. O sistema usa a arte local demonstrativa e
   https://plantaorio.com.br/, revalida a conta ao vivo, normaliza a Home,
   cria novo Story e aplica Link/CTA/layout. Aguarde o resultado no painel.
7. Confira o editor e o estilo no emulador: o índice de estilo corresponde a
   toques no objeto; o Instagram não expõe um identificador confiável da cor.
   O resultado registra style_verified_visually=false, sem inventar confirmação.
8. Clique **Encerrar teste**: usa a normalização já validada e somente o descarte
   conhecido. Diálogo desconhecido faz abortar, sem clicar em publicação.
9. Administrador pode **Encerrar aplicativo**, reiniciar emulador/conexão ou
   encerrar conexão. Essas ações recusam dispositivo ocupado. Serviços externos
   não são encerrados por PID salvo. Fechar a aba do navegador deixa o backend
   funcionando; o botão Encerrar aplicativo faz o encerramento explícito.

O pinch nativo mantém 0.50 para o tamanho aprovado (~76%). Outros tamanhos de
redução usam o mesmo gesto nativo com parâmetro estimado e exigem bounds dentro
de ±8%. Se a geometria não atingir o alvo, o teste falha sem publicar. Ampliação
acima do tamanho original ainda não foi validada e é recusada. Movimento usa
exatamente o hold de 900 ms com cinco passos W3C validados, só quando necessário,
com tolerância de posição de ±4%. Esses novos ajustes pelo painel precisam de
aceitação no Windows; os smokes validados anteriores permanecem disponíveis.

## Componentes

| Componente | Responsabilidade |
| --- | --- |
| PlantaoRioStories.vbs / scripts/windows/start.ps1 | Entrada única, Node/build/backend ocultos, abre navegador |
| runtimeStore | runtime.json atômico, caminhos/AVD/TTL, modo teste, eventos e processos |
| androidSdk | Descoberta e validação de SDK/ADB/emulator sem `set` manual |
| processSupervisor | execFile/spawn sem shell para serviços, PID/saída/stdout/stderr mascarados |
| runtimeManager | Preparação ordenada, progresso, saúde, exclusão de ações e recuperação |
| deviceLock | Lease de arquivo exclusivo por dispositivo, usado também por InstagramDriver |
| panelTestPort / testWorker | Processo único de teste com conteúdo/config congelados; sem import de publicação |
| configuredLayoutAdapter | Liga a configuração aos gestos nativo/W3C existentes; revalida objeto/job |
| runtimeHttp / runtimeClient | API local e controles simples, detalhes técnicos administrativos |
| operações/fila/scheduler existentes | Persistência e políticas independentes do Android; adapter real permanece ausente |

### O que inicia automaticamente

Launcher: backend e navegador. Backend: ingestão e monitoramento passivo do estado
(a cada 15 s), scheduler existente sem adapter de publicação. **Preparar sistema**:
ADB, emulador caso ausente, Appium caso ausente e Instagram. Verificar conta/testar
são ações explícitas. Não há worker automático de publicação ou publicação da fila.
Pausar/retomar no Diagnóstico guarda intenção para o worker futuro, sem iniciar jobs.

### Estado, identidade e concorrência

Conta tem TTL padrão de 300 s, configurável entre 30 e 3600. Confirmação é
invalidada ao reiniciar painel, preparar/reiniciar serviços ou perder conexão.
Toda execução de teste revalida o perfil na mesma sessão antes de criar o Story.
Fluxo real continua exigindo prova fresca, URL/CTA exatos, transação do job atual,
layout aprovado e as duas travas antigas; não se confia apenas no estado salvo.

O lock do backend protege escrita dos JSONs. O lock do dispositivo é adquirido
por toda conexão InstagramDriver, incluindo comandos legados. Preparação/reinício
não pode interromper um worker externo. Ações do painel usam exclusão mútua e
recusam clique duplo. O worker recebe snapshot e não grava operations.json em
concorrência com o backend. Só o backend proprietário escreve esse armazenamento.
Handles de filhos são usados para encerramento, nunca um PID reaproveitado após
restart. Trava com processo morto é recuperada; trava corrompida ou reclamante
interrompido exige revisão administrativa. Não apague travas de processos vivos.

O teste tem watchdog de dez minutos: só o filho dedicado de teste pode ser
encerrado ao exceder esse tempo; nunca um publicador real ou PID externo. O editor
fica para conferência/normalização e o teste vai para revisão, sem retry automático.
Em encerramento normal, o backend aguarda o teste. Queda abrupta de energia não
permite garantir limpeza de processos; no próximo início, o sistema inspeciona
serviços, não cria duplicata e não repete jobs interrompidos. Teste PREPARING vira
REQUIRES_REVIEW; fila PREPARING/PUBLISHING continua usando a recuperação existente,
sem retry automático. READY ainda aguardando operador continua READY. Histórico,
agenda, mídia, configurações e conta esperada não são apagados.

### Modo Teste e duplicidade

Modo Teste é obrigatório no painel nesta etapa e não pode ser desligado pela API.
O worker força DRY_RUN=true, ALLOW_PUBLISH=false e CONFIRM_REAL_PUBLISH=NO. Não
importa/clica controles de publicação. Mesmo os comandos reais legados agora
verificam Modo Teste antes do clique: configuração persistida ativa não pode ser
superada por opt-ins de ambiente. Na ausência de configuração, o default também
é teste. Testes automatizados que exercitam o motor real usam mocks e opt-out
explícito isolado; nenhuma publicação de verdade ocorre no cloud.

Publicar próximo/publicar agora continuam desabilitados. Timeout depois de um
clique real continua INCONCLUSIVE/REQUIRES_REVIEW, nunca autoriza novo clique.
Deduplicação por artigo/hash e regras antigas permanecem. Futuro worker recebe
local_media_path, article_url, account_id e scheduled_at já presentes na fila,
sem acoplar RSS a uma sessão Android.

### Diagnóstico e persistência

Dados: data/admin/admin.json, operations.json e runtime.json; downloads: data/media;
artefatos: artifacts/test-*/. ADMIN_DATA_DIR move a persistência e deve ser igual
para processos que controlam o mesmo dispositivo. Não opere dois checkouts com
pastas de dados distintas sobre o mesmo emulador. Launcher conserva logs de
instalação/build/backend em data/admin; detalhes de serviços ficam no Diagnóstico
administrativo. Logs da interface normal não mostram comandos/seletores/paths.
Papéis ainda são perfis de apresentação, não autenticação: manter bind localhost.

### Validação e limites desta entrega

Typecheck, build e 424 testes aprovados; aceitação no navegador com host Android
simulado. O backend real também foi iniciado com dados isolados: /api/runtime e
/api/meta responderam, com painel disponível, motor não preparado e publicação
bloqueada; o encerramento pelo endpoint liberou backend.lock. Locks
foram testados entre processos Node reais e supervisão com filhos Node inofensivos.
Não foi executado Appium/emulador nem publicação real no cloud. Launcher Windows,
boot do AVD e gestos reais do novo adapter precisam do roteiro local acima.
Node/SDK/AVD/Instagram/login são pré-requisitos administrativos. CMD continua
opcional para desenvolvimento, instalação fora do padrão e investigação avançada;
a operação pelo atalho/painel não pede comandos ao jornalista.

## Arquivo esbuild.exe bloqueado na instalação (EPERM)

Esse erro significa que o Windows recusou remover o executável. Ele pode estar
em uso por um processo anterior; antivírus ou permissões também podem bloquear.
Não apague node_modules, não desative antivírus e não encerre todos os processos Node.

O launcher agora verifica a árvore npm, versões/integridade do registro, arquivos
principais e componentes de inicialização antes de decidir por npm ci. Não
reinstala uma árvore válida só porque launcher-lock.sha256 ainda não existe.
Se a árvore ficou parcial, verifica processos cujo executável pertence ao
node_modules deste checkout e recusa reinstalar enquanto estiverem em uso.

Atualize main pelo GitHub Desktop. Feche as janelas antigas do painel/testes ou,
se não conseguir identificar o processo, salve seu trabalho e reinicie o Windows.
Depois abra PlantaoRioStories.vbs novamente. A reinstalação necessária ocorrerá
oculta, mantendo data/admin, mídia e configurações. Se persistir, envie
install.stderr.log e install.stdout.log. O launcher não tenta alterar permissões
nem encerrar processos à força. O reconhecimento do lock Windows precisa de
validação local; no cloud foram verificados preflight real e cenários simulados.
