# F56 — Ajuste conservador de cuota gratuita de embeddings

Base: fccfb83602fd27d87145e6cf3d3ff312c8606cda (PR #128). Issue #124.
Alcance aprobado por el propietario: adaptar los lotes PDF a los límites gratuitos observados.

AI Studio: máximos históricos 200/100 RPM, 39.12k/30k TPM y 808/1000 RPD.
Reducir lotes a 60 entradas y 20 000 bytes UTF-8 de texto; pausa preventiva de 65 segundos. Los bytes son una aproximación conservadora, no un conteo exacto de tokens. No se implementa un contador diario ni global. Se conservan modelo, dimensiones, orden de fragmentos, límites de reintentos y controles de acceso.

Evidencia previa al commit: 18/18 pruebas PDF, 40/40 pruebas focalizadas incluyendo API PDF, Gemini, RAG y citas; ESLint focalizado, TypeScript y diff --check aprobados. Las pruebas simulan el proveedor; no consumen cuota. Se comprueba texto multilingüe y no truncación.

Candidato exclusivamente local. El hook nativo sigue obligatorio. No sustituye CI, E2E ni aceptación manual. No se autoriza la actualización de F56, integración definitiva en main ni publicación de una versión no aprobada. La prueba real de carga sigue pendiente.
