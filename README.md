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

## Carregar a mídia já enviada no editor de Story

No Windows com Appium, `emulator-5554`, Instagram autenticado, `adb` no PATH e `DRY_RUN=true`:

```powershell
npm run smoke:story-image
# Para usar outro JPEG local como referência dos bytes já enviados:
npm run smoke:story-image -- "C:\imagens\meu-teste.jpg"
```

O comando não reenvia nem apaga imagens. Procura os arquivos `plantao-story-<timestamp>.jpg` em `/sdcard/Pictures/PlantaoRio/`, do mais recente para o mais antigo (até 20 arquivos). Compara o SHA-256 dos bytes no emulador com `assets/story-test.jpg` ou com o arquivo passado. Assim, a mídia mais recente só é usada se corresponder realmente à referência local; nunca escolhe simplesmente a primeira imagem da galeria. Se não encontrar correspondência, encerra com erro. `ADB_PATH` pode indicar o caminho completo de `adb.exe` no `.env`.

Reutiliza a detecção de estado e a navegação já confirmadas, localiza `com.instagram.android:id/cam_dest_story` e clica em STORY. Captura a tela seguinte em `artifacts/story-image-<timestamp>/step-03-media-picker.xml`, `.png` e `.json`. Algumas versões abrem a câmera em vez da galeria: se o nome da mídia não estiver exposto, solicita ao operador abrir **somente a galeria**, sem selecionar mídia, e confirmar com `GALERIA`. Salva outra captura `step-04-gallery-confirmed`.

### Seleção controlada da miniatura

Se a hierarquia expuser o nome/caminho exato da imagem validada e um seletor único visível, o teste seleciona por esse seletor. Caso contrário, lista apenas elementos de imagem com atributos reais e seletores únicos derivados de resource-id, descrição e texto; não usa IDs presumidos, XPath, posições nem coordenadas. O operador compara visualmente com a imagem local, escolhe o número e digita o nome do arquivo para confirmar. O teste revalida a hierarquia antes de clicar.

Se nenhuma miniatura tiver seletor confiável, o fallback `MANUAL` pede seleção no próprio emulador e confirmação pelo nome do arquivo. É uma limitação explícita: nesse caso a seleção não é automática. Enter ou uma confirmação diferente cancela o fluxo. Controles identificados como envio, publicação, stickers ou links não são oferecidos para clique.

Depois da seleção, aguarda mudança de tela e salva `step-05-editor-candidate` em XML/PNG/JSON. **Ainda não temos um resource-id confirmado do editor ou da prévia.** Portanto, exige confirmação visual explícita `EDITOR <nome-do-arquivo>` de que a imagem correta está no editor. Somente depois imprime sucesso e salva `step-06-editor-confirmed` e `summary.json`, registrando o seletor utilizado e os trechos confirmados pelo operador. Essa confirmação visual não é apresentada como validação automática do editor.

O teste para no editor: nenhum sticker, URL, botão de avançar ou compartilhar é acionado. Mantém mídia, dados, login e `DRY_RUN`; encerra apenas a sessão Appium com `shouldTerminateApp=false`. Em erro, tenta salvar `error.xml`, `error.png` e `error.json` na pasta da execução. Sem conexão Appium não é possível capturar a tela. Capturas podem conter dados pessoais e estão ignoradas pelo Git.

O antigo `story-selectors.local.json` não é necessário para este fluxo. Os seletores reais da galeria e do editor ainda precisam ser encontrados na instalação local; a versão cloud não executa ADB/Appium. A captura da galeria e o resumo local permitirão substituir as confirmações humanas por seletores reais nas próximas etapas.

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

## Fluxo de criação orientado pelo estado atual

No Windows com Appium, `emulator-5554`, Instagram autenticado e `DRY_RUN=true`:

```powershell
npm run inspect:story-flow
```

Ativa Instagram com `noReset=true`, sem presumir que começa na Home. `detectInstagramState` verifica os resource-ids confirmados localmente:

- `STATE_CREATE`: existe `com.instagram.android:id/cam_dest_story` (prioridade sobre Home).
- `STATE_HOME`: existe `com.instagram.android:id/action_bar_left_button` ou `com.instagram.android:id/feed_tab`.
- `STATE_UNKNOWN`: nenhum dos anteriores existe.

Se já estiver em criação, não volta à Home e não clica em nenhum controle. Se estiver na Home, aguarda o botão Criar e clica uma única vez. No estado desconhecido, aguarda e tenta a aba Home, confirma Home e depois usa o botão Criar. Se a aba não aparecer, interrompe com erro e diagnóstico; não inventa outra navegação.

Usa elementos únicos por `$`, sem coleções, índices, XPath ou coordenadas. Controles de navegação aguardam `waitForExist`, `waitForDisplayed` e o helper `waitForClickable`: a implementação nativa espera por visibilidade, habilitação e atributo Android `clickable=true`. O método homônimo de elemento do WebdriverIO só funciona em browsers, por isso não é chamado no Instagram nativo. Todas as esperas têm timeout de 15 segundos.

Aguarda `STATE_CREATE` e confirma `cam_dest_story` existente e visível. Não clica em STORY, não seleciona imagem nem abre stickers, insere URL ou publica. Em `artifacts/story-flow-<timestamp>/`, salva `step-01-initial` e `step-02-create` em XML/PNG/JSON, além de `summary.json`. Em erro, tenta salvar `error.xml`, `error.png` e `error.json`; a screenshot é tentada mesmo se a captura ou análise do XML falhar.

`DRY_RUN` não é alterado. A sessão Appium é encerrada com `shouldTerminateApp=false`, sem apagar dados, mídia ou alterar login. Os artefatos continuam ignorados pelo Git e podem conter dados pessoais. A validação de navegação real depende do Windows local; testes offline validam apenas as transições e ações esperadas.

Para validar as transições sem Appium, execute `npm run build` e `node --test tests/instagramState.test.mjs tests/storyMediaInspection.test.mjs`. Esses testes simulam os três estados, não substituem o teste local no Instagram.
