# F56 — Cuota de embeddings

Base: 84d8632fa18def41e22016df2c9b58feaf3b0c36.

Evidencia real: después de configurar la URL oficial, primer lote de 100 embeddings exitoso, segundo lote HTTP 429 del proveedor. La causa concreta de cuota (RPM, TPM, diario, facturación u otra) no está identificada. El cliente recibe 502 genérico actualmente.

Objetivo: preservar HTTP 429 y únicamente instrucciones de reintento estructuradas (Retry-After / Google RetryInfo), con mensaje seguro, sin exponer respuesta privada. El cliente solo reintenta el lote rechazado cuando existe una demora explícita entre 1 y 120 segundos, respetando esa demora, máximo dos reintentos por lote y seis por operación. No reinicia lotes aprobados durante la operación, no modifica el limitador local, no aumenta cuotas, no cambia proveedor ni modelo. Si no hay demora utilizable o se agota el presupuesto de reintentos, detiene la carga sin publicar índice parcial.

Alcance: código de diagnóstico y manejo de error, pruebas con mocks; ninguna llamada real adicional, credencial, permiso, RLS, migración ni despliegue. Corregir también el espacio de la advertencia de cobertura.

## Evidencia local
- 32/32 pruebas focalizadas, ESLint, TypeScript y build: PASS.
- Se verificó en mocks que el segundo lote espera exactamente la demora indicada y no repite el primer lote; ausencia de demora, demora excesiva y cuota persistente detienen el proceso.
