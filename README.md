# Liquidity Lab V6

Aplicación local para transformar datos públicos de Binance en un plan operativo explicable. No envía órdenes, no requiere API key y no usa datos pagos de CoinGlass.

## Inicio rápido en Windows

1. Extraer la carpeta completa.
2. Hacer doble clic en `INICIAR_APP.bat`.
3. La primera apertura instala las dependencias y puede demorar algunos minutos. Luego se abre en `http://localhost:3100`.

También se puede iniciar manualmente con `npm install` y `npm run dev`. Requiere Node.js 22.13 o posterior.

## Qué calcula

- Order book spot: agrupa hasta 5.000 niveles por lado en bandas de aproximadamente 0,15%, calcula nocional, fuerza relativa y precio ponderado de cada cluster. El ranking no recorta por distancia.
- Radar macro: complementa la profundidad limitada del libro con los nodos de mayor volumen histórico en 120 velas de 4h y 1d, claramente identificados como estimaciones y no como órdenes actuales.
- Persistencia: el navegador conserva durante 7 días qué bandas reaparecieron. Es local al dispositivo y se actualiza con cada análisis manual.
- Order flow: clasifica los últimos 1.000 `aggTrades` según el lado agresor y calcula delta comprador/vendedor por nocional.
- Estructura: velas 15m, 1h, 4h y 1d con EMA 10/55/200, RSI 14, MACD 12/26/9, Bollinger 20/2 y ATR 14.
- Gráfico operativo: velas reales con selector 15m/1h/4h/1d y superposición de spot, E1/E2/E3, target, invalidación y secuencia planificada.
- Cada selector temporal recalcula el plan completo con el ATR, alcance y muros adecuados del marco elegido; no cambia únicamente la visualización de velas.
- El selector de activos carga dinámicamente todos los pares spot USDT que Binance informa como activos.
- Derivados USD-M: open interest actual, variación aproximada de 2h30 y funding de 8 horas cuando Binance los ofrece para el símbolo.
- Liquidaciones: niveles teóricos para 5×, 10×, 20× y 50× con un margen de mantenimiento simplificado. No son posiciones reales.
- Direction Engine: pondera más 4h/1d que 15m/1h, suma order flow y reduce señales cuando el funding está cargado.
- Execution Engine: combina nodos históricos 4h/1d, liquidaciones estimadas, EMA 200 de 4h y confirmación del libro visible. El snapshot no se confunde con las zonas estructurales lejanas.
- Forecast Engine: identifica régimen y volatilidad, secuencias de máximos/mínimos y rupturas estructurales, rango esperado por ATR y tres caminos condicionados que siempre suman 100%.
- Mapa de valor: calcula Volume Profile aproximado, POC, área de valor, VWAP y VWAP anclado sobre las velas del marco operativo.
- Contexto cruzado: compara el activo con BTC mediante tendencia, correlación y fuerza relativa, y combina la variación del precio con el cambio de open interest y el basis de futuros.
- Filtro de ejecución: un pronóstico puede tener dirección clara y aun así quedar en “Esperar” cuando el R:R es menor a 1,20, la confianza es insuficiente o BTC contradice la operación.
- Confirmación en zona: exige precio dentro de E1 y evalúa order flow, estructura, reacción de vela, muro visible y contexto de BTC antes de considerar confirmada una entrada.
- Vencimiento: cada plan tiene una duración acorde con 15m, 1h, 4h o 1d; un plan viejo no permanece operativo indefinidamente.
- Simulación persistente: conserva el plan y registra E1/E2/E3, TP, invalidación o vencimiento entre actualizaciones y reinicios del navegador.
- Riesgo monetario: incorpora apalancamiento, comisión, slippage, pérdida máxima, presupuesto de riesgo y margen sugerido.
- Historial y alertas: guarda hasta 200 simulaciones y 50 eventos localmente, calcula win rate y resultado neto, y permite exportar CSV.
- Validación histórica proxy: evalúa señales técnicas anteriores con objetivo 1,5 ATR, stop 1 ATR y vencimiento de 16 velas. No reconstruye libros u OI pasados.
- Calidad de muros: diferencia niveles nuevos, persistentes, crecientes o en retirada comparando snapshots sucesivos.
- Confirmación externa: compara precio y balance visible entre Binance y Bybit, y agrega el libro de futuros de Binance como contexto, sin convertirlo en un disparador autónomo.
- Radar de oportunidades: analiza manualmente los pares USDT de mayor volumen en 4h antes de abrir el análisis completo.
- Pausa por evento: bloqueo manual de nuevas simulaciones durante noticias o eventos que el modelo no pueda interpretar.
- Gráfico ampliado: permite activar o desactivar EMA 10/55/200, POC, VWAP y límites del área de valor.
- WebSocket: precio, mejor bid/ask, desequilibrio del primer nivel y delta de aggTrades de los últimos 60 segundos se actualizan en tiempo real; el motor completo conserva su snapshot periódico para evitar recalcular con cada tick.
- Almacenamiento D1: snapshots compactos, simulaciones y eventos se guardan en una base estructurada con índices por símbolo, temporalidad y fecha. Si el enlace no existe, la UI informa el fallback local.
- Laboratorio estadístico: resuelve automáticamente cada pronóstico almacenado como TP, invalidación, vencimiento o plan no activado. Solo los casos que tocaron E1 alimentan las métricas de desempeño.
- Muestras independientes: el siguiente pronóstico evaluado empieza después de terminar el anterior, evitando inflar la muestra con snapshots superpuestos.
- Calibración progresiva: calcula Brier score, log loss, error de calibración y frecuencia observada por bandas de confianza.
- Validación temporal: separa cronológicamente 70% de muestra inicial y 30% fuera de muestra, controla deriva reciente y desglosa resultados por régimen.
- Puertas de evidencia: informa recolección, validación inicial, calibración, evidencia sólida o revisión necesaria según 30/100/300/1.000 casos resueltos.
- Confianza calibrada: reemplaza la puntuación heurística por frecuencia observada únicamente cuando existen al menos 30 resultados totales y 20 en su banda; antes lo declara explícitamente.
- Comparación de modelos: enfrenta un baseline EMA 10/55 contra el filtro técnico completo sobre exactamente las mismas velas y presenta diferencia de expectativa en R.
- Replay: permite recorrer la historia disponible sin usar velas posteriores al punto seleccionado.
- Salud de fuentes: muestra estado del WebSocket, Binance spot, derivados, Bybit, latencia total y último snapshot.
- Riesgo diario: bloquea nuevas simulaciones al superar el límite de pérdida configurado y mantiene una sola operación simulada simultánea para evitar sobreexposición.
- Notificaciones del sistema: puede avisar entradas, TP, invalidación y vencimiento con permiso explícito del navegador.
- Ejecución segura: las órdenes reales permanecen explícitamente bloqueadas; no se almacenan claves ni se envían operaciones.

## Reglas operativas V1

- Máximo de tres entradas. E1/E2/E3 siempre aparecen como plan; cuando el sesgo es neutral quedan marcadas como condicionales y no se recomienda ejecutar.
- Distribución predeterminada: 40/35/25. El usuario puede modificar capital y pesos; si no suman 100, se normalizan proporcionalmente.
- El precio de cada cluster es ponderado por liquidez, no el centro geométrico de la zona.
- Target: 0,15% antes de la primera pared contraria suficientemente distante. Si no existe, usa la banda de Bollinger de 4h con un mínimo de 1,2% desde spot.
- Invalidación: detrás de E3 a una distancia basada en el mayor valor entre 0,6% del spot y 0,35 ATR de 4h.
- La interfaz muestra promedio tras cada entrada, rebote necesario desde E3 a break-even, rebote hasta TP y relación riesgo/beneficio.
- Debajo del gráfico se explica cómo interpretar cada línea y qué hacer antes de E1, al activar cada entrada, al alcanzar el target o al tocar la invalidación.
- Todo el análisis se actualiza automáticamente cada 30 segundos, además del botón de actualización manual y el indicador visible de antigüedad.

## Límites importantes

- Las órdenes del libro pueden cancelarse y crear falsos muros. Binance expone como máximo los 5.000 mejores niveles por lado; no existe paginación pública para ver órdenes todavía más lejanas.
- Las zonas macro provienen de volumen histórico negociado y no deben confundirse con órdenes limitadas actualmente abiertas.
- Los últimos 1.000 trades son una ventana por cantidad, no por duración fija.
- El mapa de liquidaciones es un modelo orientativo; Binance no publica el precio de liquidación de todas las cuentas.
- Las probabilidades comienzan como puntuaciones heurísticas. Solo pasan a mostrarse como calibradas cuando la base alcanza los mínimos definidos; aun entonces describen frecuencia histórica, no garantizan el próximo movimiento.
- El historial, la simulación, la configuración y las alertas se guardan en este navegador; no se sincronizan entre dispositivos ni representan operaciones reales.
- La validación histórica es un proxy técnico. Un backtest exacto del modelo completo requeriría snapshots históricos del libro, aggTrades, OI y funding sincronizados, que las consultas actuales no reconstruyen.
- La comparación con Bybit es complementaria y puede quedar no disponible por símbolo, región o latencia sin bloquear el análisis principal de Binance.
- El WebSocket aporta seguimiento inmediato, pero una desconexión puede omitir ticks; la salud visible de la fuente debe estar en estado operativo antes de confiar en una alerta.
- El producto está deliberadamente limitado a análisis, pronóstico, especulación y simulación. No solicita credenciales ni incluye ninguna ruta para enviar órdenes reales.
- La simulación estima comisiones y slippage configurables, pero no reconstruye con exactitud el llenado intravela, la cola de ejecución ni el tamaño mínimo de cada mercado.
- La resolución estadística observa snapshots discretos. Si el precio atraviesa varios niveles entre dos capturas, no puede reconstruir el orden exacto de esos cruces.
- Si Binance bloquea el acceso por red o región, la aplicación informa el error y no inventa datos.
- Es una herramienta analítica y educativa, no asesoramiento financiero.

## Estructura modular

- `app/api/analyze/route.ts`: adquisición de datos y tolerancia a fallos de derivados.
- `app/api/lab/route.ts`: resolución independiente de pronósticos, calibración y validación temporal.
- `lib/indicators.ts`: indicadores técnicos sin dependencias externas.
- `lib/engine.ts`: clusters, liquidaciones, Direction Engine y Execution Engine.
- `app/page.tsx`: interfaz, configuración e historial local de muros.
