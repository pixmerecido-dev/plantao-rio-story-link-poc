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
Confira `near-min-report.json` no diretório indicado. Somente após `success=true`:

```cmd
set "GESTURE_NEAR_MIN_REPORT=C:\caminho\completo\near-min-report.json"
npm run smoke:gesture-benchmark
```

O caminho deve apontar para o relatório real recém-gerado. O CLI valida PASS,
faixa inicial, tolerância, alvo, método, identidade visual, dispositivo, canvas e
configuração antes de qualquer rodada do benchmark. Também exige essa prova
para o benchmark de resize sem escala individual. MOVE permanece sem mudanças.
Mocks não qualificam o gesto Android; envie os dois relatórios reais para análise.
