# Private tenant PDF storage

The tenant adapter is separate from global PDF storage. Provision a dedicated private bucket and a dedicated RustFS identity; never use root or global-library credentials for application access. The adapter is connected to the authenticated private-PDF API (PR #154), but remains unavailable in the original Docker until dedicated RustFS credentials and migration 025 are provisioned. The server derives the tenant ID from authenticated context and authorizes each operation; callers must not supply an untrusted tenant ID as authority.

## Configuration

Set `STORAGE_DRIVER=s3`, `S3_TENANT_BUCKET`, `S3_TENANT_ACCESS_KEY_ID`, `S3_TENANT_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, and `S3_REGION` in the server environment through your secret manager. Values are intentionally omitted. The tenant bucket and access key must differ from `S3_BUCKET` and `S3_ACCESS_KEY_ID`. The adapter uses path-style S3 requests. Missing configuration fails closed; there is no global credential fallback. Never expose these variables to the browser.

`STORAGE_DRIVER=local` is for testing; store its `LOCAL_UPLOAD_DIR` outside any publicly served directory. Neither driver returns a public URL.

## RustFS custom IAM policy

Attach a custom IAM policy like the following to the dedicated tenant service identity, replacing `TENANT_BUCKET` with the actual dedicated bucket name. This is an **identity policy**, not a public bucket policy. Do not grant this identity global-bucket access, bucket administration, listing, or permissions outside the private prefix. Keep anonymous access disabled and verify the effective permissions and policy syntax against the deployed RustFS version before enabling it.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::TENANT_BUCKET/tenant-pdfs/*"]
    }
  ]
}
```

The policy limits the service identity to the dedicated bucket and prefix; it does **not** isolate tenants from one another. The application must enforce authenticated tenant ownership before calling the adapter, which also checks canonical UUID paths on deletion. Ensure no other policy grants this identity broader access. This document does not authorize provisioning or production changes.

## Plan de aprovisionamiento operativo

La política revisable para este despliegue es `scripts/standalone-tenant-pdf-policy.json`. No dar permisos de `s3:ListBucket`, `s3:GetObject` ni acceso a `cocinacore-documents`. El contrato estático se prueba con `node scripts/tests/test-tenant-pdf-policy-contract.cjs`.

El stack existente dispone del servicio opcional `storage-init` con el cliente `rustfs/rc`, orientado a operaciones administrativas. El acceso root únicamente puede usarse durante el aprovisionamiento autorizado, desde un entorno administrativo aislado y sin mostrar/exportar secretos por herramientas de conversación. La aplicación deberá usar **exclusivamente una nueva identidad con esta política**.

En el RustFS original la consola web está expresamente deshabilitada (`RUSTFS_CONSOLE_ENABLE=false`) y el API de almacenamiento está aislado en la red Docker. No publicar ni reiniciar su consola antes de contar con respaldo verificable, ventana de mantenimiento y plan de reversión. La consola se habilita mediante `RUSTFS_CONSOLE_ENABLE=true` y escucha normalmente en el puerto 9001; si se habilita transitoriamente, publicar solo en `127.0.0.1` y deshabilitar tras el aprovisionamiento.

Al obtener acceso administrativo autorizado, comprobar el siguiente orden: respaldo actual → bucket `cocinacore-tenant-pdfs` → identidad IAM independiente con la política fijada → pruebas de permisos positivos (PUT y DELETE en `tenant-pdfs/*`) y negativos (GET/LIST, acceso global y PUT fuera de prefijo) → configurar las variables privadas en `CC_APP_ENV` → migración 025 por el migrador canónico → E2E real con PDF sintético → verificar salud de los cinco servicios.

**No realizado en esta revisión:** creación del bucket o IAM original, conexión de secretos, migración 025 sobre la base existente y despliegue. El proveedor Gemini sí aprobó la prueba real con un PDF sintético; la identidad RustFS definitiva requiere comprobación aparte.
