# plantao-rio-story-link-poc

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

No Windows local, execute `npm run smoke:story-publish-ready` com `DRY_RUN=true` e, opcionalmente, `STORY_URL`. O script reutiliza a preparação completa e a confirmação do Link Sticker. Se o editor final já expuser o domínio da URL na hierarquia, retoma sem aplicar outro sticker. O estado composto `STATE_EDITOR_WITH_LINK` registra como o link foi confirmado: domínio observado no editor ou fluxo que verificou exatamente o campo URL e confirmou Done.

Salva `publish-ready.xml`, `publish-ready.png`, `publish-ready.json` e `summary.json` em `artifacts/publish-ready-<timestamp>/`. Procura primeiro o resource-id já confirmado `com.instagram.android:id/your_story_share_shortcut_button`, depois accessibility id e texto exatos `Your story`. Registra resource-id, content-desc, text, class, clickable e enabled do elemento observado. Duplicidade aborta com diagnóstico. Também lista Close Friends, Next e candidatos de seta presentes na hierarquia, sem inventar IDs e sem clicar.

`ALLOW_PUBLISH=false` é o padrão no exemplo de ambiente. A trava `assertPublishAllowed` rejeita qualquer valor diferente de `true` exato e registra `[SAFE] Publicação bloqueada.`; deverá ser usada por qualquer futura operação de publicação. **Esta etapa não implementa nenhum clique de publicação, mesmo com `ALLOW_PUBLISH=true`.** O script para no editor, preserva login e dados e encerra somente a sessão Appium. Se houver erro, salva `error.xml/png/json`. Os seletores realmente presentes nessa instalação serão registrados no terminal e no resumo durante a execução local.

O publish-ready detecta primeiro `STATE_EDITOR_WITH_LINK` pela combinação de editor ativo, holder visível `com.instagram.android:id/video_sticker_ltr_holder` e controle final Your story visível. Nesse estado segue diretamente à inspeção: não abre Stickers, não chama `applyStoryLink`/`navigateToLinkEditor`, não preenche URL e não clica. Não exige que o Instagram exponha o domínio no XML. Essa combinação retoma a POC já validada visualmente; o holder isolado não comprova qual URL ou tipo de sticker está presente, e o resumo registra `editor-sticker-holder-and-publish-controls` como fonte de confirmação. A URL informada não é modificada nessa retomada. Sem essa combinação, mantém o fluxo existente para preparar o editor. Os atributos dos controles agora incluem também `displayed`.

### Validar o clique em LINK

A transição Stickers → Link Editor busca exatamente um elemento por accessibility id `Link Sticker`, verifica identidade (`content-desc` e resource-id confirmado), displayed, enabled e elementId real, e registra clickable, class e bounds. O clique principal usa `session.execute('mobile: clickGesture', { elementId })`, sem coordenadas, índice fixo ou XPath. Salva `click-link-before.xml/png/json` e `click-link-after.xml/png/json` antes e depois do gesto.

Consulta diretamente `link_sticker_list_web_url_edit_text`, `link_sticker_list_done_button` e `link_sticker_list_title` por até cinco segundos. Qualquer um presente confirma a transição; o gesto enviado sozinho não comprova navegação. `element.click()` é usado apenas após falha técnica do comando nativo e reconsulta do LINK, nunca simplesmente porque o gesto não navegou. Uma conexão perdida aborta sem tentar outro clique.

Se ainda não houver navegação, pode tentar uma única vez um descendente visual `android.widget.ImageView`, encontrado por busca relativa ao Link Sticker revalidado. Só permite essa tentativa quando existe exatamente um descendente visível, habilitado e com elementId, comprovando o vínculo pelo pai real. Descendentes ausentes ou ambíguos não recebem clique. O gesto no descendente também usa somente elementId e salva capturas antes/depois. Se não abrir o Link Editor, salva `click-link-failed.xml/png/json`, registra os atributos e aborta. Artefatos ficam em `artifacts/click-link-<timestamp>/` ou no diretório do smoke de inspeção. URL, Done, retorno ao editor e trava de publicação permanecem nos módulos existentes.

### Estado compartilhado de editor com link aplicado

`detectInstagramState` agora retorna explicitamente `STATE_EDITOR_WITH_LINK`, antes de `STATE_EDITOR`, quando combina editor ativo, holder aplicado visível `com.instagram.android:id/video_sticker_ltr_holder` e controle final Your story visível (ID confirmado, accessibility id ou texto exato). Holder isolado, oculto ou sem controle final não confirma esse estado. A combinação retoma o Story desta POC já validado visualmente; não prova isoladamente o destino de uma URL nem interpreta qualquer sticker genérico como link. As capturas conservam as evidências adicionais do domínio/link quando expostas pela interface.

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

O resumo inclui `job_id` UUID e `media_id` único da tarefa/rascunho, formado pelo job e SHA-256 da hierarquia antes do clique, com `media_identity_source=editor-hierarchy-snapshot`. Esse fingerprint não é apresentado como hash da imagem original e não associa automaticamente Stories antigos ao job. `pending-publication.json` conserva a tarefa e a proibição de retry; `publication-observations.json` conserva a sequência completa das hierarquias e tempos. Todos ficam na pasta ignorada `artifacts/publish-real-<timestamp>/`.

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
set STORY_IMAGE=C:\caminho\imagem-do-job.jpg
set STORY_URL=https://plantaorio.com.br/materia-x
set STICKER_TEXT=Leia a matéria completa
set JOB_ID=job-origem-001
npm run smoke:story-prepare
```

`STORY_IMAGE`, `STORY_URL` e `STICKER_TEXT` são obrigatórios, sem conteúdo padrão. Valida arquivo JPEG local, URL HTTP(S) e texto não vazio antes de conectar ao Appium ou abrir Instagram. Preserva exatamente caminho informado, URL e texto, incluindo espaços no texto. Não gera conteúdo, não normaliza URL e não altera imagem. `JOB_ID` é opcional; gera UUID somente para identidade quando ausente. O contrato `StoryJob` inclui job_id, image, story_url, sticker_text, publish_instagram e publish_facebook; este smoke registra os dois destinos como false e não chama publicação, mesmo com travas habilitadas.

Antes de preparar a tarefa, normaliza o Instagram até Home, voltando de estados residuais conhecidos e descartando somente draft local comprovado. Envia uma nova cópia da imagem, valida que é a mídia mais recente correspondente ao arquivo fornecido e exige uma seleção nova na galeria Recents antes de aplicar o link. Se a Home retomar diretamente um editor anterior, aborta sem reutilizar esse Story.

Após conferir a URL, abre o controle **já observado** `com.instagram.android:id/link_sticker_custom_cta_row`. Salva `link-before-custom-cta.xml/png/json` e `custom-cta.xml/png/json`. O campo personalizado ainda não tem resource-id confirmado no cloud: deriva o seletor apenas da hierarquia local após expandir custom CTA, exigindo exatamente um EditText fora do campo URL e um resource-id ou content-desc observável. Ausência/ambiguidade aborta com diagnóstico, sem inventar seletor. O seletor real escolhido aparece no terminal e em `summary.json`.

Preenche STICKER_TEXT e lê o valor para igualdade exata; revalida que a URL não mudou e só então clica Done uma vez. Exige `STATE_EDITOR_WITH_LINK` e salva `story-prepared.xml/png/json` em `artifacts/story-prepare-<timestamp>/`, além do resumo com dados externos, hash da imagem e selector observado. Campos não verificáveis ou erro salvam `error.xml/png/json` e abortam. Não abre qualquer controle de publicação, preserva login/mídia e mantém o editor final aberto ao encerrar somente a sessão Appium. Cada nova execução normaliza novamente até Home; não reaproveita o Story desta execução.


### Normalização obrigatória no início de cada job novo

`normalizeInstagramToHome(driver, directory)` é a entrada reutilizável para tarefas novas. `prepareNewStory()` a executa obrigatoriamente antes de preparar imagem ou link; o smoke valida os parâmetros externos antes de conectar. A futura fila deverá chamar essa mesma preparação para cada job, inclusive jobs com publicação ao final. A publicação isolada de um editor já preparado continua sendo uma etapa posterior do mesmo job; não descarta o rascunho que deve publicar.

Detecta Home, Editor, Editor com Link, Stickers, Link Editor, Galeria, Criação e Share identificável por seus rótulos reais. Executa no máximo cinco comandos Back, sem logout, reset de dados, clear storage/cache, manipulação de conta, coordenadas ou XPath. Chegando à Home, espera dois segundos, captura uma nova hierarquia e confirma novamente; só então registra `[JOB] iniciando novo Story`. Diálogo/tela desconhecidos, saída do Instagram, falta de estabilização ou limite de passos abortam sem começar a tarefa.

Diálogos de descarte são analisados dentro do próprio ramo da hierarquia (classe Dialog ou container dialog/alert observado). Só descarta com evidência explícita de Story/draft local, como Save draft junto a Discard, sem sinais de exclusão de conteúdo publicado. O seletor é derivado do resource-id/content-desc/text realmente presente e exige controle único, visível, enabled e clickable; não usa índices. Revalida o diálogo antes do clique e não repete descarte que não fechou a tela. Diálogos genéricos ou ambíguos abortam e precisam de inspeção local. Nenhum resource-id de descarte foi inventado.

Salva `reset-before.xml/png/json`, `reset-step-<n>.xml/png/json`, `reset-final.xml/png/json` e `normalization.json` com o histórico de ações. Diálogos comprovados têm capturas `discard-dialog-<n>.xml/png/json`; falhas salvam `normalize-error.xml/png/json`. Mantém login, sessão e mídia do emulador. Rascunhos locais comprovados podem ser descartados conforme esta regra; Stories publicados não são excluídos.


A confirmação de Home na normalização usa prioridade Link Editor → Stickers → Share → Editor com Link → Editor → Galeria → Criação → Home. Os critérios existentes de `STATE_EDITOR_WITH_LINK` não foram alterados. Home exige pelo menos dois grupos de sinais reais: cabeçalho `For you`; controle `action_bar_left_button` ou atalho `reel_empty_badge` com `Add to story`; linha da própria conta com `username`/`Your story` e `reel_empty_badge`. `feed_tab`, `profile_tab`, `tab_bar` e wrappers não são provas de Home.

A presença de IDs de Link Editor, stickers, holder aplicado, botão Your story, controles post_capture/editor, galeria ou criação bloqueia Home. Também bloqueiam descrições/controles de Your story, Close Friends, Share to, Next, Aa, Stickers e Music. O texto `Your story` na thumbnail da Home é distinguido do botão de publicação; ele não basta sozinho. Nós explicitamente ocultos e seus descendentes não contam como sinais positivos.

Após cada Back, faz probes de transição por até dois segundos e salva a captura do passo. Se a tela mudar durante a estabilização de Home, continua a normalização respeitando os limites; não registra sucesso antecipado. Só conclui após duas leituras separadas por dois segundos e uma verificação adicional após `reset-final`, registrando `[RESET] estado visual final confirmado: STATE_HOME`. O resumo conserva sinais positivos e blockers. Sem confirmação, não inicia o job.
