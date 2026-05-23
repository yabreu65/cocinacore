# CocinaCore E2E Checklist

1. Signup/Login funciona y redirige a `/app`.
2. Si `users.onboarding_completed = false`, `/app` redirige a `/onboarding`.
3. Completar onboarding marca `onboarding_completed = true` y vuelve a `/app`.
4. En `/app` se puede:
   - Agregar ingrediente (tabla `recipe_inventory_items`)
   - Subir PDF (Storage bucket `tenant-pdfs` + `tenant_pdf_library`)
   - Ver estado de procesamiento (`processing`/`ready`/`failed`)
   - Ver badge OCR por PDF.
5. En `/recipes/search`:
   - Se crean embeddings vía `/api/embeddings`
   - Se consulta `match_chunks`
   - Se genera receta vía `/api/recipe-generate`
   - Se muestran citas (book/page/similarity).
