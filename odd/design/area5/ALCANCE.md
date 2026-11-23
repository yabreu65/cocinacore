# CocinaCore Bistró — Área 5: estados y recorridos transversales

**Fecha:** 22 de noviembre de 2026. **Estado:** propuesta visual lista para revisar, no integrada en la aplicación.

## Razón para definir el área

El inventario actual de frontend/src/app contiene 38 rutas de página. Todas están agrupadas en las Áreas 1 (20), 2 (6), 3 (4) y 4 (8). No existe un quinto grupo de rutas pendientes. Para no inventar una nueva página ni funcionalidad, se propone que Área 5 sea una revisión de experiencias que atraviesan páginas existentes.

## Propuestas para revisión

1. /app — **Orientación**: decisión principal «Cocinar ahora» y salida a planificación; acceso a opciones sin duplicación.
2. /meal-planner — **Espera**: comunicar que la propuesta de IA está en curso, sin porcentajes o tiempos inventados; separar preparación de guardado.
3. /shopping-list — **Vacío**: explicar qué significa no tener compras, con las acciones ya existentes para agregar un ingrediente o volver al planificador.
4. /meal-planner — **Error recuperable**: mensaje claro sin detalles internos, posibilidad de reintentar sin duplicar modificaciones.
5. /shopping-list — **Compra real e inventario**: confirmar cantidad realmente comprada, no usar la estimación como compra verificada, mantener el requisito de confirmación explícita.

## Alcance de la propuesta

El enlace revision-area5.html es una **maqueta interactiva autocontenida**, sin conectarse con CocinaCore o sus APIs. Los ejemplos son ilustrativos. «Antes» es un esquema conceptual de patrones/textos ya presentes en las páginas, **no** una captura literal; «Después» es una dirección de diseño, **no** código integrado. Las acciones del prototipo explican que no realizan operaciones reales.

## Verificaciones de maqueta

- Cinco escenarios en móvil de 390 px y escritorio de 1440 px.
- Diez capturas de diseño generadas sin errores de consola ni desbordamientos horizontales.
- Botones de demostración comprobados sin llamadas de red que cambien datos.
- Antes de integrar cambios reales requerirá aprobación, implementación acotada, pruebas de flujo y evidencia Antes/Después tomada sobre la aplicación real.

## No incluido

Sin nuevos endpoints, cambios de roles, Docker, cuenta de propietario, migraciones, producción, pagos, servicios de IA o modificaciones al inventario real. Área 5 queda pendiente de revisión visual.

## Verificación adicional del prototipo

En el escenario de compras, el control de cantidad es editable. La demostración impide confirmar cantidades nulas o negativas; una cantidad válida muestra una confirmación simulada con la unidad elegida, sin ninguna operación contra el backend. No se convierte una estimación en compra real sin confirmación.
