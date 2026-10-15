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

O resize verifica se o dispositivo, objeto e bounds atuais correspondem ao final do relatório. Se o editor mudou, refaça MOVE. O relatório é evidência operacional local, não autorização para publicar. Cinco rodadas usam 90%, 110%, 80%, 110%, 90% relativos ao tamanho no início de cada rodada. Até quatro correções pequenas, máximo 10% por iteração, medição após cada gesto; tolerância ±3% de largura e limite de deriva de centro. Não há movimento deliberado durante resize. Native usa pinchCloseGesture/pinchOpenGesture; `GESTURE_RESIZE_METHOD=W3C` permite comparação explícita com dois pointers. Não há fallback automático de pinch. `GESTURE_SCALE=0.8`, `0.9` ou `1.1` executa um alvo isolado; isso não prova 5/5.

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
