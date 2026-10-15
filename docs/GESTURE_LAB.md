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

O resize verifica se o dispositivo, objeto e bounds atuais correspondem ao final do relatório. Se o editor mudou, refaça MOVE. O relatório é evidência operacional local, não autorização para publicar. Cinco rodadas usam 90%, 110%, 80%, 110%, 90% relativos ao tamanho no início de cada rodada. Até cinco tentativas por faixas de erro, com a quinta reservada para correção após overshoot, medição após cada gesto; tolerância ±3% de largura e limite de deriva de centro. Não há movimento deliberado durante resize. Native usa pinchCloseGesture/pinchOpenGesture; `GESTURE_RESIZE_METHOD=W3C` permite comparação explícita com dois pointers. Não há fallback automático de pinch. `GESTURE_SCALE=0.8`, `0.9` ou `1.1` executa um alvo isolado; isso não prova 5/5.

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

O controlador não envia diretamente `target/current` como intensidade e não extrapola ganho linear. Mantém o alvo absoluto inicial. Usa faixas de erro: >15% começa com força 0,20 (limite 0,30); 8–15% começa com 0,10 (limite 0,20); 3–8% começa com 0,10 (limite 0,15). Esses parâmetros são candidatos conservadores baseados nas amostras locais, não limiares universais comprovados. NO_EFFECT é alteração menor que 3 px; sobe a força em 0,025, sem repetir o gesto ignorado. Se ultrapassar o limite da faixa, aborta em vez de insistir. Observações de força/ganho ficam locais à rodada e ajudam a escolher uma força menor já efetiva, mas não determinam escala proporcional.

Overshoot é cruzar a largura alvo; a próxima tentativa usa a direção oposta com intensidade menor, respeitando o piso candidato 0,10. Se estiver dentro de ±3%, para imediatamente, mesmo tendo cruzado o alvo. Há no máximo cinco tentativas; sem overshoot anterior, a quinta não é gasta em outra tentativa na mesma direção. O relatório informa stop_reason para diferenciar tolerância, limite de faixa e reserva de correção.

O benchmark faz primeiro uma prova isolada de aumento de 10%, registrando `pinch_out_probe`. Se não houver aumento de pelo menos 3 px sem erro, `PINCH_OUT_SUPPORTED=false` e as cinco rodadas ficam bloqueadas. Havendo suporte observado, as rodadas usam 90%, 80%, 110%, 90%, 110%. `npm run smoke:gesture-pinch-out` permite executar apenas a prova, usando a mesma exigência de GESTURE_MOVE_REPORT e correspondência do editor atual. O suporte não equivale a convergência nem qualificação.
Cada iteração contém attempt, direction, strength, before_width, after_width, delta_px, effect_ratio e no_effect. O relatório inclui erros antes/depois em pontos percentuais, overshoot, PINCH_IN_SUPPORTED, PINCH_OUT_SUPPORTED e initial_width, target_width, final_width, error_percent (em pontos percentuais), minimum_observed_effective_strength, last_no_effect_strength e observed_gain_per_strength. `minimum_observed` é somente o menor valor que funcionou nas amostras, não prova um limiar mínimo universal. Native percent é parâmetro do UiAutomator2, não uma escala garantida do sticker. O benchmark só marca calibrated=true com cinco rodadas aprovadas. MOVE permanece inalterado.

Para repetir a bateria completa sem configuração residual de alvo único no PowerShell:

```powershell
$env:GESTURE_RESIZE_METHOD = 'NATIVE'
Remove-Item Env:GESTURE_SCALE -ErrorAction SilentlyContinue
npm run smoke:gesture-benchmark
```

Isso refaz o MOVE existente para obter evidência no editor atual e só então executa as cinco rodadas de RESIZE. Não publica e não reintegra ao painel.
