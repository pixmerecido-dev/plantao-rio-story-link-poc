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

## Carregar imagem no editor de Story (sem publicar)

Esta etapa reutiliza `InstagramDriver` e acrescenta `StoryLinkPublisher`. Não há implementação de sticker, URL ou publicação. `DRY_RUN` deve continuar `true`: neste teste isso permite preparar um rascunho local, mas não publicar. O script recusa outro valor e não modifica `.env`.

Pré-requisitos locais: Appium em `http://127.0.0.1:4723`, UiAutomator2, Instagram já autenticado, `emulator-5554` e `adb` no PATH. Se necessário, defina `ADB_PATH` no seu `.env` para o caminho completo de `adb.exe`, sem aspas embutidas. Não são necessários `adb_shell` no Appium nem senhas.

### Identificar os seletores no Windows

Os controles reais dependem da versão e do idioma do Instagram. **Nenhum resource-id foi presumido.** É necessário preencher seletores reais antes de completar o fluxo. No PowerShell:

```powershell
Copy-Item story-selectors.example.json story-selectors.local.json
npm run diagnose:instagram
```

O diagnóstico conecta sem abrir ou navegar no aplicativo e salva a tela atual em `artifacts/<timestamp>-manual/hierarchy.xml` e `screen.png`. Abra manualmente cada tela relevante e repita o diagnóstico. Esses arquivos podem conter dados pessoais; eles e a configuração local estão ignorados pelo Git.

Preencha `story-selectors.local.json` usando atributos observados no XML:

- `openStory`: sequência de controles para entrar especificamente no modo Story, partindo da tela inicial do Instagram.
- `openGallery`: sequência para abrir a galeria e, se necessário, o álbum `PlantaoRio`.
- `image`: seletor único da imagem enviada, não de qualquer miniatura. Se a interface expuser o nome do arquivo, use `{{filename}}` no valor: o script substitui pelo nome registrado no log. Se o nome não estiver disponível, colete a hierarquia da galeria após o primeiro envio e identifique a miniatura correta pelos atributos reais.
- `editorMarker`: controle exclusivo do editor de Story, ausente na galeria.
- `editorPreview`: elemento da prévia da imagem carregada no editor, identificado na hierarquia real.

Priorize `accessibility id` (atributo `content-desc`), depois `resource-id` e `text` exato. O formato de cada seletor é `{ "strategy": "accessibility id", "value": "valor observado" }`. Não há XPath ou coordenadas neste fluxo. Deixe apenas passos necessários de abertura: nunca configure compartilhar, enviar, publicar, avançar ou stickers. Controles reconhecidos como publicação por texto, descrição ou ID são recusados, mas os seletores locais ainda precisam ser revisados para a versão do aplicativo.

### Executar

```powershell
npm run smoke:story-image
# Ou receber outro JPEG local:
npm run smoke:story-image -- "C:\imagens\meu-teste.jpg"
```

O fixture padrão é `assets/story-test.jpg`, uma imagem sintética sem dados pessoais. A imagem é copiada por `adb -s emulator-5554 push` para `/sdcard/Pictures/PlantaoRio/` com nome novo; um broadcast do MediaScanner solicita sua indexação na galeria. A mídia é mantida, inclusive em falhas. Caso o Android ainda não mostre a imagem, aguarde a indexação e confira a pasta no dispositivo; não substitua o seletor por uma miniatura genérica.

O script apresenta os seis passos e exige que o marcador do editor passe de ausente para visível após selecionar a imagem, além de verificar a prévia visível e o package ativo. Isso confirma a estrutura da tela; a correspondência visual com a imagem enviada depende de selecionar corretamente a miniatura. O diagnóstico final permite conferir essa correspondência. Nenhum botão é clicado após a seleção da imagem.

Em caso de configuração ausente, seletor inválido, ambíguo ou falha de navegação, o teste salva a hierarquia da etapa e retorna código 1. Com a configuração vazia do exemplo ele deliberadamente para, sem inventar seletores. A sessão Appium é encerrada em `finally` usando `noReset=true` e `shouldTerminateApp=false`, sem comando para fechar o Instagram, apagar mídia ou alterar login. O editor deve permanecer aberto; esse comportamento ainda precisa ser confirmado na instalação local.

No cloud foram executados apenas typecheck e build, sem conexão a Appium/ADB. A abertura do fluxo, seleção da miniatura e identificação do editor não foram validadas no Instagram real. Não considere o teste de integração aprovado até preencher os seletores e executar no Windows.

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

## Inspecionar o menu de criação pelo botão real da Home

No Windows com Appium, `emulator-5554`, Instagram autenticado e `DRY_RUN=true`:

```powershell
npm run inspect:story-flow
```

O comando não depende de `story-selectors.local.json` nem de perguntas interativas. Ativa o Instagram e aguarda até 15 segundos pelo resource-id observado localmente `com.instagram.android:id/action_bar_left_button`. Se não estiver disponível, aguarda até mais 15 segundos pelo accessibility id `Create a post, story, reel or live video.`. Antes de clicar, exige um resultado único, visível, habilitado, com essa descrição e classe `android.widget.Button`; isso evita usar o mesmo ID em outra tela.

Realiza apenas um clique: o botão de criação da Home. Aguarda mudança na hierarquia e captura a nova tela sem navegar além dela. Em `artifacts/story-flow-<timestamp>/`, salva:

- `step-01-home.xml`, `.png` e `.json`;
- `step-02-create.xml`, `.png` e `.json`;
- `summary.json`, com o seletor da Home, as opções encontradas e a situação final.

Analisa textos/descrições observados contendo Story, Post, Reel ou Live. Lista os atributos reais e procura um seletor único e visível, priorizando resource-id, accessibility id e texto exato. Não presume IDs de opções, não usa XPath ou coordenadas. Story só é declarado inequívoco quando há uma única opção com rótulo exato Story/Stories e seletor único visível. Mesmo nesse caso, não clica na opção e encerra a inspeção. Se não houver opção inequívoca, registra a captura para análise sem afirmar que chegou ao seletor de mídia.

Não seleciona imagem, abre stickers, insere URL, compartilha ou publica. `DRY_RUN` não é alterado. A sessão Appium é encerrada com `noReset=true` e `shouldTerminateApp=false`, preservando dados e login. Em falhas, salva também `error.xml`, `.png` e `.json` quando possível. Os artefatos ficam ignorados pelo Git e podem conter dados pessoais. A descoberta de opções reais depende da execução no Windows; o cloud valida somente o código.
