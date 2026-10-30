# Laboratório isolado de gestos

O laboratório não está integrado ao painel/postador. Abra manualmente Instagram no editor com **somente um Link Sticker visível**, mantenha Appium disponível e `DRY_RUN=true` no `.env`. Não clique em Your story. Os comandos não iniciam Appium, não navegam, não recriam Story, não alteram URL/texto/estilo e não publicam. A sessão usa `autoLaunch=false`, `noReset=true` e o lock existente do dispositivo.

```text
npm run smoke:gesture-move
```

Salva `artifacts/gesture-lab-move-<tempo>/move-report.json` e XML/PNG/JSON antes/depois de cada tentativa. Descoberta: W3C (hold 900 ms + cinco passos), ADB touchscreen swipe (700, 1000, 1300 ms), depois protótipo UiAutomator2 `mobile: dragGesture` com speed 250. Cada método posterior só é tentado se o anterior falhar. NOT_TESTED significa que não foi executado. O alvo é -150/+200 px, limitado pelos bounds reais. Exige progresso na direção correta de pelo menos 70%, erro vetorial máximo de 30% e tamanho preservado. A descoberta sozinha não recomenda método: cinco rodadas alternam a posição inicial e o alvo, com novos bounds. Uma falha impede recomendação. Os comandos usam coordenadas dinâmicas.

Para executar resize somente depois do movimento qualificado, no PowerShell configure o caminho real do relatório gerado:

```powershell
$env:GESTURE_MOVE_REPORT = 'C:\caminho\artifacts\gesture-lab-move-...\move-report.json'
npm run smoke:gesture-resize
```

O resize verifica se o dispositivo, objeto e bounds atuais correspondem ao final do relatório. Se o editor mudou, refaça MOVE. O relatório é evidência operacional local, não autorização para publicar. Cinco rodadas usam 90%, 110%, 80%, 110%, 90% relativos ao tamanho no início de cada rodada. Até cinco tentativas por faixas de erro, com a quinta reservada para correção após overshoot, medição após cada gesto; tolerância ±4% de largura e limite de deriva de centro. Não há movimento deliberado durante resize. Native usa pinchCloseGesture/pinchOpenGesture; `GESTURE_RESIZE_METHOD=W3C` permite comparação explícita com dois pointers. Não há fallback automático de pinch. `GESTURE_SCALE=0.8`, `0.9` ou `1.1` executa um alvo isolado; isso não prova 5/5.

```text
npm run smoke:gesture-benchmark
```

Faz MOVE e, **somente se 5/5**, RESIZE na mesma sessão. Ambos têm relatórios separados. Executar os comandos reais somente no computador com o emulador; testes cloud usam mocks e não demonstram que o Instagram aceitou o gesto.

```text
npm run smoke:gesture-manual
```

Captura antes, aguarda 30 segundos para o operador mover manualmente e captura depois. Não injeta nenhum gesto nesse modo. `manual-report.json` verifica alteração dos bounds independentemente da injeção.

## Interpretação e limites

Um comando sem erro não prova sucesso. Os relatórios contêm bounds, canvas, centros, deltas, erros e erros de execução. Capturas são feitas em todos os métodos executados. Uma falha de leitura/identidade aborta e salva error.json/XML/PNG quando a sessão ainda está disponível. O protótipo nativo utiliza UiAutomator2 já instalado; não cria serviço Accessibility nem instala instrumentation adicional.

O Instagram pode expor apenas “Sticker. Touch and hold…”. Nesse caso o operador fornece o Link Sticker, e a leitura confirma o único objeto visual no editor; o laboratório **não prova o tipo Link nem modifica a proteção de publicação**. Resource-ids, accessibility e geometria podem mudar com versões do Instagram. As distâncias deste experimento são absolutas para testar o emulador atual; os limites do canvas são dinâmicos. Repetições no mesmo emulador não demonstram compatibilidade universal.

Nenhum vencedor nativo está comprovado pelo desenvolvimento cloud. Só recomendar quando os relatórios reais tiverem MOVE 5/5 e RESIZE 5/5 dentro da tolerância, com capturas coerentes. Não reintegrar automaticamente. Commits de estratégias vencedoras ficam pendentes desses resultados reais.

## Resize adaptativo por limiar

Evidência local relatada pelo operador: native reduziu 672 → 636 px com alvo 604,8 px, mas correções posteriores não tiveram efeito. Isso demonstra SUPPORTED=true naquele teste, CALIBRATED=false. O valor mínimo do limiar físico ainda não foi determinado.

O controlador não envia diretamente `target/current` como intensidade e não extrapola ganho linear. Mantém o alvo absoluto inicial. Usa faixas de erro: >15% começa com força 0,20 (limite 0,30); 8–15% começa com 0,10 (limite 0,20); 4–8% começa com 0,10 (limite 0,15). Esses parâmetros são candidatos conservadores baseados nas amostras locais, não limiares universais comprovados. NO_EFFECT é alteração menor que 3 px; sobe a força em 0,025, sem repetir o gesto ignorado. Se ultrapassar o limite da faixa, aborta em vez de insistir. Observações de força/ganho ficam locais à rodada e ajudam a escolher uma força menor já efetiva, mas não determinam escala proporcional.

Overshoot é cruzar a largura alvo; a próxima tentativa usa a direção oposta com intensidade menor, respeitando o piso candidato 0,10. Se estiver dentro de ±4%, para imediatamente, mesmo tendo cruzado o alvo. Há no máximo cinco tentativas; sem overshoot anterior, a quinta não é gasta em outra tentativa na mesma direção. O relatório informa stop_reason para diferenciar tolerância, limite de faixa e reserva de correção.

O benchmark faz primeiro uma prova isolada de aumento de 10%, registrando `pinch_out_probe`. Se não houver aumento de pelo menos 3 px sem erro, `PINCH_OUT_SUPPORTED=false` e as cinco rodadas ficam bloqueadas. Havendo suporte observado, as rodadas usam 90%, 80%, 110%, 90%, 110%. `npm run smoke:gesture-pinch-out` permite executar apenas a prova, usando a mesma exigência de GESTURE_MOVE_REPORT e correspondência do editor atual. O suporte não equivale a convergência nem qualificação.
Cada iteração contém attempt, direction, strength, before_width, after_width, delta_px, effect_ratio e no_effect. O relatório inclui erros antes/depois em pontos percentuais, overshoot, PINCH_IN_SUPPORTED, PINCH_OUT_SUPPORTED e initial_width, target_width, final_width, error_percent (em pontos percentuais), minimum_observed_effective_strength, last_no_effect_strength e observed_gain_per_strength. `minimum_observed` é somente o menor valor que funcionou nas amostras, não prova um limiar mínimo universal. Native percent é parâmetro do UiAutomator2, não uma escala garantida do sticker. O benchmark só marca calibrated=true com cinco rodadas aprovadas. MOVE permanece inalterado.

Para repetir a bateria completa sem configuração residual de alvo único no PowerShell:

```powershell
$env:GESTURE_RESIZE_METHOD = 'NATIVE'
Remove-Item Env:GESTURE_SCALE -ErrorAction SilentlyContinue
npm run smoke:gesture-benchmark
```

Isso refaz o MOVE existente para obter evidência no editor atual e só então executa as cinco rodadas de RESIZE. Não publica e não reintegra ao painel.

## Tolerância operacional

`RESIZE_TOLERANCE = 0.04` vale para a parada antes/depois de cada gesto e para a aprovação final. O caso relatado 542 → 504 px, alvo 487,8 px, erro +3,321%, passa e para sem outro pinch (se identidade, centro e execução estiverem válidos). A calibração física não foi alterada por essa mudança de critério.

`PINCH_IN_SUPPORTED` e `PINCH_OUT_SUPPORTED` são derivados diretamente das larguras antes/depois de ações na direção correspondente, com efeito mínimo de 3 px e sem erro de comando. O agregado inclui o probe e todas as rodadas: uma redução durante correção de overshoot no probe também comprova suporte. Isso não altera a exigência de cinco rodadas aprovadas para qualified=true. O relatório inclui tolerance=0.04; mean_absolute_error continua em fração (multiplicar por 100 para percentual), enquanto error_percent de cada rodada já está em pontos percentuais.

## Investigação isolada do mínimo próximo de 504 px

Com Instagram já no editor e apenas o Link Sticker visível, execute no CMD:

```cmd
set DRY_RUN=true
npm run smoke:gesture-min-size
```

Não executa MOVE, não recria o Story, não altera estilo/texto/URL nem o controlador de resize. É uma experiência **W3C explícita de dois pointers**. O comando nativo pinchCloseGesture esconde as coordenadas internas dos dedos, portanto não é usado para alegar coordenadas físicas conhecidas nesta investigação. O relatório registra as coordenadas **solicitadas**; elas não são telemetria de contato físico do Android.

A/B/C começam respectivamente a 15%, 35%, 45% da largura de cada lado do centro, dentro dos bounds atuais do sticker. Ambos os dedos convergem simetricamente na mesma horizontal. O controle varia geometria e intensidade: 0,25 nas primeiras três tentativas, depois 0,35, 0,45 e 0,50. Para após três tentativas consecutivas com alteração inferior a 3 px; máximo absoluto 12 gestos. Não utiliza a tolerância do resize para decidir efeito. Erro de comando, mudança de objeto/canvas ou aumento inesperado abortam a experiência. Antes de cada gesto os bounds são relidos e precisam corresponder aos usados no plano.

Arquivos em `artifacts/gesture-min-size-<tempo>/`:

- `min-size-report.json`: initial_width, observed_min_width, cada geometria, intensidade, quatro coordenadas dos dedos, delta e no_effect;
- `attempts.jsonl`: plano enviado antes do gesto e resultado após leitura;
- XML/PNG/JSON antes/depois de cada tentativa.

Não rode novamente o teste automático antes do controle manual, para manter uma comparação útil. Execute:

```cmd
npm run smoke:gesture-min-size-manual
```

O comando captura a largura atual e aguarda **Enter**. Faça você mesmo um pinch-in no emulador, sem tocar em Your story; depois volte ao terminal e pressione Enter. Não há gesto automático nesse modo. A sessão faz somente uma consulta de pacote a cada 15 segundos para continuar disponível enquanto espera. Capturas e `min-size-manual-report.json` ficam em uma nova pasta `artifacts/gesture-min-size-manual-<tempo>/`.

Compare e envie os dois relatórios e as imagens before/after. `MIN_SIZE_LIMIT_OBSERVED=true` significa apenas que houve estagnação próxima da referência (504 ±12 px), em três geometrias, sem reduzir abaixo de 501 px. **Não prova limite físico do Instagram**: os pointers W3C podem não ter sido aceitos. Se alguma geometria reduzir abaixo de 501, `GESTURE_GEOMETRY_LIMIT=true` registra que a automação explícita ultrapassou a referência; ainda não identifica sozinho qual aspecto do gesto nativo antigo era responsável. Se manualmente também não reduzir, isso reforça a hipótese de mínimo real, mas não exclui falha da tentativa manual. Se manualmente reduzir além do mínimo automático, há evidência de limitação da automação. O relatório sempre mantém `physical_limit_proven=false` até análise conjunta das evidências.

Não há acesso ao emulador Windows no desenvolvimento cloud. Os testes unitários validam planos e critérios com mocks; nenhuma menor largura real ou conclusão definitiva é inventada. MOVE e a tolerância operacional de resize de ±4% permanecem congelados.

## Mínimo confirmado por configuração e alvos limitados

O operador confirmou manualmente, depois dos testes automáticos, o mínimo **504 px** a partir da referência **727 px**, para texto exato `Leia a matéria completa`, estilo 0, dispositivo `emulator-5554`, canvas 1080×1920. Essa observação autorizada é o registro inicial local, não um mínimo universal. É persistida no primeiro uso em `data/admin/sticker-size-limits.json` (ou ADMIN_DATA_DIR). O contrato inclui texto, estilo, canvas, dispositivo e versão opcional do Instagram; a versão desconhecida é null. Havendo uma versão explicitamente diferente, o registro não corresponde. O método `ObservedSizeLimitStore.save` permite adicionar uma observação validada de outra configuração ou recalibrar a mesma chave; relatórios sem efeito isolados não escrevem automaticamente um suposto mínimo.

O benchmark só usa esse mínimo se o operador declarar texto e estilo do sticker que já está aberto. O objeto genérico da accessibility não permite ler esses valores de forma confiável; as variáveis abaixo são contexto fornecido pelo operador, não modificam o sticker. Se o contexto não corresponder ou não for fornecido, não há clamp conhecido.

```cmd
set DRY_RUN=true
set GESTURE_RESIZE_METHOD=NATIVE
set GESTURE_SCALE=
set "GESTURE_STICKER_TEXT=Leia a matéria completa"
set GESTURE_STYLE_INDEX=0
npm run smoke:gesture-benchmark
```

O relatório registra `requested_target_width`, `effective_target_width`, `observed_min_width`, `minimum_limit_scope`, `TARGET_BELOW_MIN`, `clamped`, `reason` e `clamped_count`. Se o alvo solicitado ficar abaixo de 504 para a chave confirmada, o alvo efetivo será 504 e reason será INSTAGRAM_MIN_SIZE. Se o sticker já está dentro de ±4% desse alvo efetivo, a rodada passa sem enviar outro pinch. Clamp não significa sucesso automático: se a largura final estiver fora da tolerância, erro de comando, troca de objeto ou deriva de centro continuarem presentes, o resultado permanece inválido. `error_percent` e `mean_absolute_error` avaliam o alvo efetivo; `requested_error_percent` preserva a diferença frente ao alvo originalmente pedido.

O painel consulta o mesmo registro por `/api/sticker-size-limits`. Para a configuração validada, o mínimo equivalente é **504/727 = 69,326%**, apresentado como 69,3%. Slider, prévia e salvamento respeitam o mesmo piso e exibem “Tamanho mínimo permitido pelo Instagram para este link.”. A referência de largura medida é usada na prévia dessa configuração; outros textos/estilos mantêm a estimativa anterior até terem calibração própria. A versão atual do painel usa o contexto de canvas de referência 1080×1920 e o dispositivo fixo já usado pelo motor. Isso não calibra automaticamente outro dispositivo ou versão.

A sequência continua 90%, 80%, 110%, 90%, 110%. Uma rodada limitada ao mínimo conta como válida somente após medição compatível com o alvo efetivo. A qualificação real continua exigindo os relatórios locais; testes com mocks não demonstram 5/5 no Instagram. O algoritmo de MOVE e os gestos do fluxo principal não foram alterados nem substituídos pelo laboratório. O ajuste do painel nesta etapa limita configuração e prévia; não conecta a fila a publicação real.

### Convergência NEAR_MIN

O controlador isolado entra em NEAR_MIN quando a largura está acima do mínimo
conhecido e a distância até ele é no máximo 8% desse mínimo. A tolerância segue
0.04 e o registro observado segue 504 px para a configuração validada.
O primeiro gesto usa intensidade 0.175 (limiar nativo observado anteriormente);
após NO_EFFECT (<3 px) aumenta 0.01, sem repetir a tentativa ignorada. No máximo
três gestos NEAR_MIN. Para imediatamente ao entrar na tolerância: 524 passa,
526 falha. Uma medida abaixo do mínimo é registrada em
`lower_minimum_candidate`, sem alterar automaticamente o mínimo persistido.

Com um único sticker da configuração conhecida visível entre 525 e 535 px,
execute no CMD, dentro do projeto:

```cmd
set DRY_RUN=true
set GESTURE_RESIZE_METHOD=NATIVE
set GESTURE_SCALE=
set "GESTURE_STICKER_TEXT=Leia a matéria completa"
set GESTURE_STYLE_INDEX=0
npm run smoke:gesture-near-min
```

O teste apenas mede e redimensiona o sticker existente: não o prepara/navega.
O modo near-min permanece apenas como diagnóstico histórico; não é mais
pré-requisito do benchmark final. Não repetir a investigação nesta fase.
O mínimo prático da configuração foi confirmado em 504 px. O benchmark usa
`max(requested_target_width, observed_min_width)` e registra `clamp_reason`.
Quando o alvo é limitado ao mínimo e a medida atual já está dentro de ±4%,
a rodada passa sem gesto (`gesture_skipped=true`). Isso inclui a medida 504 px.
526 px continua fora da tolerância. Valores abaixo da borda inferior também
não são aprovados apenas por serem menores que o mínimo.

### Benchmark final com mínimo confirmado

Deixe um único Link Sticker da configuração conhecida visível no editor.
Não precisa restaurar um tamanho fixo antes de cada rodada: a sequência
90%, 80%, 110%, 90%, 110% usa as larguras reais medidas a cada rodada.
Há um probe de aumento separado das cinco rodadas. Reduções consecutivas
no mínimo podem passar sem gesto, sem alegar nova comprovação de pinch-in.
Os indicadores de suporte continuam derivados dos gestos com efeito medido.

```cmd
set DRY_RUN=true
set GESTURE_RESIZE_METHOD=NATIVE
set GESTURE_SCALE=
set GESTURE_NEAR_MIN_REPORT=
set "GESTURE_STICKER_TEXT=Leia a matéria completa"
set GESTURE_STYLE_INDEX=0
npm run smoke:gesture-benchmark
```

O benchmark mantém a validação MOVE existente, não exige relatório near-min e
não executa testes de geometria. `resize-report.json` registra cinco resultados
se todos passarem; uma falha interrompe a bateria e mantém `qualified=false`.
O erro médio considera apenas rodadas executadas, em fração (multiplique por
100 para percentual). Uma simulação 5/5 não substitui o resultado Android.
Reintegração depende de 5/5 reais; estes comandos não reintegram nem publicam.

### Investigação da geometria próxima do mínimo

`smoke:gesture-near-min-geometry` assume um único sticker já visível entre
520 e 535 px. Não prepara Story, não move o sticker e não publica.
Exige o mesmo contexto explícito de texto/estilo do registro de mínimo.
Usa W3C com dois pointers touch sincronizados, mantendo o centro do gesto.
A/B/C começam a 15%/35%/45% da largura para cada lado do centro.
São três amplitudes físicas: 12, 28 e 44 px de deslocamento por dedo,
com A/B/C em cada amplitude, no máximo nove tentativas. A intensidade
normalizada é apenas diagnóstico; a trajetória executada usa as coordenadas.
O teste não executa novamente a sequência nativa 0.175/0.185/0.195.

Para na primeira redução válida >=3 px, erro de comando, drift inválido
ou aumento inesperado. Drift por gesto e acumulado devem ficar dentro de
max(5 px, 2% da largura do canvas), a tolerância de posição existente no Lab.
O limite automático só é marcado se todas as nove tentativas válidas tiverem
abs(delta)<3 px. Isso não prova um limite físico do Instagram.

O relatório `near-min-geometry-report.json` contém coordenadas efetivamente
**enviadas** ao Appium, distâncias inicial/final dos pointers, medidas dos
bounds antes/depois, drift, validade e efeito. Não é telemetria de contatos
físicos do Android: aceitar um comando não comprova seu efeito.
`attempts.jsonl` registra os comandos antes da execução e os resultados depois.
PNG/XML são capturados para cada tentativa.

```cmd
set DRY_RUN=true
set "GESTURE_STICKER_TEXT=Leia a matéria completa"
set GESTURE_STYLE_INDEX=0
npm run smoke:gesture-near-min-geometry
```

Somente se `near_min_effective=true`, o segundo teste pode usar a candidata
comprovada. Deixe novamente a largura entre 520 e 535 px para testar a redução
independentemente (se já estiver na tolerância, termina sem gesto).

```cmd
set "GESTURE_NEAR_MIN_GEOMETRY_REPORT=C:\caminho\near-min-geometry-report.json"
npm run smoke:gesture-near-min-geometry-converge
```

O segundo comando valida a evidência e o contexto, usa somente a geometria e
amplitude da candidata, relendo os bounds antes de cada gesto. No máximo três
gestos; para em PASS, NO_EFFECT, drift ou erro. Não repete uma tentativa idêntica
ignorada. Gera `near-min-geometry-converge-report.json`. Nenhum destes testes
altera o controlador, MOVE, mínimo persistido, tolerância, clamp ou painel.
Nenhum benchmark completo é iniciado automaticamente.

### Âncoras diagonais proporcionais — calibração isolada

Os pontos vermelho/verde da referência foram desenhados pelo operador.
**Não existem como controles do Instagram e não são detectados por cor.**
As posições iniciais são hipóteses, não calibração aprovada:

- vermelho: left + width*0.95; top + height*0.29;
- verde: left + width*0.04; top + height*0.70.

Todos os pontos são recalculados e arredondados a partir dos bounds atuais.
Pinch-in inicia nessas âncoras e aproxima ambos os dedos ao ponto médio da
diagonal. Pinch-out percorre a trajetória inversa, de posições internas até
as âncoras. Contração inicial35%, hold150ms e cinco passos150ms; são parâmetros
experimentais registrados pelo plano, não uma escala prevista do sticker.
Apenas coordenadas enviadas são conhecidas: não se afirma posição real dos
contatos físicos sem observação independente.

A busca local começa em95/29 e4/70. Se não houver efeito, modifica **uma**
coordenada por vez: red x93/97, red y27/31, green x2/6, green y68/72.
Máximo9 candidatos por direção, nunca todas as combinações. Para no primeiro
efeito direcional>=3px com drift válido. Aumento começa na candidata de redução,
se encontrada, e então usa os vizinhos restantes se necessário. Erro de comando,
drift>max(5px,2% da largura do canvas), mudança do objeto/canvas/dispositivo ou
efeito na direção contrária interrompe. A posição acumulada é verificada por
fase. Não há MOVE nem reposicionamento automático, reconstrução, publicação,
benchmark completo ou alteração de limites/slider/controlador principal.

Prepare manualmente um único Link Sticker visível, preferencialmente maior que
o mínimo para que a redução possa ser observada. Declare seu texto/estilo real:

```cmd
set DRY_RUN=true
set "GESTURE_STICKER_TEXT=Leia a matéria completa"
set GESTURE_STYLE_INDEX=0
npm run smoke:gesture-anchor-calibration
```

Saída em `artifacts/gesture-anchor-calibration-<timestamp>/`:

- `anchor-calibration-report.json`: todas as tentativas, percentuais normalizados
  0..1, pontos px, distâncias, bounds, larguras, delta, drift e efeito por direção;
- `attempts.jsonl`: comando antes da execução, resultado após medição;
- `anchor-in-1-before.png` e equivalentes: screenshot original;
- `anchor-in-1-before-anchors.svg` e equivalentes: screenshot embutido em SVG
  com bounds, âncoras e trajetórias **calculadas**, abrível no navegador;
- XML/JSON e PNG antes/depois de cada tentativa; metadados de viewport separados.

O overlay usa o PNG original e não altera a tela do Instagram. Recusa PNG e
viewport com tamanhos divergentes para não desenhar uma correspondência falsa.
Tamanhos iguais ainda não comprovam hit testing; compare a marcação à imagem.
Suporte significa efeito medido. A primeira candidata válida não é declarada
ótima/universal; compare efeitos e drift nos relatórios reais antes de adotá-la.

Depois de provar as duas direções, repetir separadamente com texto curto,
texto de referência e texto longo, preparados manualmente, declarando o texto
atual em GESTURE_STICKER_TEXT e estilo em GESTURE_STYLE_INDEX. O relatório
registra estes dados como declaração do operador, não prova semântica do XML.
Cada execução recalcula os pixels. Nenhuma aprovação entre textos é presumida.
Os testes mock de diferentes larguras validam o cálculo, não o Instagram.

### Controle Ctrl + mouse separado

```cmd
set GESTURE_ANCHOR_DIRECTION=in
npm run smoke:gesture-anchor-ctrl-mouse
```

Exige terminal interativo. Mede e salva o estado inicial e overlay; mostra a
referência vermelha calculada. O operador faz Ctrl+mouse manualmente no emulador
e só então pressiona Enter no CMD. O programa não injeta pointer, tecla nem
movimento. Gera `anchor-ctrl-mouse-report.json` em pasta própria e captura o
estado final. Para aumento, repita com GESTURE_ANCHOR_DIRECTION=out.
O caminho manual não é registrado como se tivesse sido observado; apenas
largura e drift antes/depois são medidos. Esta evidência permanece separada
do multi-touch automatizado.

### Validação das âncoras congeladas entre textos

O operador informou evidência real de redução575→537 (-38px) e aumento537→589
(+52px), ambos com drift0, usando red95/29 e green4/70. Nesta etapa a geometria
fica congelada nesses percentuais: não executar nova busca. O comando abaixo
é um teste isolado de proporcionalidade, sem controlador de tamanho exato,
reintegração ou benchmark5/5.

```cmd
set DRY_RUN=true
set GESTURE_STYLE_INDEX=0
npm run smoke:gesture-anchor-text-validation
```

Exige terminal interativo. O programa guia três casos em sequência:

1. Prepare manualmente um único Link Sticker com texto exato `Veja` e o estilo
   declarado. Deixe-o acima do mínimo próprio desse texto para permitir reduzir.
   Retorne ao editor e pressione Enter no CMD.
2. Prepare manualmente o texto exato `Leia a matéria completa`, no mesmo estilo,
   também acima do mínimo, e pressione Enter quando estiver no editor.
3. Para o caso longo, escolha um texto próximo do maior comprimento visualmente
   aceito pelo Instagram (sem truncamento), maior que o padrão. Cole o texto
   exato no prompt e confirme Enter somente depois de preparar o sticker no
   editor. Não presumimos nem definimos um limite universal de caracteres.

A troca/criação/edição dos três textos é feita pelo operador; o comando não
navega, não cria Story nem sticker, não modifica a conta e não publica. Cada caso
faz exatamente um pinch-in e, estando o objeto válido, um pinch-out. Releitura
dos bounds antes de cada gesto produz novas coordenadas. Nenhum NO_EFFECT gera
retry, mudança das âncoras ou busca. Um erro de comando ou drift inválido aborta
os gestos restantes. NO_EFFECT apenas reprova a direção e permite registrar a
outra direção e os outros textos, sem insistência.

Mantém o critério de efeito mensurável existente (>=3px), sinal correto da
mudança e drift por gesto/acumulado dentro de max(5px,2%canvasWidth). Erro de
comando, identidade/canvas/dispositivo alterado ou movimento de posição não
qualificam o resize. Não há alvo exato nem alteração da tolerância4% ou do
mínimo504 do perfil conhecido; o mínimo não é aplicado universalmente a `Veja`
ou ao texto longo.

Gera `artifacts/gesture-anchor-text-validation-<timestamp>/` com:

- `anchor-text-validation-report.json`: relatório agregado, salvo após cada
  caso; casos incompletos nunca qualificam;
- bounds iniciais por texto e, para cada direção, bounds medidos, RED/GREEN
  em pixels, frações fixas, coordenadas dos dedos, delta, drift e sucesso;
- `text-short-in-before-anchors.svg` e equivalentes: imagens com marcações
  calculadas sobre o PNG original; XML/JSON/PNG antes/depois de cada gesto;
- `attempts.jsonl`: comandos e resultados, inclusive se houver interrupção.

Somente curto+padrão+longo completos, com redução E aumento aprovados, mesmo
estilo/dispositivo/canvas, produzem `ANCHOR_GEOMETRY_QUALIFIED=true`.
O texto é declaração do operador porque o nó acessível pode ter descrição
Genérica; capturas acompanham o relatório para conferência visual. A variável
não significa calibração universal de outros textos ou versões e não autoriza
publicação. Mocks validam o funcionamento do teste, não os gestos reais Android.
Depois de aprovado, o próximo trabalho será controlador com essas âncoras e
benchmark5/5; nenhum deles é executado ou reintegrado por este comando.

### Três medidas manuais: inicial, máximo e mínimo

```cmd
set DRY_RUN=true
set "GESTURE_STICKER_TEXT=Veja"
set GESTURE_STYLE_INDEX=0
npm run smoke:gesture-anchor-manual-range
```

O programa não injeta gestos, teclas ou movimentos. Exige um único sticker já
visível no editor e pede **três confirmações Enter**: estado inicial desejado,
após aumento manual ao máximo alcançado com Ctrl+mouse e após redução manual ao
mínimo alcançado. Antes de cada Enter solte Ctrl/mouse e aguarde os controles
do Instagram voltarem. Há releituras somente de observação para estabilização;
a presença do editor continua obrigatória. A captura é conferida novamente
para não aceitar bounds em movimento.

Salva PNG/XML/JSON em cada etapa, progresso parcial e o relatório final
`anchor-manual-range-report.json` em `artifacts/gesture-anchor-manual-range-*`.
Registra larguras/alturas/bounds, deltas e drift entre etapas. Os extremos são
os observados pelo operador nesta execução, não um limite universal; nenhuma
observação altera o registro de mínimos. O texto é declarado pelo operador.
Este controle manual não qualifica a trajetória W3C nem atualiza o resultado
2/3 da validação automatizada. Não executa benchmark ou publicação.

### Somente Veja: comparação automatizada após controle manual

```cmd
set DRY_RUN=true
set GESTURE_STYLE_INDEX=0
npm run smoke:gesture-anchor-short
```

Deixe um único sticker `Veja` no tamanho menor observado manualmente (cerca de
251–265px nesta configuração). Confirme Enter apenas com Ctrl/mouse soltos e
os controles do editor visíveis. O programa envia um pinch-out diagonal com
âncoras congeladas95/29 e4/70 e, somente se houver aumento mensurável válido,
um pinch-in. Não há gestos manuais durante a execução. Sem retries ou nova
busca, máximo dois gestos. Se o aumento não produzir efeito, interrompe e
registra `OUT_NO_EFFECT` sem insistência.

Salva `anchor-short-report.json` em `artifacts/gesture-anchor-short-*` com
`isolated_case_success` e medidas das duas direções. O código de saída descreve
somente este caso. O campo agregado `ANCHOR_GEOMETRY_QUALIFIED` permanece falso
porque uma execução isolada não contém os outros dois textos; os relatórios
reais anteriores devem ser confrontados antes de uma qualificação conjunta.
Não repete o caso padrão/longo, controle manual, MOVE ou benchmark final.

### Correção da injeção multi-touch no texto curto

O logcat real confirmou que a entrada RED_FIRST gerou ACTION_DOWN para o segundo
dedo enquanto o primeiro já estava pressionado. Android rejeitou com
`Invalid DOWN event - pointers already down` e `ACTION_MOVE touching pointers
don't match`. As entradas sequenciais RED_FIRST/GREEN_FIRST foram retiradas;
não devem ser repetidas nesta combinação Android/UiAutomator2. Isso explica o
erro de injeção, mas não explica o NO_EFFECT do gesto simultâneo que havia sido
aceito pelo Android.

O novo ensaio é único: SIMULTANEOUS_CONTINUOUS, dois pointerDown no mesmo tick,
sem pausa inicial e10 passos60ms de movimento. As âncoras95/29 e4/70, a diagonal
e contração35% permanecem iguais. Validação anterior à execução exige dois
sources touch distintos, duração/tipos sincronizados, exatamente um DOWN/UP
por source e ambos ativos em todo MOVE. Sequências incompatíveis são rejeitadas
antes do envio. Isso verifica a cadeia W3C; a formação Android ainda depende do
UiAutomator2 e é verificada no log.

```cmd
set DRY_RUN=true
set "GESTURE_STICKER_TEXT=Veja"
set GESTURE_STYLE_INDEX=0
npm run smoke:gesture-short-touch-execution
```

Prepare Veja no estilo branco/azul do controle manual e no tamanho menor
observado (aproximadamente251–265px), sem mudar o estilo durante o teste.
Solte Ctrl/mouse, aguarde os controles do editor e confirme Enter uma vez.
O programa tenta1 aumento; somente se medir aumento>=3px e drift válido,
faz1 redução com a mesma receita. Não há retries nem busca de âncoras.
Não modifica MOVE, textos padrão/longo, mínimo, tolerância ou painel.

A coleta de logcat inicia antes do gesto com uma marca exclusiva e termina
junto do ensaio. Não limpa o histórico Android. ADB_PATH pode indicar o
executável; no Windows há fallback para LOCALAPPDATA/Android/Sdk/platform-tools.
Falha na inicialização da coleta bloqueia o gesto para evitar outro ensaio sem
evidência. A coleta tem limite8MiB; truncamento impede qualificação observada.

A pasta de artefatos contém `short-touch-execution-report.json`, imagens e
`touch-injection-logcat.txt`. O relatório separa erro de comando, ausência de
efeito e transformação medida. `touch_injection` verifica DOWN aceito,
POINTER_DOWN do segundo dedo, MOVE aceito com2contatos e UP, sem falhas de
injeção registradas no período. A evidência é do driver/Android, não uma
observação física dos dedos nem reconhecimento de escala pelo Instagram.
`SHORT_AUTOMATED_SUCCESS=true` exige efeito nas duas direções e a evidência de
injeção. `measured_resize_success` preserva o resultado geométrico separado.
Sem benchmark completo, publicação ou qualificação universal dos três textos.

### Hipótese do vídeo: contato externo espelhado no viewport

O vídeo manual mostrou um contato dentro/próximo de Veja e outro fora, abaixo
do sticker. O operador controla apenas o primeiro com mouse; o emulador gera o
segundo. Isso difere da diagonal interna usada nas âncoras dos textos maiores.
Não mudar o perfil aprovado desses textos. O comando isolado abaixo testa uma
hipótese explícita de simetria em torno do centro do viewport, inferida do vídeo,
sem afirmar que essa transformação já está calibrada.

```cmd
set DRY_RUN=true
set "GESTURE_STICKER_TEXT=Veja"
set GESTURE_STYLE_INDEX=0
npm run smoke:gesture-short-emulator-pinch
```

Prepare Veja pequeno, branco/azul e na região central do Story. Confirme Enter
com Ctrl/mouse soltos e os botões visíveis; depois não interfira. O teste envia
**um único pinch-out**, sem repetição e sem redução automática. Não é um comando
Ctrl/mouse do Windows: Appium recebe dois pointers touch simultâneos.

Primeiro contato: bounds.left+width*.95, bounds.top+height*.29. Segundo contato:
reflexo do primeiro em torno do centro de getWindowRect(). Os dois endpoints
expandem1.20x a separação em torno desse mesmo centro. Não se aplica a antiga
GREEN4/70 a este ensaio externo. Mantém o eixo, com até1grau de diferença
planejada por arredondamento; não afirma medir a rotação visual final.
Todos os pontos devem ficar no viewport e canvas do Story, longe dos controles
inferiores de publicação; caso contrário bloqueia antes da injeção. Não move o
sticker automaticamente. Viewport/screenshot divergentes também bloqueiam.

Exemplo calculado, não hardcoded: bounds[407,901][672,1017] e viewport1080x2400
produzem inside(659,935), outside(421,1465), endpoints(683,882)/(397,1518).
Esses pixels são recalculados a cada execução. Sem mínimo/tolerância novos.

Salva `short-emulator-pinch-report.json`, plano, ações, PNG/XML/JSON antes/depois
e `touch-injection-logcat.txt` coletado durante o teste. `success=true` exige
crescimento mensurável>=3px, drift válido, comando sem erro e evidência da
injeção com dois contatos aceita pelo Android. Qualificação dos três textos e
benchmark5/5 continuam pendentes; nenhum resultado deste ensaio reintegra ao
painel ou autoriza publicação. MOVE e os outros gestos permanecem intactos.

### Redução única no modelo externo espelhado

Após aumento real de Veja213→237px, drift0 e33 eventos aceitos sem falhas,
a próxima direção tem comando próprio:

```cmd
set DRY_RUN=true
set "GESTURE_STICKER_TEXT=Veja"
set GESTURE_STYLE_INDEX=0
npm run smoke:gesture-short-emulator-pinch-in
```

Mantenha o sticker branco/azul na região central e no tamanho deixado pelo
pinch-out. Não reduza manualmente antes. Confirme Enter com Ctrl/mouse soltos.
O comando calcula os pontos dos bounds atuais e aproxima ambos os contatos
em torno do centro do viewport com fator de distância1/1.20. Não reutiliza
coordenadas antigas nem muda a orientação intencionalmente. Aumentar20% ou
reduzir a separação por1/1.20 não prevê uma escala exata do sticker.

Só1gesto de redução, sem retry, reversão, benchmark ou publicação. Se estiver
no mínimo e não houver efeito, apenas registra falha desta direção. Não altera
mínimo, tolerância, MOVE ou os outros perfis. O comando original de aumento
continua com o comportamento anterior. PNG/XML/JSON e logcat são coletados.
Envie `short-emulator-pinch-in-report.json` e `touch-injection-logcat.txt` da
pasta `gesture-short-emulator-pinch-in-*`. Sucesso exige redução>=3px, drift
válido e injeção de dois contatos aceita, não a simples conclusão do comando.

### Cinco ciclos de repetibilidade de Veja — modelo externo

Após efeito real nas duas direções213→237→213px com drift0 e injeção aceita,
a geometria externa permanece fixa e pode ser repetida sem busca:

```cmd
set DRY_RUN=true
set "GESTURE_STICKER_TEXT=Veja"
set GESTURE_STYLE_INDEX=0
npm run smoke:gesture-short-emulator-cycles
```

Mantenha Veja pequeno branco/azul e central, no estado deixado pela redução
aprovada, com espaço para crescer. Confirme Enter uma vez, depois não interfira.
Máximo5ciclos, cada um com1aumento e1redução (10gestos). Todos recalculam os
pontos a partir dos bounds atuais, sem reset/reconstrução entre ciclos.
A primeira ausência de efeito, erro de comando, drift inválido ou falha de
injeção interrompe a bateria; não existe retry para obter artificialmente5/5.
O estado antes de cada gesto deve corresponder ao depois do gesto anterior.
Drift acumulado na bateria também respeita a tolerância de posição existente.

Cada gesto tem logcat marcado e artefatos próprios com prefixo de ciclo/direção,
para não sobrescrever os resultados anteriores. Logs válidos não substituem
transformação medida; as duas condições são exigidas para cada direção.
`short-emulator-cycles-report.json` é atualizado após cada ciclo e contém
`passed`, `total=5`, `qualified`, medidas e evidência por gesto. Erros abortados
preservam o progresso já salvo. A tabela resume aumento/redução de cada ciclo.

`qualified=true` neste relatório significa apenas cinco ciclos de Veja nesta
configuração, não a aprovação do controlador de precisão, dos três textos ou
de publicação. `mean_absolute_return_error_percent` é diagnóstico da distância
entre largura final e inicial de cada ciclo; não é erro contra um alvo de
layout e não altera a tolerância4%. Não executa o benchmark final de alvos,
reintegração, MOVE ou gestos dos textos padrão/longo. Nenhum mínimo é alterado.

### Precisão de alvos pequenos — somente Veja

Após repetibilidade real5/5 dos ciclos, o controlador isolado pode avaliar
alvos de aumento/redução10% com o mesmo gesto espelhado já validado:

```cmd
set DRY_RUN=true
set "GESTURE_STICKER_TEXT=Veja"
set GESTURE_STYLE_INDEX=0
npm run smoke:gesture-short-emulator-precision
```

Mantenha Veja branco/azul pequeno e central, no estado aprovado nos ciclos,
com espaço para crescer. Confirme Enter uma vez e não interfira. São5rodadas:
110%,90%,110%,90%,110%, sempre a partir da largura real medida no início de
cada rodada. Não é a bateria90%/80% nem valida mudanças grandes/posições novas.
O alvo é absoluto durante uma rodada e a tolerância continua RESIZE_TOLERANCE=.04.

O atuador permanece o mesmo: separação1.20 para aumentar e1/1.20 para reduzir,
sem converter isso numa previsão linear de escala do sticker. O controlador
escolhe a direção pelo erro medido, aplica no máximo3gestos e para imediatamente
em ±4%. Para também em NO_EFFECT, erro de comando/injeção, drift ou overshoot
fora de tolerância, sem oscilar e sem recalibração. A primeira rodada reprovada
interrompe a bateria. Cada gesto tem artefatos e logcat individuais.

Só usa mínimo persistido se o perfil exato Veja/texto/estilo/canvas/dispositivo/
versão corresponder ao registro. O mínimo504px do texto padrão nunca é usado
para Veja. Sem registro de Veja, observed_min_width=null e não se inventa um
limite a partir dos ciclos; um alvo que não puder ser atingido deve reprovar,
não mascarar a falha. Nenhum mínimo ou slider é modificado.

Salva `short-emulator-precision-report.json`: requested/effective_target_width,
final_width, error_percent, iterations, clamped, stop_reason e success por
rodada; passed/total/qualified e mean_absolute_error_percent no agregado.
O erro médio é contra os alvos de layout desta bateria, distinto do erro de
retorno dos ciclos anteriores. `qualified=true` qualifica somente este perfil
Veja e os alvos pequenos testados. O controlador continua isolado do painel,
sem alterar MOVE, os gestos dos outros textos, RSS/fila ou publicação.

### Precisão do modelo espelhado por texto

O ensaio de Veja permanece separado. Para avaliar o mesmo atuador no texto padrão,
use CMD com um único Link Sticker branco/azul central e espaço para crescer:

```cmd
set DRY_RUN=true
set "GESTURE_STICKER_TEXT=Leia a matéria completa"
set GESTURE_STYLE_INDEX=0
npm run smoke:gesture-text-emulator-precision
```

Pressione Enter uma vez quando pronto e não toque até terminar. O relatório
`text-emulator-precision-report.json` registra cinco alvos alternados +10%/-10%,
tolerância de 4%, coordenadas e evidência de injeção por gesto. A primeira falha
interrompe a bateria. O mínimo persistido só se aplica à configuração correspondente;
504 px não se aplica automaticamente a Veja nem ao texto longo. O texto longo
previsto é exatamente `veja a materia complata no jornal`, em execução separada.
A qualificação vale apenas para o texto declarado, configuração e alvos testados.
Este comando não integra o painel, não altera MOVE e não publica.

### Bateria final espelhada do texto padrão

Após os três ensaios separados de ±10%, use `npm run smoke:gesture-emulator-final`
com `DRY_RUN=true`, `GESTURE_STICKER_TEXT=Leia a matéria completa` e
`GESTURE_STYLE_INDEX=0`. Deixe um único sticker branco/azul central em tamanho
intermediário. A sequência é 90%, 80%, 110%, 90%, 110%, sempre da largura real
no início de cada rodada. Exige registro de mínimo confirmado de 504 px que
corresponda ao texto, estilo, dispositivo, canvas e versão declarada.

O relatório `final-emulator-resize-report.json` registra alvos solicitados e
efetivos, clamps, erros, gestos e evidência de injeção. Dentro de ±4% do alvo
 efetivo, para imediatamente, inclusive sem gesto se já estiver no mínimo.
Mantém máximo de três gestos por rodada e interrompe na primeira falha,
NO_EFFECT, drift inválido, erro de injeção ou overshoot fora da tolerância.
Não aumenta tolerância nem procura outro mínimo. Não reintegra nem publica;
o resultado real precisa ser revisado antes de qualquer integração.

### Investigação isolada 575 → 548

`smoke:gesture-mirror-convergence` exige texto padrão branco/azul e largura
570–580 px, preservada da falha da bateria final. Um Enter inicia até três
pinch-ins com fatores de distância 1/1.25, 1/1.30 e 1/1.35, diferentes do
fator anterior 1/1.20. Contatos continuam espelhados no centro da tela, com
mesmos tempos, trajetória segura e sem MOVE. Coordenadas completas, deslocamento,
bounds e injeção constam de `mirror-convergence-report.json` e capturas por gesto.
NO_EFFECT avança para outra amplitude, nunca repete a mesma. Dentro de ±4%
de 548, para; também para em overshoot, direção errada ou evidência inválida.
Não persiste mínimo, não troca o controlador dos ensaios aprovados, não executa
a bateria final nem integra/publica. Amplitudes são experimentais, dependem do
resultado real; testes de unidade não comprovam reconhecimento pelo Instagram.

### Mínimo confirmado apenas na sessão atual

Após o controle manual informar que o mesmo sticker de 575 px não reduz mais,
`npm run smoke:gesture-session-final` pode executar uma nova bateria com essa
observação explícita de sessão. Requer texto padrão, estilo 0, `DRY_RUN=true`
e um Enter de confirmação manual. Não executa novos testes de redução do mínimo.

O comando lê o relatório de convergência mais recente de `artifacts`, exige três
amplitudes distintas sem efeito com injeção válida, e confere texto declarado,
estilo, versão, identidade, dispositivo, canvas e bounds exatos contra o estado
atual. Evidência incompatível bloqueia o teste; não procura relatório antigo para
contornar a rejeição. A observação é salva junto aos novos artefatos em
`session-minimum-observation.json`, com origem, SHA256, data, snapshot e indicação
`session_only=true`. O operador confirma o controle manual; não há verificação
semântica automática do texto ou reconhecimento visual do estilo.

O registro global anterior de 504 px permanece intocado. A diferença entre os
mínimos continua sem causa identificada: não inferir equivalência completa de
configuração apenas dos metadados disponíveis. A observação de 575 vale apenas
para esta execução, não para outros textos, futuras sessões ou o painel.
`session-final-resize-report.json` usa a sequência 90/80/110/90/110 e ±4%, com
alvos solicitados e efetivos explícitos e sem gestos quando já dentro da faixa.
Uma aprovação vale apenas para a sessão declarada. Não altera resultados antigos,
não publica nem integra ao painel.

A liberação do controle manual pode deixar os bounds verticais levemente diferentes.
Na confirmação de sessão, admite-se somente até 4 px por borda vertical e até 1 px
no centro vertical, com bordas horizontais exatamente iguais. A observação guarda
`source_snapshot`, `reference_snapshot` e `vertical_bounds_changed`; não afirma
que o estilo ou a rotação foram verificados automaticamente. Os gestos continuam
exigindo estado estável e correspondência exata com o novo snapshot inicial.

### Integração ao teste do painel (sem publicação)

O botão existente **Configurações → Testar no Instagram** usa agora o modelo
`W3C_EMULATOR_MIRROR` para resize medido, seguido pelo MOVE W3C já existente.
Não confundir com o antigo pinch nativo: não há fallback nativo neste adaptador.
Mantém criação e transação de link do job atual; não aceita sticker manual antigo
como link criado pelo painel. Somente os três textos calibrados, estilo 0 e o
ambiente validado (emulator-5554, tela 1080×2400, canvas 1080×1920) são aceitos.
Outros estilos/textos exigem validação futura, sem tentativa silenciosa.

O resize mede alvo absoluto, aplica apenas o mínimo persistido da configuração
correspondente, usa ±4%, no máximo três gestos e para em NO_EFFECT, overshoot,
injeção inválida ou drift. Não transforma stall em mínimo. Registra as coordenadas,
as capturas e `panel-resize-report.json`, além de `test-layout.json` com alvo
solicitado/efetivo e clamp. Falha de resize impede MOVE e confirmação do layout.
O mínimo manual de 575 px, confirmado para outra sessão, NÃO é herdado pelo novo
Story. O histórico de 504 px continua separado; se o novo estado não atingir o
alvo, o teste falha honestamente para revisão. Slider e prévia continuam usando
apenas o registro conhecido por configuração, sem importar observações de sessão.

Para o primeiro teste integrado, iniciar/reiniciar o painel (`npm run admin`),
selecionar texto padrão branco/azul, tamanho 90%, posição horizontal 50% e
vertical 70%, salvar e usar **Testar no Instagram** com sistema preparado e conta
confirmada. Esse fluxo cria um Story de teste e termina no editor. O teste real
integrado ainda precisa ser executado localmente; mocks não substituem essa etapa.
Botões de publicação permanecem desativados. Não altera fila, RSS nem publicação.

### Diagnóstico isolado do estado de 575 px

```cmd
git pull --ff-only origin main
set DRY_RUN=true
set "GESTURE_STICKER_TEXT=Leia a matéria completa"
set GESTURE_STYLE_INDEX=0
npm run smoke:gesture-575-diagnostic
```

Exige um único sticker padrão branco/azul com largura medida de **575 px** no
editor, no ambiente calibrado (emulator-5554, tela 1080×2400, canvas 1080×1920).
Um Enter inicia o diagnóstico; solte Ctrl/mouse e não toque até terminar. Não
navega, recria Story, troca estilo, faz MOVE ou executa qualquer benchmark.
Se a largura for outra, bloqueia antes de gestos; não restaura o tamanho sozinho.

Comparação automática com artefatos locais reais:

- aprovado: `text-emulator-precision-report.json` do texto padrão, qualified=true,
  com redução medida e injeção confirmada;
- travado: `final-emulator-resize-report.json` da bateria que falhou, contendo a
  tentativa 575→575 no fator 1/1.20;
- a referência A é **reutilizada, sem reenviar o gesto já medido**;
- B: primeiro contato em 88%/35%, espelho na tela, fator 1/1.20;
- C: primeiro contato em 98%/22%, espelho na tela, fator 1/1.20;
- D: primeiro contato em 95%/29%, mesma distância inicial de A, fator 0.90
  (trajetória mais curta);
- E: mesma geometria e amplitude de A, dez steps de 120 ms em vez de 60 ms.

Não repete os fatores 1/1.25, 1/1.30, 1/1.35 do ensaio de convergência.
B/C/D/E têm no máximo **uma tentativa cada**, sem reset ou compensação. Para
na primeira redução >=3 px com injeção e drift válidos, ou em erro, direção
errada, alteração dos bounds que comprometa a comparação ou mudança visual que
exija revisão. Variantes restantes ficam NOT_EXECUTED; não são tratadas como
falhas nem como passes. Quatro NO_EFFECT encerram o diagnóstico sem insistir.

Saída em `artifacts/gesture-575-diagnostic-<timestamp>/`:

- `gesture-575-diagnostic-report.json`: bounds, largura/altura/centro, anchors,
  trajetórias completas, distâncias inicial/final, duração/steps, efeito e causa
  candidata (nunca causa comprovada automaticamente);
- `comparison.html`: comparação lado a lado do aprovado, do travado e de cada
  variante executada, incluindo capturas históricas quando ainda disponíveis;
- `<variante>-idle/before/after.png`, respectivos XML/JSON, e overlay
  `<variante>-pointers.svg` com bounds e coordenadas calculadas;
- `<variante>-touch-injection-logcat.txt`: log novo delimitado por marcador, sem
  limpar logcat; relatório lista eventos em ordem, timestamps, IDs/coordenadas
  quando expostos pelo driver e validade de DOWN → POINTER_DOWN → MOVE de dois
  contatos → POINTER_UP → UP. Duas chamadas ACTION_DOWN não são consideradas
  uma sequência válida de dois dedos.

Uma captura idle e outra before, sem gesto entre elas, medem ruído visual. A
diferença before/after compara pixels RGB decodificados na região do sticker,
não bytes comprimidos dos PNGs. Diferença acima do ruído com XML igual é apenas
candidata a mudança visual: pode ser fundo, estilo ou rotação. PNG não suportado
resulta em análise UNAVAILABLE, nunca em “sem mudança”. O HTML permite revisão.

**Limites da evidência:** DOWNs aceitos pelo driver não demonstram o hit-test
interno nem o reconhecimento do pinch pelo Instagram. O segundo contato fica
intencionalmente fora do sticker no modelo espelhado que já funcionou. O teste
informa início/fim fora do retângulo XML e cruzamento das bordas; a área interativa
real continua UNKNOWN. Não muda tolerância, mínimo conhecido, controlador do
painel, RSS, fila ou publicação. Nenhum mínimo é aprendido do stall.

Os relatórios históricos são buscados nos diretórios locais originais. Preserve
`artifacts`; se os arquivos não existirem, o teste bloqueia sem gestos. Caminhos
explícitos opcionais: `GESTURE_575_APPROVED_REPORT` e `GESTURE_575_STALLED_REPORT`.
A indisponibilidade do log histórico ou das imagens é registrada, não substituída
por eventos/coordenadas inventados. No cloud sem o emulador local, typecheck,
build e testes de unidade validam o diagnóstico; causa e variante eficaz dependem
da execução real e da leitura das novas capturas.

### Chave “Incluir sticker com link”

Em **Configuração do Story**, a chave visível usa `story.sticker.enabled`:

- ligada (padrão): mantém imagem → aplicar link/texto → resize medido → MOVE;
- desligada: imagem → confirmar editor sem stickers → pronto para conferência.

Desligar oculta o sticker da prévia e desabilita os campos de link/tamanho/posição,
sem apagar as opções salvas. O teste “somente movimento” fica oculto, e o servidor
também o rejeita nesse modo. Salve a configuração antes de testar. A URL original
da matéria pode permanecer como metadado na fila; não é inserida no Story sem link.

O worker congela modo e configuração com SHA256. Carrega a configuração da conta
usada pelo painel, não uma cópia antiga do armazenamento inicial. Mudar a chave
não modifica uma execução em curso. O scheduler registra `content_mode` e
`sticker_enabled` na configuração efetiva quando inicia uma tarefa; imagem-only
não depende de limite de texto nem exige confirmação de link inexistente. Os jobs
antigos sem `content_mode` continuam com o contrato de link. RSS, prioridades,
deduplicação, limites de postagem e verificação da conta não mudam.

O novo caminho de imagem limpa evidências de link/layout da sessão anterior,
exige Home antes da imagem nova, confirma STATE_EDITOR com zero stickers e salva
`image-only-prepared.png/.xml/.json` e `test-result.json`. O resultado declara
IMAGE_ONLY, link_steps_skipped=true, sticker_added=false, url_verified=false,
move_command_sent=false e resize_command_sent=false. Não usa uma confirmação
falsa de link e não enfraquece os guards do fluxo com link. Se restar um sticker
ou o editor estiver incorreto, o teste falha.

**Publicação real permanece desativada em ambos os modos.** O adapter de
publicação da fila continua desconectado; esta entrega prepara os modos e os
valida pelo teste local, sem postar. O modo ligado conserva as restrições atuais
de texto/estilo/ambiente do resize. Nenhum novo ajuste em MOVE ou tolerância.

Teste local: atualizar main, reiniciar painel com `npm run admin`, abrir
Configuração do Story, desligar **Incluir sticker com link**, salvar e usar
**Testar no Instagram**. O teste cria um Story com a arte de exemplo e termina no
editor, sem sticker e sem publicar. Depois, ligar/salvar restaura o caminho com
link. A execução Android dos dois modos deve ser conferida localmente.
