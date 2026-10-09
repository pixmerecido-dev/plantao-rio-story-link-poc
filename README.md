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
