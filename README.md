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

`instagramStateMachine.ts` é compartilhado pelos fluxos de imagem, diagnóstico e stickers. A detecção usa somente `$`, `isExisting` e `isDisplayed`, sem `waitForExist` ou espera por Home. A sessão Appium configura `implicit=0` para que seletor ausente não cause espera longa. Ausência/stale durante uma transição é tratada como probe negativo; erros de conexão continuam sendo reportados.

A ordem de prioridade é:

- `STATE_EDITOR`: marcador visível `asset_button`, `your_story_share_shortcut_button` ou descrição `Stickers`.
- `STATE_GALLERY`: `gallery_grid_container` visível.
- `STATE_CREATE`: `cam_dest_story` visível.
- `STATE_HOME`: `feed_tab` ou `action_bar_left_button` visível.
- `STATE_UNKNOWN`: nenhum marcador disponível.

Os IDs com namespace usam o prefixo confirmado `com.instagram.android:id/`. A visibilidade evita que um elemento oculto de uma tela anterior desvie a detecção. Editor/Galeria têm prioridade quando marcadores coexistem.

`smoke:story-image` abre/ativa Instagram preservando a sessão e retoma da tela atual:

- Editor: assume que a imagem já está carregada, confirma o estado, salva `editor.xml/.png/.json` e termina sem ADB ou seleção. Não valida novamente a identidade visual da imagem existente.
- Galeria: seleciona uma foto pelo fluxo validado e aguarda Editor.
- Criação: clica STORY uma vez, aguarda Galeria, seleciona e aguarda Editor.
- Home: clica Criar uma vez e segue por Criação/Galeria/Editor.
- Desconhecido: não procura nem tenta `feed_tab`; captura `error.xml/.png/.json` e retorna código 1.

As esperas longas só acontecem depois de reconhecer um estado e iniciar uma navegação, com timeout de 20 segundos. O helper nativo de clicabilidade usa existência, visibilidade, habilitação e `clickable=true`; não chama a API de browser do WebdriverIO. Nenhum sticker ou botão de compartilhamento é clicado pelo fluxo de imagem. `summary.json` informa estado inicial, transições e reutilização do rascunho.

O diagnóstico `npm run inspect:story-flow` reutiliza a detecção: chega somente à criação partindo de Home/Criação, para sem navegar se já está em Galeria/Editor e aborta em Unknown. O módulo de stickers usa a mesma máquina para obter o editor antes de abrir seu painel.

Para validar sem Appium, execute `npm run build` e `node --test tests/instagramState.test.mjs tests/storyMediaInspection.test.mjs tests/storyGallery.test.mjs tests/storyStickers.test.mjs`. Esses testes usam sessões simuladas; a execução real permanece no Windows. `DRY_RUN=true` continua obrigatório e não é alterado. Não são usadas coordenadas, XPath ou índices de coleções vazias. Capturas locais podem conter dados pessoais e ficam ignoradas pelo Git.

## Abrir e inspecionar o painel de stickers (sem clicar em LINK)

No Windows, com Appium, emulador, Instagram autenticado e `DRY_RUN=true`:

```powershell
npm run smoke:story-stickers
```

Reutiliza o rascunho se o editor já estiver aberto. Caso contrário, usa o fluxo de imagem validado: a foto da POC deve continuar sendo a mais recente em Recents e estar em `/sdcard/Pictures/PlantaoRio/`. As capturas dessa preparação ficam na subpasta `image-flow/`. `npm run smoke:story-image` continua parando no editor, sem abrir stickers.

Confirma o editor por pelo menos um marcador visível: resource-id `asset_button`, accessibility id `Stickers` ou `com.instagram.android:id/your_story_share_shortcut_button`. O marcador de compartilhamento é somente consultado, nunca clicado. Localiza Stickers primeiro por `asset_button`, com fallback pela descrição `Stickers`. Exige seletor único, botão visível/habilitado/clicável e a descrição confirmada antes de um único clique.

Aguarda que uma nova opção relacionada a stickers, ausente na captura anterior, apareça visível no Instagram. Não basta uma mudança genérica no XML. Salva `stickers.xml`, `stickers.png`, `stickers.json` e `summary.json` em `artifacts/story-stickers-<timestamp>/`, além da captura anterior `editor-before-stickers`. Filtra atributos observados relacionados a Link, Location, Mention, GIF, Poll, Music e Hashtag. Registra `text`, `content-desc`, `resource-id` e `class`; somente rótulo exato Link/LINK é reportado como LINK encontrado. Os seletores derivados são apresentados para diagnóstico, sem afirmar que cada um é único.

Nenhum seletor do painel foi inventado. Não clica em LINK, insere URL, aciona Your story, compartilha ou publica. Não usa XPath nem coordenadas. Se LINK não aparecer na captura, informa isso e para sem procurar por cliques ou rolagem. Erros geram `error.xml`, `error.png` e `error.json` quando possível. A sessão Appium é encerrada sem terminar o Instagram, alterar login ou apagar dados; `DRY_RUN` permanece inalterado.

Os IDs e rótulos reais das opções do painel só serão conhecidos após execução local. Envie a captura revisada de dados pessoais para identificar o próximo seletor. O cloud executa typecheck, build e testes offline, sem acessar o emulador.
