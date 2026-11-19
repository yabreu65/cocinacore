# F56 — Pausa preventiva de embeddings PDF

Base: f5d3360690098e013aedac738c0fcc8b6e047d37. Issue #124.

Evidencia: lote de 100 correcto a las 23:23:55 UTC, segundo lote 429 a las 23:23:56, reintentos 429 a las 23:23:59 y 23:24:01. El máximo observado del nivel gratuito en AI Studio es 100 entradas por minuto; las demoras de RetryInfo pueden ser menores que la ventana necesaria. La carga no llegó al multipart.

Decisión: intervalo conservador fijo de 61 segundos después de cada lote exitoso antes de iniciar el siguiente; si se recibe un 429 con demora explícita utilizable, esperar el mayor de 61 segundos y la demora indicada. Mantener máximos previos de 120 segundos por espera de reintento, dos reintentos por lote y seis por carga. No reducir lotes, ampliar cuota, cambiar proveedor ni introducir nuevos servicios. Si falta una demora utilizable, detener según el contrato anterior. Mostrar pausa preventiva en interfaz. Es una medida local por carga, no un limitador global; otros clientes o cuota diaria pueden impedir completar una ingesta.

Aceptación: reloj simulado demuestra ausencia de llamadas antes de 61 segundos, conservación de orden y lotes exitosos, espera mayor indicada por proveedor, parada acotada ante cuota persistente. Sin llamadas reales, credenciales, permisos, cambios SQL o despliegue.

## Evidencia local
- 35/35 pruebas focalizadas; ESLint, TypeScript y build PASS.
- Reloj simulado reproduce Retry-After de 3 segundos, acredita pausa preventiva de 61 segundos, demora de 120 segundos respetada y parada tras dos reintentos.
