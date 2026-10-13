# plantao-rio-story-link-poc

## Abrir sem CMD no Windows

Dê duplo clique em **PlantaoRioStories.vbs** na raiz (Node.js e Android Studio/AVD
instalados previamente pelo administrador). O launcher prepara o backend oculto
e abre o painel. Em **Diagnóstico**, clique **Preparar sistema**; depois confirme
a conta em **Contas**. Salve a configuração e use **Testar no Instagram** para
preparar o Story sem publicar. **Encerrar teste** volta com segurança à Home.

O cabeçalho indica **MODO TESTE ATIVO**. Publicação pelo painel continua bloqueada,
assim como comandos reais quando esse modo estiver ativo. Fechar a aba não encerra
o backend; o administrador usa **Encerrar aplicativo** em Diagnóstico.
[Roteiro completo, componentes e limites](docs/LOCAL_APPLICATION.md).

## Painel administrativo local

No terminal do Windows, dentro do repositório:

```bat
npm install
npm run admin
```

Abra **http://127.0.0.1:4310** no navegador local. `ADMIN_PORT` altera a porta e
`ADMIN_DATA_DIR` altera a pasta de dados (padrão `data/admin`). O servidor escuta
apenas em 127.0.0.1. Não é um serviço público ou uma URL de preview do Codex Cloud.

Navegação editorial: **Visão geral, Novas matérias, Fila de Stories, Agenda,
Contas, Publicados, Configuração do Story e Alertas**. Escolha Administrador em
“Visualização” para acessar Configurações, Sistema e Logs técnicos. Essa escolha
organiza a interface; não substitui autenticação ou controle de acesso do servidor.

O preview altera texto, estilo, tamanho e posição imediatamente. Todo o sticker
(texto, ícone, espaçamento e fundo) recebe a mesma escala. A imagem de demonstração local usa `assets/story-preview-demo.jpg`, separada da
mídia de execução. `ADMIN_PREVIEW_IMAGE` permite escolher outra imagem local. O preview é uma
aproximação visual: os bounds reais do Instagram continuam sendo a referência do motor.
**Salvar no painel não autoriza publicação.** O botão Testar usa a configuração salva
no motor local, apenas em modo seguro; tamanho/posição são validados pelos bounds
e o estilo precisa de conferência visual.

Para confirmar a conta no Windows, deixe Instagram e Appium disponíveis, abra
**Contas**, cadastre o nome esperado como Administrador e clique **Verificar conta**.
O diagnóstico abre o próprio perfil e lê o nome observado. Se houver ambiguidade,
selecione o nome encontrado na lista em Configurações e verifique novamente.
Não é necessário procurar resource-ids manualmente. Conta divergente ou sem prova
bloqueia o fluxo real. A verificação não cria Story nem publica. O comando local
`npm run inspect:instagram-account` salva XML/PNG/JSON para diagnóstico.

O comando real end-to-end faz uma nova verificação na mesma sessão antes da
preparação; uma confirmação antiga no painel não substitui essa leitura.
Facebook só aparece confirmado quando há evidência; preferência de destino não
comprova vínculo ou entrega. [Auditoria de produto e UX](docs/UX_PANEL_AUDIT.md).

### Arquitetura e persistência

- Node.js HTTP + TypeScript no backend e cliente; HTML/CSS sem framework e sem
  addon nativo adicional. A ingestão usa Cheerio para analisar HTML diretamente.
- `src/admin/domain.ts`: contratos de settings, publication_jobs e publication_events,
  defaults medidos e validações.
- `src/admin/repositories.ts` / `jsonStorage.ts`: interfaces substituíveis e persistência
  JSON versionada, escrita serializada e substituição atômica em admin.json.
- `storySettingsService.ts`: getStickerText, getStickerScale, getStickerPosition,
  getPublishingSettings; preparado para integração futura, sem ligação ao motor.
- `publicationsService.ts`: histórico, filtros, paginação, detalhes, registro de eventos
  e métricas com horário de Brasília.
- `artifactImporter.ts`: importação somente de resumos existentes em artifacts.
- `httpServer.ts` / `server.ts`: rotas locais e inicialização.
- `client.ts` / `operationsClient.ts` / `view.ts`: telas editoriais, ferramentas administrativas e preview do sticker.

As preferências e registros sobrevivem ao fechamento/reabertura. data/admin fica
ignorado no Git; não exclua essa pasta se quiser manter o histórico. Uma instância
de servidor escreve o arquivo local; futuros adaptadores PostgreSQL/MySQL podem
implementar as mesmas interfaces sem reescrever as telas. Arquivo corrompido é
preservado e causa erro, não é silenciosamente substituído por dados vazios.

### Dados reais, sem simular publicações

Dashboard e atualização de histórico leem summary.json de diretórios
story-end-to-end-real-* e story-prepare-* gerados pelo motor. Resumos anteriores
com image e novos com media são aceitos quando contêm identidade, URL e texto.
Importação é idempotente por diretório e não executa Appium nem modifica artefatos.
Resumo ausente/incompleto/corrompido não vira uma publicação fictícia.

Sem registros, contagens são zero e tabelas mostram estado vazio. SUCCESS/FAILED/
INCONCLUSIVE vêm do resultado do motor; preparo sem publicação fica READY. Contagens
por período usam confirmação registrada, com término do resumo como fallback quando
não existe published_at. Horário médio usa SOMENTE published_at conhecidos, e fica
sem valor quando não há dados suficientes. Não se presume sucesso por presença de
Story antigo. Facebook ativado indica crosspost aceito/configurado, não entrega
confirmada no Facebook. Miniatura usa a mídia original quando acessível.

O início de resumos importados vem do timestamp do diretório, o término da gravação
do resumo; a tela informa essa origem. Medidas faltantes ficam sem valor; a escala
é lida do diagnóstico de resize quando existe, e o centro é calculado dos bounds
registrados. O log ARTIFACT_IMPORTED tem timestamp da importação; não inventa horários
de passos intermediários. O serviço permite registrar todos os eventos pedidos
por job em integração futura. Jobs que falharam antes de gerar um resumo completo
ainda não são automaticamente reconstruídos.

A API local é apenas do painel: leitura de histórico/preview e gravação de settings.
Não há endpoint de iniciar job/publicar, nem integração de notícias, portal,
WhatsApp, e-mail, fila externa ou execução de vídeo. Preferências de publishing não
substituem ALLOW_PUBLISH/CONFIRM_REAL_PUBLISH nem qualquer trava do motor. Nenhuma
variável/credencial do ambiente é enviada ao navegador.

### Verificação

```bat
npm run typecheck
npm run build
node --test tests/*.test.mjs
```

Testes admin cobrem defaults, validação, persistência após reinício, escritas
concorrentes, arquivo corrompido, métricas/filtros, rotas HTTP reais, importação
idempotente, preview e ausência de endpoint de publicação. A interface foi verificada
em Chromium desktop e mobile, incluindo sliders, preview, ajuste de 10 px, salvar,
restaurar, recarregar, detalhes e logs. Nenhuma publicação real foi executada.


Base inicial em Node.js e TypeScript para uma futura prova de conceito de stories com links no Instagram. Esta etapa prepara a estrutura e o diagnóstico de configuração; há apenas um smoke test local que abre o Instagram, sem implementar Stories.

## Onde cada componente roda

- O Android Emulator e o Instagram rodam localmente no Windows.
- O Codex Cloud apenas cria e mantém o código. O diagnóstico e a compilação podem ser executados no cloud sem dispositivos.
- Os testes reais com ADB/Appium serão executados no computador local, com Android SDK, Java e o emulador configurados.
- Não deve haver senha do Instagram no projeto, em arquivos de configuração, logs ou commits. A autenticação no aplicativo deverá ser feita manualmente no dispositivo local.

## Requisitos e instalação

Use Node.js 22.19 ou superior e npm 10 ou superior. O projeto inclui TypeScript, tsx, dotenv, WebdriverIO, Appium **2.19.0** e UiAutomator2 **4.2.9**. O driver está fixado em uma versão compatível com Appium 2.

```sh
npm ci
```

Crie um `.env` local a partir do exemplo. No PowerShell:

```powershell
Copy-Item .env.example .env
```

No Bash:

```sh
cp .env.example .env
```

O `.env` é ignorado pelo Git. A única variável obrigatória nesta etapa é `DRY_RUN`, com valor `true` ou `false`; o exemplo usa `true`.

## Verificações desta etapa

```sh
npm run doctor
npm run typecheck
npm run build
```

O `doctor` carrega o `.env`, verifica a presença e o formato de `DRY_RUN` e imprime versões e plataforma sem expor valores de configuração. Retorna código 0 quando a configuração está válida e 1 quando há pendências. Ele não acessa ADB, Appium, emulador, rede ou Instagram, mesmo quando `DRY_RUN=false`.

A compilação gera `dist/`, ignorado pelo Git. Ainda não há testes de automação em `tests/`.

## Appium no Windows — smoke test local

As dependências locais incluem Appium 2 e UiAutomator2. Quando for executar testes reais no Windows, registre o driver no Appium e confira a instalação a partir da raiz do projeto:

```powershell
npx --no-install appium driver install --source=local "$PWD/node_modules/appium-uiautomator2-driver"
npx --no-install appium driver list --installed
npm run appium
```

Esses comandos são destinados ao computador local e não fazem parte do diagnóstico inicial. Não foram executados contra um emulador nesta etapa. O smoke test usa WebdriverIO para criar uma sessão UiAutomator2 no dispositivo `emulator-5554`.

## Estrutura

```text
src/
  config/environment.ts  # Leitura e validação da configuração
  instagram/             # InstagramDriver.ts e smokeTest.ts
  utils/doctor.ts         # Relatório local de configuração
assets/                   # Reservado para recursos não sensíveis
tests/                   # Reservado para os futuros testes
```

Arquivos `.gitkeep` preservam os diretórios vazios no Git. Não adicione dados pessoais, credenciais ou mídia sensível ao repositório.

## Executar o primeiro teste de integração (somente no Windows local)

Com o Instagram já instalado e autenticado no `emulator-5554` e o Appium rodando em `http://127.0.0.1:4723`, execute na raiz:

```powershell
npm run smoke:instagram
```

O teste verifica `/status`, cria a sessão UiAutomator2, ativa `com.instagram.android`, aguarda três segundos e confirma o package em primeiro plano (com até 15 segundos adicionais de espera). Não verifica se o usuário está logado: preserva o login existente com `noReset=true`, `fullReset=false` e sem forçar reinicialização. Ao terminar, inclusive em caso de erro após a conexão, tenta encerrar apenas a sessão Appium, mantendo o aplicativo aberto com `shouldTerminateApp=false`. Falhas de execução ou encerramento exibem o erro completo e retornam código 1.

Este teste abre o aplicativo localmente mesmo com `DRY_RUN=true`: não lê nem altera essa variável. Não publica Stories ou outro conteúdo, não usa coordenadas nem API privada do Instagram e não armazena senhas. No Codex Cloud execute apenas `npm run typecheck` e `npm run build`; a integração real precisa ser validada no Windows.

## Selecionar a primeira foto recente e parar no editor de Story

No Windows com Appium, `emulator-5554`, Instagram autenticado e `DRY_RUN=true`:

```powershell
npm run smoke:story-image
```

A imagem da POC já deve estar em `/sdcard/Pictures/PlantaoRio/` e ser **a mídia mais recente em Recents**, sem outra captura/foto posterior. O comando não reenvia nem apaga mídia. Somente quando precisa selecionar uma foto, confere por SHA-256 que um dos 20 arquivos recentes da POC corresponde a `assets/story-test.jpg` (ou ao arquivo local passado como argumento). Essa conferência garante a presença do arquivo; a identificação da miniatura selecionada depende da premissa de ordem em Recents, não de uma comparação visual automática.

Reutiliza a detecção de estado, entra em STORY por `com.instagram.android:id/cam_dest_story` e aguarda a galeria `com.instagram.android:id/gallery_grid_container` existir e ficar visível. Exige que o álbum `com.instagram.android:id/gallery_folder_menu_tv` mostre `Recents`; outro álbum encerra com erro, sem selecionar imagem.

Busca somente `com.instagram.android:id/gallery_grid_item_thumbnail` dentro da grade. Aguarda uma coleção não vazia, registra a quantidade e percorre na ordem retornada pela galeria. Escolhe a primeira foto habilitada, visível e inteiramente dentro da janela atual. Rejeita o ID `com.instagram.android:id/gallery_grid_camera_item_icon`, descrições de câmera e itens que contenham esse ícone. Antes do clique, registra resource-id, content-desc e quantidade. Clica uma única vez e nunca tenta uma segunda foto se o editor não abrir.

Não há cliques por coordenadas ou XPath. A posição/tamanho dinâmica é consultada somente para excluir miniaturas fora da janela. Não há mais seleção ou confirmação manual neste fluxo.

A confirmação desta etapa exige que a galeria deixe de estar visível, Instagram continue em primeiro plano e um marcador real do editor apareça: `asset_button`, descrição `Stickers` ou `your_story_share_shortcut_button`. Isso confirma a tela; a identidade da imagem continua dependendo da premissa de ordem em Recents. As capturas permitem conferir o resultado localmente.

Salva `gallery.xml`, `.png`, `.json`, depois `editor.xml`, `editor.png`, `editor.json` e `summary.json` em `artifacts/story-image-<timestamp>/`. Erros geram `error.xml`, `error.png`, `error.json` quando houver sessão Appium disponível. Os logs seguem os sete passos, e o resumo documenta o critério de seleção e confirmação.

Para no editor sem abrir stickers, inserir link, clicar em compartilhar ou publicar. Preserva mídia, login e `DRY_RUN`; encerra somente a sessão Appium com `shouldTerminateApp=false`. Capturas podem conter dados pessoais e continuam fora do Git. Não precisa de `story-selectors.local.json`. A execução real ocorre no Windows, não no cloud.

## Inspecionar os elementos reais do Instagram

No Windows, com Appium e `emulator-5554` disponíveis:

```powershell
npm ci
npm run inspect:instagram
```

Este comando não depende de `story-selectors.local.json`. Ele abre/ativa `com.instagram.android` preservando os dados e o login, aguarda a confirmação do package ativo e captura a hierarquia atual via Appium. Salva:

- `artifacts/instagram-page-source.xml`: page source completo, sem modificações.
- `artifacts/instagram-elements.json`: lista de elementos com pelo menos um atributo não vazio entre `text`, `content-desc`, `resource-id` e `class`. Cada objeto inclui os quatro campos; atributos ausentes aparecem como strings vazias.

Os elementos também são listados no terminal, sem inventar resource-ids ou transformar atributos em seletores presumidos. Os arquivos fixos são substituídos a cada execução bem-sucedida. Em caso de erro, o comando retorna código 1; não considere relatórios anteriores como uma captura nova. XML é validado antes da extração, sem aceitar DTD ou declarações de entidades.

A tela capturada é a que aparece após ativar o Instagram: o comando não navega para Story nem clica em controles. Para coletar outra tela sem ativar o aplicativo novamente, navegue manualmente e use o já existente `npm run diagnose:instagram`.

A sessão Appium é encerrada com as mesmas capabilities de preservação (`noReset=true`, `shouldTerminateApp=false`). Não há publicação, logout, limpeza de dados ou alteração de `DRY_RUN`. Relatórios e saída do terminal podem conter dados pessoais; `artifacts/` permanece ignorado pelo Git. A execução real deve ocorrer no Windows, não no Codex Cloud.

## Máquina de estados reutilizável

`instagramStateMachine.ts` é compartilhado pelos fluxos de imagem, diagnóstico e stickers. A detecção usa `$$` para o ID compartilhado de stickers e a descrição Link Sticker: qualquer coleção não vazia confirma `STATE_STICKERS`, sem seleção estrita nem índices. Para os demais marcadores únicos, usa `$`, `isExisting` e `isDisplayed`, sem `waitForExist` ou espera por Home. A sessão Appium configura `implicit=0` para que seletor ausente não cause espera longa. Ausência/stale durante uma transição é tratada como probe negativo; erros de conexão continuam sendo reportados.

A ordem de prioridade é:

- `STATE_LINK_EDITOR`: existe campo URL, Done ou título `link_sticker_list_*` confirmados (antes de Stickers).
- `STATE_STICKERS`: existe `com.instagram.android:id/sticker_sheet_redesign_item` ou descrição `Link Sticker` (antes de Editor).
- `STATE_EDITOR`: marcador visível `asset_button`, `your_story_share_shortcut_button` ou descrição `Stickers`.
- `STATE_GALLERY`: `gallery_grid_container` visível.
- `STATE_CREATE`: `cam_dest_story` visível.
- `STATE_HOME`: `feed_tab`, `action_bar_left_button` ou `reel_empty_badge` visível.
- `STATE_UNKNOWN`: nenhum marcador disponível.

Os IDs com namespace usam o prefixo confirmado `com.instagram.android:id/`. A visibilidade evita que um elemento oculto de uma tela anterior desvie a detecção. Stickers/Editor/Galeria têm prioridade quando marcadores coexistem. A detecção de Stickers usa existência, conforme os seletores confirmados; o clique no item ainda exige visibilidade.

`smoke:story-image` abre/ativa Instagram preservando a sessão e retoma da tela atual:

- Editor: assume que a imagem já está carregada, confirma o estado, salva `editor.xml/.png/.json` e termina sem ADB ou seleção. Não valida novamente a identidade visual da imagem existente.
- Galeria: seleciona uma foto pelo fluxo validado e aguarda Editor.
- Criação: clica STORY uma vez, aguarda Galeria, seleciona e aguarda Editor.
- Home: consulta rapidamente `action_bar_left_button` e usa a rota tradicional quando presente. Caso ausente, busca por accessibility id exato `Add to story`, exigindo um único botão visível de classe `android.widget.Button`, existente e habilitado. O atributo `clickable` é verificado quando exposto. `reel_empty_badge` é apenas evidência visual, nunca alvo do clique. Botões duplicados abortam: sem evidência de associação na hierarquia, o texto `Your story` isolado não desambigua com segurança. Após clicar uma vez, aguarda 300 ms e detecta a tela por até seis segundos; aceita Criação, Galeria ou Editor. Se permanecer na Home, registra isso explicitamente e o script salva XML/PNG/JSON de erro. `bottom_sheet_camera_container` não comprova câmera, e nenhum estado de câmera novo foi inferido. Nunca usa `action_bar_button` genérico ou Stories de outras contas.
- Desconhecido: não procura nem tenta `feed_tab`; captura `error.xml/.png/.json` e retorna código 1.

As esperas longas só acontecem depois de reconhecer um estado e iniciar uma navegação, com timeout de 20 segundos. O helper nativo de clicabilidade usa existência, visibilidade, habilitação e `clickable=true`; não chama a API de browser do WebdriverIO. Nenhum sticker ou botão de compartilhamento é clicado pelo fluxo de imagem. `summary.json` informa estado inicial, transições e reutilização do rascunho.

O diagnóstico `npm run inspect:story-flow` reutiliza a detecção: chega somente à criação partindo de Home/Criação, para sem navegar se já está em Galeria/Editor e aborta em Unknown. O módulo de stickers retoma diretamente um painel já aberto; só usa a máquina para obter o editor se precisar abrir o painel. O fluxo de imagem não tenta voltar do painel para o editor nem selecionar outra imagem.

Para validar sem Appium, execute `npm run build` e `node --test tests/instagramState.test.mjs tests/storyMediaInspection.test.mjs tests/storyGallery.test.mjs tests/storyStickers.test.mjs`. Esses testes usam sessões simuladas; a execução real permanece no Windows. `DRY_RUN=true` continua obrigatório e não é alterado. Não são usadas coordenadas, XPath ou índices de coleções vazias. Capturas locais podem conter dados pessoais e ficam ignoradas pelo Git.

## Abrir e inspecionar o painel de stickers (sem clicar em LINK)

No Windows, com Appium, emulador, Instagram autenticado e `DRY_RUN=true`:

```powershell
npm run smoke:story-stickers
```

Reutiliza o rascunho se o editor já estiver aberto. Caso contrário, usa o fluxo de imagem validado: a foto da POC deve continuar sendo a mais recente em Recents e estar em `/sdcard/Pictures/PlantaoRio/`. As capturas dessa preparação ficam na subpasta `image-flow/`. `npm run smoke:story-image` continua parando no editor, sem abrir stickers.

Confirma o editor por pelo menos um marcador visível: resource-id `asset_button`, accessibility id `Stickers` ou `com.instagram.android:id/your_story_share_shortcut_button`. O marcador de compartilhamento é somente consultado, nunca clicado. Localiza Stickers primeiro por `asset_button`, com fallback pela descrição `Stickers`. Se `asset_button` existir, exige seletor único e botão visível/habilitado/clicável, sem exigir descrição nesse nó. `Stickers` pode estar em outro elemento da tela e é apenas confirmação adicional. O fallback pelo accessibility id só é usado quando o resource-id não existe; se o ID existir mas não ficar clicável, encerra com erro, sem clicar em outro nó.

Aguarda `STATE_STICKERS` pelos marcadores reais do painel. Não basta uma mudança genérica no XML. Salva `stickers.xml`, `stickers.png`, `stickers.json` e `summary.json` em `artifacts/story-stickers-<timestamp>/`, além da captura anterior `editor-before-stickers`. Filtra atributos observados relacionados a Link, LINK, Website, URL, Location, Mention, GIF, Poll, Music e Hashtag. Registra `text`, `content-desc`, `resource-id` e `class`; somente rótulo exato Link/LINK ou descrição confirmada Link Sticker é reportado como LINK encontrado. Os seletores derivados são apresentados para diagnóstico, sem afirmar que cada um é único.

Nenhum seletor do painel foi inventado. Não clica em LINK, insere URL, aciona Your story, compartilha ou publica. Não usa XPath nem coordenadas. Se LINK não aparecer na captura, informa isso e para sem procurar por cliques ou rolagem. Erros geram `error.xml`, `error.png` e `error.json` quando possível. A sessão Appium é encerrada sem terminar o Instagram, alterar login ou apagar dados; `DRY_RUN` permanece inalterado.

Os IDs e rótulos reais das opções do painel só serão conhecidos após execução local. Envie a captura revisada de dados pessoais para identificar o próximo seletor. O cloud executa typecheck, build e testes offline, sem acessar o emulador.


## Inspecionar a configuração do sticker LINK sem preencher URL

No Windows com Appium, emulador, Instagram autenticado e `DRY_RUN=true`:

```powershell
npm run smoke:story-link
```

Se já estiver em `STATE_STICKERS`, retoma diretamente sem clicar em Stickers novamente nem voltar ao editor. Se estiver no editor, abre o painel com o botão validado. Nos estados Home/Criação/Galeria, reutiliza a preparação da imagem; Unknown aborta com diagnóstico.

O ID `com.instagram.android:id/sticker_sheet_redesign_item` é compartilhado. O teste usa `$$` no ID compartilhado, confirma coleção não vazia e registra content-desc, text, resource-id e displayed de cada item. Filtra a coleção pelo **content-desc exato `Link Sticker`**, respeitando maiúsculas e espaços. Só prossegue quando existe exatamente um item correspondente; zero ou mais de um abortam sem clique. Reconsulta toda a coleção e filtra novamente pela descrição exata antes de clicar uma única vez; valida ID, visibilidade e habilitação no handle retornado. Não chama waitForExist/waitForDisplayed individualmente nos itens, evitando reconsulta por um seletor compartilhado. Não escolhe o primeiro item e não clica pelo ID compartilhado sozinho. Não usa índices, XPath ou coordenadas.

Após o clique, aguarda mudança na hierarquia, saída do painel e atributos observados relacionados à configuração do link. Salva `link-editor.xml`, `link-editor.png`, `link-editor.json` e `summary.json` em `artifacts/story-link-<timestamp>/`. Mesmo se a próxima tela não for reconhecida, tenta preservar `link-editor` e também `error.xml/.png/.json`.

Lista atributos reais relacionados a URL, link, website, web address, Done, Customize sticker text e sticker text. Um campo `EditText` só é listado como candidato de URL se algum atributo observado indicar essa finalidade; um campo sem rótulo/ID relacionado não é presumido como URL. Done é registrado como candidato de confirmação quando o rótulo exato estiver presente. Se não forem identificáveis, isso é informado no terminal para análise do XML. Todos os candidatos incluem resource-id, content-desc, text e class; os IDs do editor de link não são inventados.

Para na tela de configuração. Não preenche nenhum campo, confirma, clica em Your story ou publica. Os scripts antigos de imagem/stickers continuam parando nas respectivas etapas. A sessão Appium é encerrada sem fechar Instagram ou apagar dados/login, e `DRY_RUN` permanece inalterado. Os seletores reais dos campos só serão conhecidos na execução local; o cloud valida código e testes simulados.


O acesso ao ID compartilhado está centralizado em `stickerCollection.ts`: `getStickerItems` e `hasStickerPanel` recebem somente a capacidade `$$`, sem acesso a `$` ou seleção estrita. A detecção considera apenas `length > 0`; a seleção do LINK exige exatamente uma descrição correspondente em duas leituras da coleção. Os testes simulam 17 elementos e lançam `StrictSelectorError` caso a detecção use seleção única ou o fluxo LINK invoque espera individual.


## Preencher uma URL variável sem clicar em Done

No Windows, com Appium, emulador, Instagram autenticado e `DRY_RUN=true`, pode começar em qualquer estado conhecido: Home, Criação, Galeria, Editor, Stickers ou configuração do Link.

```powershell
npm run smoke:story-link-fill
# Parâmetro tem prioridade sobre STORY_URL:
npm run smoke:story-link-fill -- "https://plantaorio.com.br/?id=123"
# Ou variável de ambiente:
$env:STORY_URL = "https://plantaorio.com.br/"
npm run smoke:story-link-fill
```

Sem argumento nem STORY_URL, usa `https://plantaorio.com.br/`. Exige HTTP(S) e preserva a string informada para conferir exatamente o valor, sem normalizar query ou barra final.

A máquina detecta `STATE_LINK_EDITOR` antes de outros estados pela existência de qualquer ID confirmado: `link_sticker_list_web_url_edit_text`, `link_sticker_list_done_button` ou `link_sticker_list_title`, todos com prefixo `com.instagram.android:id/`. A descoberta usa probes de coleção sem espera longa. Se já estiver nesse estado, não navega nem clica em LINK novamente. Se estiver em Stickers, filtra a coleção pela descrição exata `Link Sticker`, exige exatamente um item e clica somente nele; aguarda o estado de configuração. Nos estados Home/Criação/Galeria, compõe `StoryLinkPublisher.loadImageIntoStory` e `navigateToStoryEditor`, usando a imagem de teste já enviada. No editor, reutiliza `ensureStickersPanel`. `storyLinkNavigation.ts` coordena essas funções sem duplicar os cliques ou a seleção. Apenas STATE_UNKNOWN aborta com diagnóstico. A foto da POC precisa ser a mídia mais recente em Recents quando houver seleção; ao retomar Editor/Stickers/Link, não seleciona outra imagem.

No campo `com.instagram.android:id/link_sticker_list_web_url_edit_text`, aguarda existência/visibilidade, limpa o conteúdo anterior, insere a URL e lê o texto para confirmar igualdade exata. Depois somente observa `com.instagram.android:id/link_sticker_list_done_button`: não clica, envia Enter ou confirma. Os IDs de cancelar, título e custom CTA estão registrados em `linkEditorSelectors.ts`, mas não são acionados.

Salva `link-filled.xml`, `link-filled.png`, `link-filled.json` e `summary.json` em `artifacts/story-link-fill-<timestamp>/`. Em erro, tenta `error.xml/.png/.json`. Para com a URL digitada e o diálogo aberto. Preserva dados/login e encerra apenas a sessão Appium, sem publicar ou tocar em Your story. Não usa coordenadas nem XPath. URLs informadas aparecem no terminal e nas capturas, conforme o diagnóstico; os artefatos permanecem ignorados pelo Git.

Validação offline: `npm run typecheck`, `npm run build`, `node --test tests/*.test.mjs`. A execução real acontece somente no Windows.


Os testes do preenchimento cobrem início em cada um dos seis estados conhecidos, usando os navegadores de produção sobre uma sessão simulada, além de Unknown, divergência de valor e DRY_RUN desabilitado. O sucesso só é registrado depois de conferir a URL e salvar `link-filled.xml/.png/.json`. A execução integrada real deve ser feita no Windows; o cloud não acessa Appium/ADB.

### Confirmar o Link Sticker sem publicar

Execute no Windows local:

```powershell
$env:DRY_RUN="true"
$env:STORY_URL="https://plantaorio.com.br/"
npm run smoke:story-link-apply
```

O script reutiliza o fluxo completo dos estados conhecidos, preenche a URL e verifica o valor exato antes de clicar uma única vez em `com.instagram.android:id/link_sticker_list_done_button`. Nesta etapa, `DRY_RUN=true` permite confirmar o sticker; a publicação continua bloqueada. Não clica em Your story, Share, Close Friends, Next ou Publish. O script anterior `smoke:story-link-fill` continua parando antes de Done.

Após confirmar novamente `STATE_EDITOR`, salva `story-with-link.xml`, `story-with-link.png` e `story-with-link.json` em `artifacts/story-link-apply-<timestamp>/`. Lista atributos reais relacionados ao link, sticker e domínio da URL informada. O botão Stickers e termos genéricos não são tratados como prova de aplicação. Sem evidência textual na hierarquia, informa apenas que retornou ao editor e pede conferência do screenshot; não publica. O resumo distingue confirmação do editor e evidência do sticker. Erros salvam `error.xml`, `error.png` e `error.json`, sem repetir o clique em Done. Encerra apenas a sessão Appium preservando o aplicativo, login e dados.

### Inspecionar publicação controlada sem publicar

No Windows local, execute `npm run smoke:story-publish-ready` com `DRY_RUN=true` e, opcionalmente, `STORY_URL`. O script reutiliza a preparação completa e a confirmação do Link Sticker. Retoma sem aplicar outro sticker somente quando a detecção confirmar um objeto de sticker visível no canvas com evidência específica de Link. Domínio isolado fora do objeto aplicado não confirma o estado.

Salva `publish-ready.xml`, `publish-ready.png`, `publish-ready.json` e `summary.json` em `artifacts/publish-ready-<timestamp>/`. Procura primeiro o resource-id já confirmado `com.instagram.android:id/your_story_share_shortcut_button`, depois accessibility id e texto exatos `Your story`. Registra resource-id, content-desc, text, class, clickable e enabled do elemento observado. Duplicidade aborta com diagnóstico. Também lista Close Friends, Next e candidatos de seta presentes na hierarquia, sem inventar IDs e sem clicar.

`ALLOW_PUBLISH=false` é o padrão no exemplo de ambiente. A trava `assertPublishAllowed` rejeita qualquer valor diferente de `true` exato e registra `[SAFE] Publicação bloqueada.`; deverá ser usada por qualquer futura operação de publicação. **Esta etapa não implementa nenhum clique de publicação, mesmo com `ALLOW_PUBLISH=true`.** O script para no editor, preserva login e dados e encerra somente a sessão Appium. Se houver erro, salva `error.xml/png/json`. Os seletores realmente presentes nessa instalação serão registrados no terminal e no resumo durante a execução local.

O publish-ready usa a mesma detecção de `STATE_EDITOR_WITH_LINK` da máquina compartilhada: editor ativo e Link Sticker aplicado confirmado no canvas. Nesse estado não reabre Stickers, não preenche URL e segue para inspeção dos controles. Holder vazio e botão Your story não são prova. Sticker genérico já aplicado, sem tipo verificável, bloqueia reaplicação; requer revisão do diagnóstico. O resumo registra `visible-canvas-link-evidence` como fonte da confirmação.

### Validar o clique em LINK

A transição Stickers → Link Editor busca exatamente um elemento por accessibility id `Link Sticker`, verifica identidade (`content-desc` e resource-id confirmado), displayed, enabled e elementId real, e registra clickable, class e bounds. O clique principal usa `session.execute('mobile: clickGesture', { elementId })`, sem coordenadas, índice fixo ou XPath. Salva `click-link-before.xml/png/json` e `click-link-after.xml/png/json` antes e depois do gesto.

Consulta diretamente `link_sticker_list_web_url_edit_text`, `link_sticker_list_done_button` e `link_sticker_list_title` por até cinco segundos. Qualquer um presente confirma a transição; o gesto enviado sozinho não comprova navegação. `element.click()` é usado apenas após falha técnica do comando nativo e reconsulta do LINK, nunca simplesmente porque o gesto não navegou. Uma conexão perdida aborta sem tentar outro clique.

Se ainda não houver navegação, pode tentar uma única vez um descendente visual `android.widget.ImageView`, encontrado por busca relativa ao Link Sticker revalidado. Só permite essa tentativa quando existe exatamente um descendente visível, habilitado e com elementId, comprovando o vínculo pelo pai real. Descendentes ausentes ou ambíguos não recebem clique. O gesto no descendente também usa somente elementId e salva capturas antes/depois. Se não abrir o Link Editor, salva `click-link-failed.xml/png/json`, registra os atributos e aborta. Artefatos ficam em `artifacts/click-link-<timestamp>/` ou no diretório do smoke de inspeção. URL, Done, retorno ao editor e trava de publicação permanecem nos módulos existentes.

### Estado compartilhado de editor com link aplicado

`detectInstagramState` retorna `STATE_EDITOR_WITH_LINK` somente com editor ativo e `hasAppliedLinkSticker()` positivo. Exige objeto reposicionável dentro de um canvas real observado, displayed, bounds válidos, correspondência com o elemento vivo e identificação positiva de Link/URL no próprio objeto. Holder, texto isolado ou controles de configuração não confirmam aplicação. Sem prova, retorna `STATE_EDITOR`; se existir sticker genérico aplicado, uma guarda impede abrir Link novamente sobre esse rascunho.

Em `smoke:story-link-apply`, esse estado resulta em sucesso idempotente: `[LINK] sticker já aplicado` e `[OK] nenhuma alteração necessária`. Não abre Stickers, não preenche URL, não clica Done nem chama a navegação do Link Editor. O resumo registra `alreadyApplied=true`, `doneClicked=false` e a URL solicitada, sem alegar que releu o campo. `smoke:story-link-fill` também impede reentrada nesse estado e orienta usar publish-ready. `smoke:story-publish-ready` reutiliza a detecção compartilhada e inspeciona diretamente os controles finais; mantém capturas e bloqueio de publicação. `ALLOW_PUBLISH=false` permanece no exemplo; nenhum script desta etapa publica, inclusive se a variável for habilitada.

### Publicação real controlada (comando separado)

Com o Story visualmente conferido e já em `STATE_EDITOR_WITH_LINK` no Windows local:

```powershell
$env:ALLOW_PUBLISH="true"
$env:CONFIRM_REAL_PUBLISH="YES"
npm run smoke:story-publish-real
```

São necessários os dois valores **exatos**. Sem ambos, registra `[SAFE] Publicação bloqueada` e encerra antes de conectar ao Appium. O exemplo de ambiente permanece desarmado (`ALLOW_PUBLISH=false`, `CONFIRM_REAL_PUBLISH=NO`). `DRY_RUN` não é alterado; neste comando dedicado as duas travas explícitas autorizam a publicação real. Os comandos de inspeção continuam sem publicar.

O comando exige o editor final existente, holder aplicado e Your story, sem refazer imagem ou link. Revalida classe `android.widget.Button`, content-desc `Your story`, resource-id `com.instagram.android:id/your_story_share_shortcut_button`, displayed, enabled e clickable. Salva `pre-publish.xml/png/json`, revalida editor/botão e as duas travas, e envia uma única chamada de protocolo `elementClick` ao elementId confirmado. Usa o cliente existente com `connectionRetryCount=0`, evitando também a reconsulta/retry de clique do wrapper de elemento. Após o clique não toca em nenhum outro controle.

Após o único clique, registra `PUBLISH_PENDING_CONFIRMATION` e observa por até 15 segundos. Salva `pre-publish.xml/png/json`, `immediate-post-click.xml/png/json`, `post-publish-5s.xml/png/json`, `post-publish-10s.xml/png/json` e `post-publish-15s.xml/png/json`. Os tempos são alvos; comandos Appium/capturas podem atrasar a coleta, e cada observação registra o tempo real. Não encerra a análise só porque voltou à Home. Também lê a hierarquia entre capturas para coletar mensagens transitórias.

`verifyPublishedStory()` avalia somente evidências novas desta janela em relação ao estado anterior. Retorna `SUCCESS` para uma mensagem específica nova de confirmação de envio do Story; `FAILURE` para erro explícito de envio sem confirmação contraditória; `INCONCLUSIVE` para Home isolada, Story anterior, indicador de upload, novo ID genérico, timeout, ausência de confirmação ou sinais contraditórios. A confirmação de envio pela interface não comprova igualdade visual do conteúdo no servidor: `content_identity_verified=false` permanece explícito. A função não abre Stories nem clica e conserva candidatos não verificados apenas para diagnóstico. Sem mensagem inequívoca, é necessária conferência manual do conteúdo recém-enviado.

O resumo inclui `job_id` UUID e `media_id` único da tarefa/rascunho, formado pelo job e SHA-256 da hierarquia antes do clique, com `media_identity_source=editor-hierarchy-snapshot`. Esse fingerprint não é apresentado como hash da mídia original e não associa automaticamente Stories antigos ao job. `pending-publication.json` conserva a tarefa e a proibição de retry; `publication-observations.json` conserva a sequência completa das hierarquias e tempos. Todos ficam na pasta ignorada `artifacts/publish-real-<timestamp>/`.

Nenhum resultado provoca novo clique, inclusive timeout ou erro de transporte. Código de saída 2 indica `INCONCLUSIVE`/`FAILURE` ou falha de captura, sem autorizar nova execução automática. Confira manualmente seu Story antes de decidir outra tentativa. As duas travas, o clique único e o fluxo de Link Sticker permanecem preservados.

### Diagnóstico Facebook Story (sem publicar)

Com o Instagram já na tela final do editor, execute localmente `npm run inspect:facebook-share-ready`. O comando não navega, não altera toggles, não clica e não publica. O fluxo principal de publicação permanece igual.

Salva `facebook-share-ready.xml/png/json` em `artifacts/facebook-share-<timestamp>/`. O JSON registra `facebook_story_available`, `facebook_story_enabled`, `facebook_story_state_known`, status e atributos reais dos elementos relacionados a Your story, And Facebook Story e Facebook Story: resource-id, content-desc, text, class, checked, selected, enabled e clickable. IDs não são inventados; seletores listados derivam somente dos atributos encontrados localmente.

Texto sozinho prova apenas disponibilidade. Ativação exige checked em switch/checkbox/radio/toggle, ou selected em controle real associado ao Facebook. A associação usa o próprio nó rotulado, seus controles descendentes ou um toggle irmão numa linha exclusivamente Facebook. Estado do botão Your story, TextView selecionado e controles em outros blocos não são tratados como confirmação. Se o estado não estiver exposto ou for ambíguo, `facebook_story_enabled=false` vem acompanhado de `facebook_story_state_known=false`; isso **não comprova desativação** e pede inspeção dos artefatos.

O contrato futuro `src/config/StoryJob.ts` e o exemplo `assets/story-job.example.json` incluem `image`, `story_url`, `sticker_text`, `publish_instagram` e `publish_facebook`. Esses campos são intenção futura do job, não autorização de publicação ou alteração de configuração. Nenhum job é executado nesta etapa. Compartilhamento simultâneo será validado em comando separado posteriormente.

### Preparar novo Story com dados externos (sem publicar)

Com Instagram, Appium e emulador locais disponíveis, execute no CMD:

```cmd
set DRY_RUN=true
set ALLOW_PUBLISH=false
set CONFIRM_REAL_PUBLISH=NO
set STORY_MEDIA=C:\caminho\imagem-do-job.jpg
set STORY_URL=https://plantaorio.com.br/materia-x
set STICKER_TEXT=Leia a matéria completa
set JOB_ID=job-origem-001
npm run smoke:story-prepare
```

`STORY_MEDIA` (ou alias legado `STORY_IMAGE`), `STORY_URL` e `STICKER_TEXT` são obrigatórios, sem conteúdo padrão. Resolve o arquivo físico e identifica tipo por assinatura antes de conectar ao Appium; preserva URL/texto e bytes da mídia. `JOB_ID` é opcional; gera UUID somente para identidade quando ausente. O contrato `StoryJob` inclui job_id, media (objeto normalizado), media_sha256, story_url, sticker_text, publish_instagram e publish_facebook; este smoke registra os dois destinos como false e não chama publicação, mesmo com travas habilitadas.

Antes de preparar a tarefa, normaliza o Instagram até Home, voltando de estados residuais conhecidos e descartando somente draft local comprovado. Envia uma nova cópia da imagem, valida que é a mídia mais recente correspondente ao arquivo fornecido e exige uma seleção nova na galeria Recents antes de aplicar o link. Se a Home retomar diretamente um editor anterior, aborta sem reutilizar esse Story.

Após conferir a URL, abre o controle **já observado** `com.instagram.android:id/link_sticker_custom_cta_row`. Salva `link-before-custom-cta.xml/png/json` e `custom-cta.xml/png/json`. O campo personalizado ainda não tem resource-id confirmado no cloud: deriva o seletor apenas da hierarquia local após expandir custom CTA, exigindo exatamente um EditText fora do campo URL e um resource-id ou content-desc observável. Ausência/ambiguidade aborta com diagnóstico, sem inventar seletor. O seletor real escolhido aparece no terminal e em `summary.json`.

Preenche STICKER_TEXT e lê o valor para igualdade exata; revalida que a URL não mudou e só então clica Done uma vez. Exige `STATE_EDITOR_WITH_LINK` e salva `story-prepared.xml/png/json` em `artifacts/story-prepare-<timestamp>/`, além do resumo com dados externos, hash da mídia e selector observado. Campos não verificáveis ou erro salvam `error.xml/png/json` e abortam. Não abre qualquer controle de publicação, preserva login/mídia e mantém o editor final aberto ao encerrar somente a sessão Appium. Cada nova execução normaliza novamente até Home; não reaproveita o Story desta execução.


### Normalização obrigatória no início de cada job novo

`normalizeInstagramToHome(driver, directory)` é a entrada reutilizável para tarefas novas. `prepareNewStory()` a executa obrigatoriamente antes de preparar imagem ou link; o smoke valida os parâmetros externos antes de conectar. A futura fila deverá chamar essa mesma preparação para cada job, inclusive jobs com publicação ao final. A publicação isolada de um editor já preparado continua sendo uma etapa posterior do mesmo job; não descarta o rascunho que deve publicar.

Para testar somente essa rotina no Windows, com Appium e emulador disponíveis, execute `npm run smoke:instagram-reset-home`. O comando abre Instagram preservando login e executa apenas `normalizeInstagramToHome()`: não inicia Story, seleciona imagem, abre Stickers ou publica. Pode descartar um draft local somente segundo as verificações seguras da rotina. Salva `reset-before.xml/png/json` e `reset-final.xml/png/json`, além das capturas intermediárias, em `artifacts/instagram-reset-home-<timestamp>/`. Sucesso registra `[OK] Instagram normalizado para Home`; falha registra `[FAIL] Não foi possível normalizar para STATE_HOME`, o erro completo e retorna código diferente de zero. Encerra apenas a sessão Appium. Não exige parâmetros de imagem, URL ou texto de sticker.

Detecta Home, Editor, Editor com Link, Stickers, Link Editor, Galeria, Criação e Share identificável por seus rótulos reais. Executa no máximo cinco comandos Back, sem logout, reset de dados, clear storage/cache, manipulação de conta, coordenadas ou XPath. Chegando à Home, espera dois segundos, captura uma nova hierarquia e confirma novamente; só então registra `[JOB] iniciando novo Story`. Diálogo/tela desconhecidos, saída do Instagram, falta de estabilização ou limite de passos abortam sem começar a tarefa.

Diálogos de descarte são analisados dentro do próprio ramo da hierarquia (classe Dialog ou container dialog/alert observado). Só descarta com evidência explícita de Story/draft local, como Save draft junto a Discard, sem sinais de exclusão de conteúdo publicado. O seletor é derivado do resource-id/content-desc/text realmente presente e exige controle único, visível, enabled e clickable; não usa índices. Revalida o diálogo antes do clique e não repete descarte que não fechou a tela. Diálogos genéricos ou ambíguos abortam e precisam de inspeção local. Nenhum resource-id de descarte foi inventado.

Salva `reset-before.xml/png/json`, `reset-step-<n>.xml/png/json`, `reset-final.xml/png/json` e `normalization.json` com o histórico de ações. Diálogos comprovados têm capturas `discard-dialog-<n>.xml/png/json`; falhas salvam `normalize-error.xml/png/json`. Mantém login, sessão e mídia do emulador. Rascunhos locais comprovados podem ser descartados conforme esta regra; Stories publicados não são excluídos.


A confirmação de Home na normalização usa prioridade Link Editor → Stickers → Share → Editor com Link → Editor → Galeria → Criação → Home. Home exige pelo menos dois grupos de sinais reais: cabeçalho `For you`; controle `action_bar_left_button` ou atalho `reel_empty_badge` com `Add to story`; linha da própria conta com `username`/`Your story` e `reel_empty_badge`. `feed_tab`, `profile_tab`, `tab_bar` e wrappers não são provas de Home.

A presença de IDs de Link Editor, stickers, holder aplicado, botão Your story, controles post_capture/editor, galeria ou criação bloqueia Home. Também bloqueiam descrições/controles de Your story, Close Friends, Share to, Next, Aa, Stickers e Music. O texto `Your story` na thumbnail da Home é distinguido do botão de publicação; ele não basta sozinho. Nós explicitamente ocultos e seus descendentes não contam como sinais positivos.

Após cada Back, faz probes de transição por até dois segundos e salva a captura do passo. Se a tela mudar durante a estabilização de Home, continua a normalização respeitando os limites; não registra sucesso antecipado. Só conclui após duas leituras separadas por dois segundos e uma verificação adicional após `reset-final`, registrando `[RESET] estado visual final confirmado: STATE_HOME`. O resumo conserva sinais positivos e blockers. Sem confirmação, não inicia o job.

### Abrir somente a criação de Story

No Windows, execute `npm run smoke:open-story` com `DRY_RUN=true`, Appium e emulador disponíveis, após `npm run smoke:instagram-reset-home`. Exige Home real e não seleciona imagem, abre Stickers ou publica. A rota tradicional usa Create; a variante atual usa somente o botão exato `Add to story`.

Nesta variante, tenta um clique normal, depois um descendente visual/clicável inequivocamente pertencente ao botão (somente se houver um único candidato e seletor nativo único), um único `mobile: clickGesture` no centro dos bounds atuais comprovados do botão e, se ainda permanecer na Home, um único native ADB tap com bounds relidos. Não usa coordenadas fixas, XPath ou índice. Detecta o estado após cada tentativa e só continua os fallbacks enquanto permanecer na Home. Estados desconhecidos abortam. Salva `add-story-before.xml/png/json` e `add-story-click-1/2/3/4.xml/png/json` para as tentativas efetivamente executadas. Registra os atributos reais do controle no terminal; sem hierarquia/bounds confiáveis, cancela o gesto. O comando mantém a tela inicial de criação aberta e encerra apenas a sessão Appium.

### Diagnosticar abertura após injeção de mídia

`smoke:open-story` e `smoke:story-prepare` usam a mesma entrada `openStoryFromHome(driver, directory)`, preservando os seletores e a interação validados. A preparação usa `injectMediaAndOpenStory()` para enviar a imagem antes dessa entrada; a seleção da miniatura só ocorre depois. O smoke isolado com mídia usa exatamente essa mesma sequência.

Após `push` e `MEDIA_SCANNER_SCAN_FILE`, a POC consulta o MediaStore por até 15 segundos, com intervalo de 500 ms. Exige `_display_name` exato desta tarefa, `relative_path` correspondente a `Pictures/PlantaoRio/` e `_size` igual ao arquivo local quando disponível. Não compara `_data` com `/sdcard`, pois o Android pode canonicalizar o caminho. O término do broadcast, sozinho, não confirma scan. No timeout, solicita um único novo scan (usando o caminho canonicalizado quando disponível) e faz um segundo ciclo de até 15 segundos, sem recopiar. Falta de confirmação ou erro de provider aborta. Depois aguarda dois segundos, salva `media-home-stabilized.xml/png/json`, reconfirma Home real e adquire novamente `Add to story`. Cada fallback lê nova hierarquia e adquire novo botão; bounds/elementId de tentativas anteriores não são reutilizados.

Para reproduzir somente essa diferença no Windows, configure `DRY_RUN=true`, forneça `STORY_MEDIA` (imagem local reconhecida; `STORY_IMAGE` é alias) e execute `npm run smoke:open-story-with-media`. Exige Home antes do envio; use o reset isolado primeiro se necessário. Não requer URL/texto de sticker, não seleciona imagem e não publica. Envia para `/sdcard/Pictures/PlantaoRio/`, confirma scan, estabiliza Home e abre criação. Na Home antiga, abre a opção STORY para chegar à galeria. Exige `STATE_GALLERY`, salva `story-gallery.xml/png/json` em `artifacts/open-story-with-media-<timestamp>/` e registra `[OK] Story creation opened after media injection`. Erros salvam `error.xml/png/json`. A rotina de normalização, Link e publicação permanece inalterada.


### Indexar somente a mídia

Com o emulador local `emulator-5554` e ADB disponíveis, sem precisar iniciar Appium ou Instagram:

```bat
set DRY_RUN=true
set STORY_MEDIA=C:\caminho\imagem.jpg
npm run smoke:media-index
```

O comando resolve/detecta a imagem por assinatura, copia uma única vez para `/sdcard/Pictures/PlantaoRio/`, solicita `MEDIA_SCANNER_SCAN_FILE` e usa a mesma função `prepareAndIndexMedia()` chamada por `StoryLinkPublisher.prepareMedia()` (nomes antigos permanecem como aliases) no `smoke:open-story-with-media` e na preparação do Story. Não abre Instagram nem cria ou publica Story.

Consulta real executada no Android por ADB (nome gerado internamente, não valor interpolado da origem):

```sh
content query --uri content://media/external/images/media --projection _id:_display_name:relative_path:_size:_data --where "_display_name='plantao-story-<timestamp>.jpg'"
```

A sintaxe e a projeção são verificadas pelas respostas do provider durante a execução local: se o Android reportar coluna opcional `_data` ou `_size` inválida, ela é removida e a consulta é refeita. `_display_name` e `relative_path` continuam obrigatórios. Erros de provider, permissões ou sintaxe são registrados e abortam. Timeout de uma consulta individual é registrado e permite continuar o polling dentro do deadline. A comparação de tamanho é obrigatória quando retornado; arquivo de outra tarefa, outra pasta ou linhas ambíguas não confirmam sucesso.

Salva `artifacts/media-index-<timestamp>/media-index.json` tanto no sucesso quanto na falha após validação da imagem: nome, caminho Android e canonicalizado, tamanho, identidade confirmada, consultas/comandos com stdout/stderr, tentativas, scans solicitados e tempo total. Limite de polling: 15 segundos por ciclo, 500 ms entre probes; apenas um scan adicional, até dois ciclos. Copy/broadcast e outros comandos ADB têm seus próprios timeouts. O smoke registra `[OK] mídia indexada e confirmada no MediaStore` somente após evidência da mídia deste job. Os comandos Android reais devem ser validados no computador local; os testes cloud simulam suas respostas.


### Native tap e comparação de foco na Home

Após as tentativas anteriores sem transição, reacquire o botão exato `Add to story`, exige displayed/enabled/clickable, valida a classe e o package atual `com.instagram.android` e compara os bounds do elemento com uma nova hierarquia. Calcula `x = floor((left + right) / 2)` e `y = floor((top + bottom) / 2)`. Executa `adb -s <UDID efetivo da sessão Appium> shell input tap <x> <y>` com argumentos separados, sem coordenadas fixas ou serial padrão. Não repete o native tap, inclusive se o comando apresentar timeout. Verifica a transição e salva `add-story-click-4.xml/png/json` e `native-adb-tap.json`. Home persistente ou estado não comprovado aborta; somente Criação/Galeria/Editor conhecidos confirmam abertura.

Os dois smokes salvam automaticamente `add-story-before-context.json/xml`, com currentPackage, currentActivity, bounds, elementId, hierarquia/hash e dados de foco obtidos via `adb shell dumpsys window`. Foco/activity indisponíveis são registrados como erro de diagnóstico, sem valores inventados. Antes da última tentativa salva também `add-story-native-before-context.json/xml`.

Depois de executar os dois smokes localmente, compare suas capturas (substitua as pastas pelos caminhos exibidos no terminal):

```sh
npm run compare:story-open -- artifacts/open-story-<timestamp>/add-story-before-context.json artifacts/open-story-with-media-<timestamp>/add-story-before-context.json
```

A comparação não conecta ao emulador nem envia interação. Exibe diferenças em pacote, activity, foco, bounds, elementId e hash da hierarquia e salva `artifacts/story-open-comparison-<timestamp>.json`. IDs podem variar entre sessões; diferenças de foco/hierarquia sozinhas não provam a causa. A investigação das diferenças reais depende das capturas locais. Normalização, MediaStore, `openStoryFromHome()`, Link e publicação não foram modificados por este fallback.


### Inspecionar somente a distinção Editor / Editor com Link

Com Appium iniciado e Instagram já no editor, execute `npm run smoke:inspect-editor-link-state`. Não abre/ativa o app, não navega, não preenche campos, não clica nem publica. Salva `editor-link-state.xml/png/json` e `link-detection.json` em `artifacts/inspect-editor-link-state-<timestamp>/`; registra candidatos, resource-id, content-desc, displayed, bounds e `applied=true/false`.

Critérios: editor ativo, objeto aplicado no canvas observado (`capture_interactive_drawable_container` ou `post_capture_interactive_contents_container`), bounds dentro do canvas, nó/ancestrais não ocultos e confirmação do elemento vivo com mesmos bounds/descrição. O objeto deve identificar Link Sticker ou expor domínio/URL em texto/descrição. Uma palavra “link”, resource-id, holder vazio, URL fora do objeto, elemento oculto ou stale não bastam. A descrição real `Sticker. Touch and hold to reposition. Use two fingers to rotate or resize.` comprova apenas um sticker genérico; sem identificação do tipo Link, `applied=false` e `unconfirmedAppliedSticker=true`, bloqueando reaplicação automática.

O XML anterior fornecido tem um holder vazio e um objeto aplicado com essa descrição genérica, mas não expõe URL/tipo Link. Por isso ele não permite confirmação inequívoca de Link pela hierarquia, mesmo quando visualmente aplicado. O novo diagnóstico preserva screenshot para revisão. A pasta local `story-prepare-1791661052722/` não está disponível no workspace cloud; o diagnóstico deve ser executado localmente tanto no editor só com imagem quanto após aplicar Link. Os testes positivos modelam uma interface que expõe evidência de Link no objeto aplicado; não representam seletores descobertos no emulador. Não há inferência pelo texto impresso na imagem ou relaxamento de travas de publicação.

### Rota alternativa pelo botão Create/+

`npm run smoke:open-story-via-create` normaliza o Instagram para Home, abre
Create/+, identifica Story e para na galeria. Exige `DRY_RUN=true`; não seleciona
imagem, não adiciona stickers e não publica.

No XML real da Home fornecido, o + aparece como um único `android.widget.ImageView`
clicável, sem descrição ou resource-id próprios, dentro de
`com.instagram.android:id/action_bar_buttons_container_left`, na barra
`com.instagram.android:id/main_feed_action_bar`. A rota usa o seletor nativo do
container combinado com `childSelector` de ImageView clicável, validando unicidade,
visibilidade, habilitação e atributos atuais. Não usa coordenadas ou XPath.

Após o clique, a rota aceita a galeria ou procura o resource-id já confirmado
`com.instagram.android:id/cam_dest_story`. Um menu diferente só pode ser utilizado
quando a hierarquia atual comprovar opções de criação e uma única opção Story
clicável, com seletor nativo observado. Menu desconhecido ou ambíguo aborta.

`openStoryFromHome()` mantém Add to story como primeira opção quando disponível.
Somente após esgotar suas tentativas e reconfirmar a Home real executa esta mesma
rota alternativa. Nenhuma rotina de mídia, normalização, Link ou publicação muda.
As capturas `create-route-home`, `create-route-after-plus`, `create-route-gallery`
e `create-route-error`, além de `create-route.json`, ficam na pasta de artifacts da
execução. A tela real exibida após + e o resultado precisam ser validados no Windows;
os testes cloud usam sessões simuladas.

A rota Create também reconhece `STATE_STORY_CAMERA`: STORY selecionado e evidência
visível de captura ou da mensagem de acesso à câmera/microfone com Open Settings.
Ela não abre configurações nem concede permissões. Antes de tentar abrir a galeria,
salva `create-route-story-camera.xml/png/json`. O controle de galeria é descoberto
pelos atributos da hierarquia atual (label inequívoco de galeria), preferindo seu
resource-id observado, depois accessibility id ou texto. Sem controle identificável
ou com ambiguidade, aborta com diagnóstico; não presume resource-ids de miniaturas.
O smoke só encerra com sucesso em STATE_GALLERY, incluindo a transição intermediária
STATE_STORY_CAMERA quando necessária. O seletor real desta variante precisa ser
confirmado na execução local; exemplos dos testes são simulados.

Quando o Instagram expõe somente a descrição genérica de objeto reposicionável,
`story-prepare` confirma o Link por continuidade da operação do job atual. O editor
precisa estar limpo no início; URL e CTA são lidos e conferidos antes de Done. Após
Done e retorno ao editor, exige exatamente um novo objeto do canvas, visível também
nos dados vivos do Appium e com bounds válidos. A confirmação é vinculada à sessão,
job_id, URL, CTA e objeto observado, somente em memória. Novo job, nova sessão ou
perda do objeto invalidam a confirmação; nenhum arquivo ou variável a restaura.

`smoke:inspect-editor-link-state` continua sem cliques ou navegação. Executado em
outro processo, não herda a transação do smoke anterior: um sticker genérico sem
URL/tipo exposto permanece não confirmado. Para essa variante, a prova automática
é a inspeção feita no mesmo processo de `smoke:story-prepare`. Não é seguro marcar
um sticker de execução anterior como Link apenas pela descrição genérica.

Na normalização, `STATE_DISCARD_PHOTO_DIALOG` é reconhecido somente quando um
mesmo diálogo visível contém exatamente um título `Discard photo?`, um controle
`Discard` e um controle `Keep editing`, sem evidência de conteúdo publicado/exclusão.
Usa o resource-id ou accessibility id observado do botão; sem eles, texto exato
`Discard`. Valida unicidade, visibilidade, enabled/clickable e label vivo antes de
um único clique. Nunca escolhe Keep editing. Salva `discard-dialog-N.xml/png/json`
antecedendo o clique e `discard-photo-after-N.xml/png/json` após a transição. Se o
diálogo persistir, aborta sem repetir. Diálogos desconhecidos continuam bloqueados;
a Home mantém sua confirmação estrita e estabilização antes de iniciar o job.

### Preparação e publicação real no mesmo processo

Para o teste completo use somente `npm run smoke:story-end-to-end-real` no Windows,
com Appium e o emulador disponíveis. Configure no mesmo terminal:

```bat
set DRY_RUN=true
set STORY_MEDIA=C:\caminho\imagem.jpg
set STORY_URL=https://plantaorio.com.br/materia-x
set STICKER_TEXT=Leia a matéria completa
set ALLOW_PUBLISH=true
set CONFIRM_REAL_PUBLISH=YES
npm run smoke:story-end-to-end-real
```

`JOB_ID` pode vir da plataforma; sem ele é gerado um UUID antes da preparação.
O comando valida os três parâmetros antes de conectar, normaliza a Home, envia a
imagem, cria um Story novo e confirma URL/CTA/Done e objeto visual do job. Reutiliza
`prepareNewStory` e `publishStoryOnce`, sem subprocessos ou reconexão. Publicação só
ocorre depois da confirmação em memória e das duas travas exatas. Sem travas, a
preparação pode terminar, mas o clique de publicação é bloqueado.

A publicação exige transação viva do job nesta sessão inclusive no comando antigo
`smoke:story-publish-real`; um editor deixado por outro processo não autoriza envio,
mesmo se houver URL/tipo exposto na hierarquia. O job_id original e SHA-256 da mídia
são usados no resultado e em `pending-publication.json`. O fingerprint do editor
permanece disponível nas observações e não substitui o hash da mídia.

Após um único clique registra `PUBLISH_PENDING_CONFIRMATION`, coleta observações
por até 15 segundos e salva `pre-publish`, `immediate-post-click`,
`post-publish-5s`, `post-publish-10s`, `post-publish-15s` (XML/PNG/JSON), além do resumo.
SUCCESS exige mensagem nova e específica de envio/publicação de Story durante
esta tentativa, ausente antes do clique. Home, Story antigo, anel do perfil, novo
resource-id ou indicador de upload isolados não confirmam envio. Ausência de
confirmação, timeout ou sinais contraditórios dão INCONCLUSIVE; erro explícito de
envio dá FAILURE. Não há nova tentativa automática. A confirmação de envio não
alega identificação visual/servidor do conteúdo (`content_identity_verified=false`).
Não execute novamente sem conferir localmente uma tentativa inconclusiva.

Durante a publicação real já autorizada, o modal com título exato
`Share your stories to Facebook too` e controles únicos `Always share stories` e
`Not now` é reconhecido como `STATE_FACEBOOK_STORY_SHARING_PROMPT`, antes de sinais
do editor atrás. O fluxo permite um único clique em Always share stories usando
resource-id observado, accessibility id ou texto exato. Não há coordenadas nem
resource-id presumido. Revalida modal, atributos vivos e as duas travas antes do
clique; mantém o mesmo job, mídia e PUBLISH_PENDING_CONFIRMATION. Nunca repete
Your story. Se o prompt não aparecer, a confirmação normal continua.

Salva `facebook-sharing-prompt-before.xml/png/json`,
`facebook-sharing-prompt-after.xml/png/json` e `facebook-sharing-continuation.json`.
A transição deve ocorrer em até cinco segundos, dentro da janela de observação da
publicação; falha técnica, ambiguidade, prompt persistente ou diálogo desconhecido
mantêm INCONCLUSIVE sem novo clique. `facebook_crosspost_enabled=true` só indica
que a UI aceitou a escolha permanente; não comprova publicação/entrega no Facebook.
Sem prompt/aceitação verificável, o campo fica null (estado não comprovado).
`link_transaction_at_publish` registra a confirmação e vínculo do job no instante
da publicação, somente para auditoria; nunca restaura autorização em outro processo.
A mensagem positiva de envio desta tentativa continua obrigatória para SUCCESS.

### Situação dos gestos de layout

Layout está reintegrado após a validação real, usando resize nativo e posição W3C
sequenciais. O experimento W3C anterior está preservado como código, mas não é
chamado pelos fluxos atuais. O plano de pinch com dois pointers sincronizados permanece apenas como experimento histórico;
`smoke:sticker-resize` testa somente uma pinça isolada, após movimento comprovado localmente.
Nenhum teste isolado restaura transação Link de outro processo ou autoriza publicação.

### Teste atual: movimento W3C com hold explícito e cinco passos

Deixe o editor com um único sticker visível e execute no Windows:

```bat
set DRY_RUN=true
npm run smoke:sticker-move
```

O comando não usa ADB swipe, dragAndDrop, resize, criação de Story ou publicação.
Resolve o centro pelos bounds frescos do único objeto visual vivo no canvas atual,
calcula destino até 250 px à esquerda, mantendo Y, e limita o endpoint à margem de
2% do canvas. Se a área segura não permitir pelo menos 20 px de percurso, aborta antes do gesto.

Envia UMA sequência W3C com `pointerType=touch`: pointerMove(start), pointerDown,
pause(900 ms), cinco pointerMove a 20/40/60/80/100% do percurso (200 ms cada),
pause(150 ms), pointerUp. Não solta entre os passos e não consulta hierarchy durante
o contato. Libera actions em finally também se houver erro técnico. Espera 1000 ms
após o gesto e só então recaptura XML/PNG/JSON e relê os bounds do mesmo objeto.

`moved=true` aceita abs(deltaX)>=20 px OU chegada nova à borda esquerda compatível com a direção solicitada (`LEFT_BOUNDARY_CLAMP`). Estar parado na borda não conta. Não exige layout final. Falha ou timeout
abortam sem repetição/alternativa. Logs `[MOVE-W3C]` incluem before, start, hold,
cada passo, after e delta real. Capturas `move-test-before`, `move-test-after`,
`move-test-error` e JSON `move-test.json` ficam na pasta artifacts da execução.
O experimento ADB está preservado como código, mas não é chamado pelo smoke atual.
O movimento W3C foi validado pelo usuário no emulador real (deltaX=-64, left=0). O resize ainda precisa de validação local; nenhum ajuste está reintegrado ao fluxo completo.

### Teste isolado de resize nativo UiAutomator2

Com o sticker já aberto no editor e DRY_RUN=true, execute:

```bat
npm run smoke:sticker-resize
```

Usa WebdriverIO `session.execute('mobile: pinchCloseGesture', { left, top, width,
height, percent: 0.50 })`, com área derivada dos bounds vivos do único sticker no
canvas. Não usa elementId presumido ou W3C multi-pointer. A sintaxe e parâmetros
foram conferidos no execute-method-map e implementação da versão instalada de
appium-uiautomator2-driver. Não move, não cria Story, não altera URL/CTA e não publica.

Depois espera 1000ms, recaptura XML/PNG/JSON, localiza o mesmo objeto e calcula
width_after/width_before. `resized=true` exige redução de pelo menos 10%. Se houver
redução excessiva, para sem corrigir. Se houver qualquer alteração dos bounds mas
redução insuficiente, também para sem corrigir. SOMENTE bounds totalmente iguais
após a primeira tentativa permitem uma segunda, com percent=0.75 e área relida.
Erro técnico/timeout nunca dispara retry; não há terceira tentativa/estratégia.

Logs `[RESIZE-NATIVE]` registram bounds, área, percent, larguras e scale_ratio.
Salva `resize-test-before`, `resize-test-after-1/2`, `resize-test-after`,
`resize-test-error` (XML/PNG/JSON) e `resize-test.json` com todas as tentativas.
O movimento W3C validado permanece intacto; o fluxo completo reutiliza este resize quando necessário.

### Posicionamento final isolado, mantendo o tamanho aprovado

O usuário validou `pinchCloseGesture` no emulador: width696 -> width529
(scale_ratio≈0.7601). Não altera percent, alvo de escala ou implementação de resize.

Com o sticker atual no editor e DRY_RUN=true, execute:

```bat
npm run smoke:sticker-final-position
```

Usa centro alvo relativo ao canvas: `TARGET_STICKER_CENTER_X=0.303` e
`TARGET_STICKER_CENTER_Y=0.593` (ajustáveis por essas variáveis). Calcula destino
seguro com a largura/altura ATUAL e margem de 0.2% do canvas. Se o destino seguro
não puder atingir o alvo com tolerância de ±4% do canvas por eixo, aborta sem resize.
Se o centro atual já satisfizer a tolerância, salva evidências e termina sem gesto.
Isso é esperado para bounds [83,1094][612,1182] em canvas [0,0][1080,1920].

Fora da tolerância, executa somente um drag usando exatamente o W3C validado:
hold900ms + cinco passos200ms + pause150ms + pointerUp. Espera 1000ms e relê o mesmo
objeto. Confirma posição e verifica que o tamanho ficou preservado (tolerância de
arredondamento). Não executa pinch, seleção, preparação, URL/CTA, Facebook ou clique
de publicação. Falha/timeout não geram outra estratégia. O fluxo completo reutiliza este posicionamento somente quando necessário, após validar o tamanho.

Logs `[FINAL-POSITION]` mostram before, center_before, target_center, after,
center_after, delta e position_ok. Salva `final-position-before`,
`final-position-after`, `final-position-error` (XML/PNG/JSON) e
`final-position.json`. Nenhuma confirmação de job anterior é restaurada neste smoke.

### Layout reintegrado ao mesmo job antes da publicação

`smoke:story-prepare` e `smoke:story-end-to-end-real` agora seguem preparação nova
-> Link/URL/CTA/Done -> confirmação de transação -> resize nativo (se necessário)
-> validação de tamanho -> posição W3C (se necessário) -> validação final.
Reutilizam exatamente `testCurrentStickerResize` e `positionCurrentSticker`, com
percent0.50/0.75 e W3C900ms+5x200ms já validados. Não chamam o antigo ajuste combinado.

O tamanho aprovado é 529x88 para canvas1080x1920, convertido em proporções do canvas
atual, com tolerância de 8% por dimensão. Centro relativo0.303/0.593 e tolerância4%
por eixo continuam os do smoke final. Tamanho já aprovado não recebe pinch; posição
já aprovada não recebe drag. Uma escala excessiva ou ainda inválida após o pinch
para a preparação, sem nova estratégia ou compensação. Referência de tamanho está
em `approvedStickerLayout.ts`; TARGET_STICKER_WIDTH/HEIGHT antigos não são usados
como autorização de tamanho neste fluxo.

A confirmação geométrica é renovada somente para o mesmo objeto do job/sessão,
após cada operação. `layout_confirmed=true` fica somente em memória, com fingerprint
do sticker, canvas e alvo. Novo job limpa aprovação anterior. Publicação revalida
transação, tamanho, posição e fingerprint antes do clique único: layout falso,
ausente, de outro job ou alterado bloqueia o envio. Artefatos em `layout/` incluem
resize, position (quando necessários), layout-approved/layout-error e layout.json.
Logs `[LAYOUT]` mostram resize_required, size_ok, move_required, position_ok,
confirmed, terminando em `[READY] Story preparado com layout aprovado`.

Para a execução real completa no Windows, no mesmo terminal:

```bat
set DRY_RUN=true
set STORY_MEDIA=C:\caminho\imagem.jpg
set STORY_URL=https://plantaorio.com.br/materia-x
set STICKER_TEXT=Leia a matéria completa
set ALLOW_PUBLISH=true
set CONFIRM_REAL_PUBLISH=YES
npm run smoke:story-end-to-end-real
```

Mantenha a imagem/URL/texto exatos da tarefa. O fluxo prepara, confirma layout e
publica no mesmo processo/job; Your story é clicado uma única vez e o prompt
Facebook segue o tratamento já validado. Home/Story antigo continuam inconclusivos
sem mensagem positiva nova de envio. Não executar novamente automaticamente se
o resultado for INCONCLUSIVE. Para preparar sem publicar, use smoke:story-prepare.

### Resolução automática de mídia sem extensão

Antes de Appium/Android, o job usa `STORY_MEDIA`; `STORY_IMAGE` continua alias quando
STORY_MEDIA estiver ausente/vazio. `MEDIA_TYPE=auto` é o padrão (opcional image/video).
Não precisa acrescentar extensão nem renomear o arquivo original. Novo contrato
interno `StoryMedia`: path absoluto resolvido, type IMAGE/VIDEO/UNSUPPORTED, mimeType,
extension detectada, filename original, size em bytes e sha256 por streaming.

`resolveStoryMedia(inputPath)` usa arquivo exato primeiro. Se ele não existir e o
sufixo não for reconhecido, procura no mesmo diretório a base completa + .jpg/.jpeg/
.png/.webp/.mp4/.mov/.m4v/.webm. Pontos no horário, como 01.02.02, não são extensão
reconhecida. Um candidato é selecionado; mais de um retorna AMBIGUOUS_MEDIA com lista;
nenhum retorna MEDIA_NOT_FOUND. Não procura em outros diretórios nem escolhe por índice.

O conteúdo é identificado por `file-type`, independente do sufixo físico. Extension
é a extensão CANÔNICA detectada por assinatura (JPEG -> .jpg mesmo se o arquivo for
.jpeg ou não tiver extensão), não um palpite nem uma alteração do arquivo local.
Suporta reconhecimento IMAGE JPEG/PNG/WebP e VIDEO MP4/QuickTime/M4V/WebM. Conteúdo
não reconhecido/suportado fica UNSUPPORTED e não é enviado. Um hint image/video que
contradiz o tipo detectado gera MEDIA_TYPE_MISMATCH; auto exige somente detecção.

Teste SOMENTE leitura/resolução, sem Instagram, ADB, Appium ou publicação:

```bat
set "STORY_MEDIA=C:\Users\redrose\Pictures\PlantaoRio\WhatsApp Image 2026-10-10 at 01.02.02"
npm run smoke:media-resolve
```

Imprime requested/resolved/extension/mime/type/size e ready=true para mídia reconhecida.
ready significa resolução concluída, não autorização de publicação. O smoke também
reconhece vídeos, mas execução Android/Story/publicação VIDEO ainda não está implementada:
os fluxos reais param com VIDEO_EXECUTION_NOT_IMPLEMENTED ANTES de conectar ao Appium.
O modelo comum e `validateStoryJobInput` aceitam vídeo; futura estratégia de vídeo
poderá reutilizar o contrato sem impor JPEG nem extensão à plataforma.

Entrada futura: `{ media: "...", media_type: "auto", story_url: "...", sticker_text: "..." }`.
`media_path` também é aceito como nome alternativo de entrada. URL/CTA não são criados
ou alterados. Images continuam no fluxo validado: MIME detectado define o nome Android
.jpg/.png/.webp; os bytes são copiados sem conversão, e MediaStore confirma nome/pasta/
tamanho exatos. Metadados são revalidados antes do envio: arquivo alterado gera MEDIA_CHANGED.
O resultado usa media_sha256/job-media-sha256 mantendo o mesmo job_id e clique único.
Link, texto, resize, posição, travas, Facebook e verificação pós-publicação permanecem
nas implementações existentes. Nenhuma publicação real é executada pelo resolvedor.

## Centro operacional local

Execute `npm run admin` e abra **http://127.0.0.1:4310** no Windows. O backend precisa permanecer aberto para o scheduler avaliar a fila. Fechar apenas o navegador não remove jobs. Nenhuma ação desta versão abre Appium, cria Story ou publica; o motor existente não foi modificado. A ingestão RSS do Plantão Rio alimenta a fila; WhatsApp, e-mail e outros conectores ainda não estão implementados.

O menu agora possui Dashboard, Fila (todos/agendados/com erro), Automação + timeline, Publicações, Story, Contas, Sistema e Logs. A fila usa a mídia de teste configurada em `STORY_MEDIA` (ou `STORY_IMAGE`) no backend; sem configuração, usa `assets/story-test.jpg`. URL e texto recebidos no formulário são preservados. Vídeos podem ser reconhecidos como dados, mas a política bloqueia sua execução.

**Persistência:** JSON local versionado em `ADMIN_DATA_DIR` (padrão `data/admin`), sem dependências nativas. `admin.json` preserva o histórico importado e as configurações legadas; na primeira inicialização operacional, essas configurações são copiadas para `operations.json`, que passa a ser a fonte das configurações por conta. `operations.json` guarda `instagram_accounts`, `account_settings`, `publishing`, `safety`, `system`, `queue`, `events`, `audit` e `locks`. Escritas são serializadas e substituem o arquivo atomicamente; um arquivo inválido não é zerado silenciosamente. Faça backup dos dois JSON com o backend parado. Não edite arquivos enquanto o backend estiver aberto.

`backend.lock` impede dois backends no mesmo diretório; um PID vivo bloqueia a segunda inicialização. Lock de processo morto é recuperado. Um lock incompleto/inválido exige revisão manual, em vez de liberar execução indevidamente. Este armazenamento é destinado a **um backend local**, não a múltiplos servidores ou compartilhamento de rede.

**Serviços:** `StorySettingsService`, `PublicationQueueService`, `PublishingPolicyService`, `PublishingScheduler`, `InstagramAccountService`, `SystemHealthService`, `PublicationLogService` e `DeduplicationService`. Repositories isolam persistência; `CombinedPublicationsRepository` une fila e histórico sem duplicar registros. O scheduler roda exclusivamente no backend, a cada 10 segundos, com interface `PublishingAdapter` ainda sem implementação conectada ao Instagram.

**Já operacional:** criação de job de teste, agendamento, prioridade URGENT/HIGH/NORMAL, pausa/retomada/cancelamento, mover ao topo dentro da prioridade e tornar imediato. “Publicar agora” somente limpa o agendamento e torna o job elegível; “Publicar próximo” informa `ENGINE_ADAPTER_NOT_CONNECTED`, sem iniciar tentativa. Não há ação de esvaziar fila. Jobs ativos ou finalizados não podem ser recolocados na fila por esses controles.

A política exige automação habilitada, postador ONLINE, conta verificada, saúde confirmada, ausência de lock/duplicidade, agendamento vencido, janela de Brasília, limites diário/horário e intervalo mínimo. Janela pode atravessar meia-noite; início igual ao fim representa 24 horas. URGENT pode ultrapassar a janela somente quando configurado; não ultrapassa limites, saúde, conta ou locks. RATE usa limite móvel de 60 minutos; INTERVAL acrescenta seu intervalo ao intervalo mínimo. Para segurança, limites contabilizam tentativas iniciadas, inclusive inconclusivas, pois podem ter publicado. `nextEligibleAt` informa a próxima avaliação pela restrição encontrada, não garante publicação.

Deduplicação usa SHA-256 de `account_id + URL exata + hash dos bytes da mídia`; nomes diferentes não geram nova identidade. Duplicatas ficam `DUPLICATE`, com evento. Cancelados podem dar origem a uma nova tarefa. Proteções do motor permanecem independentes e intactas. Histórico antigo sem conta detectada fica `legacy-unverified`, sem inventar username ou vincular publicação antiga à conta configurada.

Ao iniciar PREPARING, o backend congela a configuração efetiva no job, preservando seu `sticker_text` recebido. Alterações seguintes do painel não alteram o snapshot. Um lock por conta e exclusão de execução concorrente no scheduler impedem duas tentativas simultâneas. Cada tentativa tem registro próprio; falha no limite ou após clique de risco exige revisão. INCONCLUSIVE nunca é repetido automaticamente. Ao reiniciar, PREPARING/READY/PUBLISHING viram REQUIRES_REVIEW com `RECOVERED_AFTER_CRASH`; não são considerados sucesso nem retomados automaticamente.

**Conta e saúde:** configure o username esperado em Contas; não há conta previamente confirmada. `detectCurrentAccount()` permanece UNKNOWN sem detector confiável. A interface futura permite OK/MISMATCH/LOGGED_OUT/UNAVAILABLE; não há botão para fingir OK. Saúde verifica o painel/persistência, `http://127.0.0.1:4723/status`, disponibilidade de `adb` e dispositivo `emulator-5554` via `adb devices`, com timeouts curtos. Não inicia emulador nem sessão Appium. INSTAGRAM permanece UNKNOWN até integração confiável. Quando configurado, falha observada pausa o sistema preservando jobs; não há loop de publicação.

**Preparado, ainda sem integração:** execução do motor pela fila, detecção real da conta, eventos de cada fase do motor e tratamento operacional de tentativas/revisão. O adapter futuro deve conservar as duas travas de publicação, confirmação da transação e layout do job, clique único e resultado INCONCLUSIVE sem retry em caso de dúvida. Configurações do painel ainda não alteram o fluxo Appium existente. O histórico continua importando somente resumos reais disponíveis; não reconstrói fases/timestamps ausentes. Crosspost não é confirmação de entrega no Facebook.

O backend atende somente loopback, valida origem/Host, exige JSON com header do painel para alterações e não expõe `.env`, senhas ou endpoints de publicação. Caminhos locais da mídia ficam no backend; o frontend recebe filename e endpoint de miniatura. Auditoria registra `admin-local`, timestamp, configuração e valores anteriores/novos. Autenticação multiusuário e acesso remoto não fazem parte desta fase.

Validação: `npm run typecheck`, `npm run build`, `node --test tests/*.test.mjs`. Os testes operacionais usam dados e adapters simulados; nenhum publica no Instagram.

O contrato do adapter também rejeita SUCCESS sem confirmação positiva contendo o `job_id` e `media_hash` atuais e horário válido. Uma confirmação de outro job vira INCONCLUSIVE. A presença de Home ou de Story antigo não satisfaz esse contrato.


## Complemento: estilo, texto e geometria do Link Sticker

`story.sticker.style_index` guarda o ciclo técnico 0/1/2/3, com nomes de apresentação Azul/Translúcido/Preto/Colorido. Default 0; escala continua 529/696 (~0,76). Presets passam a guardar `name`, `text`, `style_index` e escala opcional, mantendo os textos que já existiam. O snapshot em PREPARING congela também `sticker_style_index` e `max_text_length`.

`story.sticker.max_text_length` é **null por padrão**: o máximo real aceito pelo Instagram ainda não foi definido. Na tela Story, o campo opcional permite configurar um limite confirmado; o contador usa code points Unicode, bloqueia salvamento/entrada de job quando excedido e nunca corta o texto recebido. Não há mais regra arbitrária de 140 caracteres no painel. Limites de transporte HTTP (64 KiB) continuam independentes do limite do Instagram. Se um job QUEUED ultrapassar um limite reduzido posteriormente, ele exige revisão antes de PREPARING, sem consumir tentativa.

Preview no Dashboard e na tela Story calcula largura aproximadamente como ícone + estimativa dos glifos do texto + padding, multiplicados pela escala e limitados à largura da tela. A referência 696 px calibra somente o texto padrão; não determina uma largura fixa para outros textos. Mostra caracteres, largura estimada e aviso de preview limitado para textos muito longos; conteúdo integral permanece no job. A UI diz **Escala do Sticker**, com observação de que a largura depende do texto. É simulação; bounds reais do Instagram permanecem a fonte de verdade.

`sticker_x_pct` / `sticker_y_pct` representam o **centro** do sticker relativamente ao canvas. `src/instagram/configuredStickerLayout.ts` fornece contrato separado para integração futura: exige Link recém-criado, URL/texto e transação do job confirmados; aplica 0–3 taps de estilo no centro vivo; invalida geometria após texto/estilo; relê antes/depois das ações; solicita resize nativo e movimento W3C aos adapters das implementações já validadas; compara tamanho relativo aos bounds naturais atuais (não a uma largura fixa) e posição do centro, com tolerâncias de 8%/4%.

`StickerBoundsSession` descarta bounds quando texto/estilo/resize/posição mudam e recusa uso do cache antes de nova leitura. O contrato retorna `text`, `style_index`, `requested_scale`, bounds antes/depois do resize e finais, centro final/alvo, delta, `within_tolerance` e `layout_confirmed`. Também registra STICKER_CREATED/TEXT_APPLIED/STYLE_APPLIED/BOUNDS_READ/RESIZED/POSITIONED/LAYOUT_CONFIRMED com dados reais recebidos do adapter. O ciclo de estilo é baseado em taps no sticker novo; cor visual não é fingida como verificada (`style_verified_visually=false`).

**Ainda preparado, não conectado:** o painel não executa taps nem teste de layout real nesta entrega. `ConfiguredStickerLayoutPort` precisa ser ligado explicitamente ao driver, aos guards do job atual e aos gestos existentes. O módulo não contém função de publicação, não abre sessão e não substitui as implementações aprovadas. O motor principal, os smokes de publicação, MediaStore, navegação e Facebook permanecem intactos. A primeira validação futura desse adapter deve parar antes de publicar.

### Ingestão de mídia local antes da fila

`MediaIngestionService.ingest()` mantém a entrada direta de URL de mídia resolvida:
RSS → `article_url` → resolução de `data-story`/`data-link` pelo conector →
`source_media_url` → download → validação local → criação do job.
Essa entrada direta recebe a URL já resolvida. O conector automático descrito abaixo
usa o mesmo downloader e serviço de fila, com vínculo atômico na persistência operacional. Ambos preservam `story_url` e `sticker_text` exatamente como recebidos.

Arquivos ficam em `data/media/`, com nome seguro composto pela base da URL,
digest da URL e digest do conteúdo. A extensão vem do Content-Type, confirmado
pela assinatura do arquivo: JPEG (`.jpg`, incluindo origem `.jpeg`), PNG, WebP e MP4.
Download em streaming: limite padrão 50 MiB, timeout 30 segundos, até 5 redirects.
Arquivo vazio, erro HTTP, assinatura incompatível ou download incompleto não cria job.
O arquivo temporário é removido e só um arquivo validado é promovido para uso local.

A auditoria persistente em `data/ingestion/<ingestion_id>.json` mantém
`source_media_url`, `local_media_path`, `mime_type`, `extension`, `file_size`,
`sha256`, `downloaded_at`, artigo e job associado. Falhas têm
`status=MEDIA_DOWNLOAD_FAILED` e não entram na fila publicável. Falha posterior
na criação do job é distinta: `JOB_CREATION_FAILED`. O job guarda os mesmos dados
em `downloaded_media`, além de `media_path` e `media_hash`; o evento JOB_CREATED
inclui a URL de origem. Revalidação antes da criação impede aceitar conteúdo alterado.
`STORY_MEDIA` deve receber somente `local_media_path`, nunca `source_media_url`.
O resolvedor do motor rejeita URLs remotas explicitamente.
MP4 pode ser baixado/validado; execução/publicação de vídeo continua não implementada.

Teste local independente, sem Instagram/Appium ou publicação (CMD):

```bat
set SOURCE_MEDIA_URL=https://plantaorio.com.br/story/mrdd68z.jpg
npm run smoke:media-download
```

O comando imprime os metadados e o caminho local para `STORY_MEDIA`.
Nenhum download cria/publica Story automaticamente.

### Site Plantão Rio → entradas RSS → fila

O backend de `npm run admin` inicia `FeedPollingService`, mesmo sem navegador aberto.
Fluxo: `feed.xml` → URL/guid → `StoryMediaResolver` → atributos HTML `data-story` +
`data-link` correspondentes à matéria → download local validado → `READY` → fila.
Nenhum título/conteúdo/editoria é usado para montar imagem: a arte pronta é baixada.
Não usa browser/clica em compartilhar, não inicia Appium e não publica.
O scheduler existente continua sem adapter de publicação.

Configure em **Entradas RSS** no painel:

- `feed.enabled`: inicia/pausa novas consultas automáticas; padrão `true`.
- `feed.url`: padrão `https://plantaorio.com.br/feed.xml`.
- `feed.poll_interval_seconds`: padrão `60` (10–86400).
- `feed.auto_enqueue`: padrão `false`. Mídia válida cria job `READY` na Fila; “Enviar para fila”
  aprova o mesmo job como `QUEUED`. Ao ativar, novos itens válidos e itens `READY` aguardando
  entram na fila na próxima consulta bem-sucedida. Isso não autoriza publicação.
- `feed.account_id`: conta de destino persistida (`instagram-default` inicialmente).
  API de configuração valida que a conta existe. Texto do sticker é copiado exatamente
  da configuração da conta no momento da detecção, sem gerar texto editorial.

No primeiro polling, todos os itens disponíveis no feed são detectados, não só os
publicados depois da instalação; ficam em revisão operacional `READY` por padrão.
“Consultar agora” faz uma consulta manual inclusive com polling desabilitado.
Desabilitar polling impede novas consultas; a consulta em andamento pode concluir.
O intervalo é medido a partir da última tentativa, sem sobreposição de operações.
Timeout HTTP 30 s, até 5 redirects; RSS até 2 MiB/1000 itens; HTML até 5 MiB.
Erro temporário do feed não encerra o serviço; próxima consulta permanece programada.
Erro de uma matéria não impede processar as outras. Matérias com erro aguardam
“Tentar novamente”; não há retentativa automática de publicação.

Persistência: `data/admin/operations.json`, em `feed.config` e `feed.entries`,
alterável por `ADMIN_DATA_DIR`. Migração de arquivos antigos preserva fila/settings.
Registros incluem URL canônica/aliases/guid, conta, detecção/criação/atualização,
status, tentativas de ingestão, erro, tipo, `downloaded_media`, job e retenção futura.
Eventos operacionais incluem artigo/mídia/entry/job, timestamp e erro quando aplicável.
A fila recebe `article_url`, `detected_at`, `feed_entry_id` e todos os metadados
`source_media_url/local_media_path/mime_type/extension/file_size/sha256/downloaded_at`
na raiz do job e em `downloaded_media`; `media_path` é o mesmo `local_media_path`,
`media_hash` o SHA-256. `last_error` do job espelha `error_message` (a entrada também
tem seu `last_error` da ingestão). Continua com
prioridade NORMAL, attempts de publicação 0 e scheduled_at nulo ao enfileirar.

Deduplicação principal: URL canônica da matéria, mantendo aliases antes/depois do
resolvedor. Na comparação de identidade, fragmento/barra final e parâmetros `utm_*`
de campanha não criam uma matéria diferente; outros parâmetros continuam significativos.
GUID serve como fallback quando falta URL; GUID sem link HTTP(S) válido é registrado
como `ARTICLE_RESOLVE_FAILED`, nunca como job publicável. Canonical da página precisa
pertencer ao mesmo host final, e data-link precisa corresponder à matéria; múltiplas
mídias diferentes ou link divergente abortam (`MEDIA_NOT_FOUND`).
O HTML real de Valença possui `data-story="/story/mrdd68z.jpg"` e data-link com
`utm_source=story&utm_medium=share`, validado contra o canonical sem esses tags.
A URL da mídia é resolvida com `new URL(..., URL final da matéria)`, sem concatenação.

Criação do job e vínculo do registro RSS ocorrem **na mesma transação**. Enviar à
fila duas vezes/reiniciar retorna o job existente. Aliases que convergem para outro
canonical viram `DUPLICATE` antes de baixar novamente. Na retomada, arquivo local
válido é reusado e hash/tamanho/MIME são revalidados; arquivo alterado bloqueia fila
(`MEDIA_INVALID`) e só é baixado novamente em reprocessamento explícito.
A deduplicação já existente por conta/URL/hash também permanece.

A tela **Entradas RSS** mostra preview **local**, URL/abrir matéria, horário Brasília,
estado do download/ingestão e estado atual do job. Permite enviar à fila, ignorar,
reprocessar e configurar polling. Job já vinculado não pode ser reenviado/reprocessado
pela ingestão; use as ações existentes da fila. “Publicar agora” fica desabilitado.
Nenhuma mídia é apagada automaticamente; `retention_days=null` é apenas campo futuro.
MP4 segue no modelo VIDEO, mas sua publicação permanece não implementada.

Smokes separados (CMD no Windows, nenhum deles acessa Instagram):

```bat
npm run smoke:feed
npm run smoke:article-resolve
npm run smoke:ingestion
```

`smoke:feed` somente consulta/analisa RSS e lista URL/guid. `smoke:article-resolve`
somente analisa HTML. `smoke:ingestion-isolated` usa por padrão a matéria de Valença:
`https://plantaorio.com.br/valenca-amplia-atendimento-pelo-sus-com-aditivo-de-35-milhoes-mrdd68z`.
Resolve, baixa, valida e cria job em armazenamento **isolado**
`data/ingestion-smoke/operations.json`, mídia em `data/ingestion-smoke/media/`.
Não entra na fila do backend em operação e não chama o motor.
Repetir reutiliza o mesmo registro/job; erro de ingestão anterior pode ser reprocessado
uma vez pelo comando, nunca um clique de publicação.
Overrides opcionais: `ARTICLE_URL`, `FEED_URL`, `INGESTION_SMOKE_DATA_DIR`.

Validação cloud desta entrega: feed real com 30 itens; Valença resolveu
`https://plantaorio.com.br/story/mrdd68z.jpg`, JPEG de 197562 bytes,
SHA-256 `2c2fc5fdde1182b87d13c86ccef1b3ac2431f36ec53de96c21620913c096d3f4`;
job criado somente após validação, repetição reutilizou o mesmo job sem novo download.
No cloud com proxy, os comandos foram executados com Node 24 e
`NODE_USE_ENV_PROXY=1` (não necessário no Windows sem proxy). Domínios de rede
`plantaorio.com.br` e `www.plantaorio.com.br` foram adicionados ao draft do ambiente.
Nenhuma publicação real foi executada.

### Ingestão visível na Fila e no dashboard

Com RSS habilitado (padrão ON) e auto-enfileirar OFF, toda matéria validada agora
cria **um job READY na fila do painel**. O job mantém `awaiting_operator=true` e
zero tentativas; READY aguardando aprovação não entra no scheduler. Reiniciar o
backend preserva esse READY. Entradas antigas READY ainda sem job são materializadas
na inicialização, revalidando/reutilizando o arquivo local, sem novo download.
A recuperação de preparações interrompidas do motor continua exigindo revisão.

Abra `npm run admin`, acesse o painel local e escolha **Fila** na barra lateral.
O **Dashboard** também mostra uma seção Fila com os primeiros cinco jobs pendentes
(e link para a lista completa). Os dois usam a mesma renderização/ações. Cada linha
mostra preview local, URL, entrada, status, conta alvo configurada, horário agendado
(ou Não agendado), tentativas e último erro. “Ver mídia” lê o arquivo já baixado;
“Ver logs” inclui eventos do resolvedor/download e os eventos posteriores do job.
Não há download remoto para exibir previews.

Ações: **Enviar para fila** aprova READY como QUEUED, **Agendar**, **Pausar/Retomar**,
**Cancelar**, **Abrir matéria**, **Ver mídia** e **Ver logs**. **Publicar agora** fica
visível e desabilitado: não chama Appium. **Tentar novamente** só pode reativar FAILED
com tentativas terminadas comprovadamente antes de qualquer clique de publicação,
ainda abaixo do limite de tentativas e com hash local íntegro. SUCCESS, INCONCLUSIVE,
REQUIRES_REVIEW, envio incerto ou ocorrido nunca são automaticamente repetidos.
Pausar e retomar um READY sem aprovação mantém READY; não o promove a QUEUED.

Configuração RSS continua em **Entradas RSS**: RSS habilitado ON/OFF, intervalo
(em segundos), auto-enfileirar ON/OFF. Padrões: ON, 60 segundos, OFF. Ao ativar
auto-enfileirar, o mesmo job READY é aprovado na próxima consulta; não é duplicado.
Cancelamento/ignorar preserva a identidade da matéria para não recriar sua tarefa.
Repetições registram **DUPLICATE_ARTICLE_SKIPPED**, visível em Entradas RSS/Logs.

Teste com nova matéria no painel, em **dois terminais** no Windows:

```bat
REM Primeiro terminal: manter servidor aberto
npm run admin
```

```bat
REM Segundo terminal: opcionalmente usar outra URL de matéria
set ARTICLE_URL=https://plantaorio.com.br/valenca-amplia-atendimento-pelo-sus-com-aditivo-de-35-milhoes-mrdd68z
npm run smoke:ingestion
```

O comando agora chama `POST /api/feed/ingest` no backend local em `ADMIN_PORT`
(padrão 4310) e confirma o job na mesma fila do painel. Com auto-enfileirar OFF,
o resultado é READY; atualizar Dashboard/Fila mostra a tarefa. Repetir a URL
reutiliza o registro/job, sem duplicar ou publicar. Outra opção é **Consultar agora**
em Entradas RSS: toda matéria nova válida gera READY na Fila.
O smoke isolado anterior continua em `npm run smoke:ingestion-isolated`, usando
`data/ingestion-smoke/`; essa persistência separada não aparece no painel operacional.
Nenhuma opção desta integração acessa o Instagram ou executa publicação.

### Teste seguro da confirmação de conta

1. Atualize o repositório, execute `npm install` e `npm run admin`.
2. Abra http://127.0.0.1:4310, selecione Administrador e cadastre a conta esperada em Contas.
3. Com Appium e Instagram disponíveis no Windows, deixe a Home ou o próprio perfil aberto.
4. Clique **Verificar conta**. Esperada, detectada, status e última tentativa são salvos no painel.
5. **Atualizar status** apenas relê o resultado salvo, sem iniciar nova sessão no dispositivo.
6. Se houver edição de Story aberta, o diagnóstico a preserva; volte manualmente à Home e tente novamente.

Alternativa no terminal: `npm run smoke:instagram-account`. Usa a mesma verificação,
compara a conta cadastrada, salva o resultado e o evento ACCOUNT_CHECKED no mesmo
ADMIN_DATA_DIR do painel. Não cria Story nem publica. Atualize o status no painel
para ver o resultado. Divergência/ausência de confirmação bloqueiam publicação;
o comando real end-to-end exige uma leitura nova na mesma sessão.

A foto demonstrativa foi obtida de https://plantaorio.com.br/story/mrdd68z.jpg e
incluída localmente. O painel não precisa de internet para carregá-la. Essa imagem
não é enviada ao Instagram pelo preview e não substitui STORY_MEDIA dos jobs.
