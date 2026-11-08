-- Disposable-only populated document/RAG rows for the 020D3 preflight and RLS suite.
BEGIN;
INSERT INTO public.tenant_books(id, tenant_id, title, author, description) VALUES
  ('99200000-0000-4000-8000-000000000001','99100000-0000-4000-8000-000000000001','Private A cookbook','Author A','Private A metadata'),
  ('99200000-0000-4000-8000-000000000002','99100000-0000-4000-8000-000000000002','Private B cookbook','Author B','Private B metadata');
INSERT INTO public.global_books(id, title, description, cuisine_region) VALUES
  ('99200000-0000-4000-8000-000000000003','Global cookbook','Public global metadata','Global');
INSERT INTO public.global_pdf_library(id, global_book_id, storage_path, file_size_bytes, page_count, checksum_sha256, uploaded_by) VALUES
  ('99200000-0000-4000-8000-000000000004','99200000-0000-4000-8000-000000000003','global/fixture.pdf',1024,4,'d3-global-checksum','99100000-0000-4000-8000-000000000003');
INSERT INTO public.tenant_pdf_library(id, tenant_id, tenant_book_id, storage_path, page_count, uploaded_by, processing_status) VALUES
  ('99200000-0000-4000-8000-000000000010','99100000-0000-4000-8000-000000000001','99200000-0000-4000-8000-000000000001','tenant-a/private-a.pdf',8,'99100000-0000-4000-8000-000000000003','ready'),
  ('99200000-0000-4000-8000-000000000011','99100000-0000-4000-8000-000000000002','99200000-0000-4000-8000-000000000002','tenant-b/private-b.pdf',9,'99100000-0000-4000-8000-000000000005','ready'),
  ('99200000-0000-4000-8000-000000000012','99100000-0000-4000-8000-000000000001','99200000-0000-4000-8000-000000000002','tenant-a/cross-tenant-parent.pdf',10,'99100000-0000-4000-8000-000000000003','ready'),
  ('99200000-0000-4000-8000-000000000014','99100000-0000-4000-8000-000000000001',NULL,'tenant-a/delete-me.pdf',2,'99100000-0000-4000-8000-000000000003','ready');

-- Intentionally violate only FK relationships to prove parent existence is
-- checked by RLS, not inferred from an application WHERE clause.
SET LOCAL session_replication_role = replica;
INSERT INTO public.tenant_pdf_library(id, tenant_id, tenant_book_id, storage_path, uploaded_by, processing_status) VALUES
  ('99200000-0000-4000-8000-000000000013','99100000-0000-4000-8000-000000000001','99200000-0000-4000-8000-000000000099','tenant-a/orphan-parent.pdf','99100000-0000-4000-8000-000000000003','ready');
INSERT INTO public.book_chunks(id, tenant_id, global_book_id, tenant_book_id, source_type, content, metadata, embedding) VALUES
  ('99200000-0000-4000-8000-000000000030','99100000-0000-4000-8000-000000000001',NULL,'99200000-0000-4000-8000-000000000001','tenant_pdf','private A chunk','{"fixture":"private-a"}',array_fill(1::real, ARRAY[1536])::vector(1536)),
  ('99200000-0000-4000-8000-000000000031','99100000-0000-4000-8000-000000000002',NULL,'99200000-0000-4000-8000-000000000002','tenant_pdf','private B chunk','{"fixture":"private-b"}',array_fill(1::real, ARRAY[1536])::vector(1536)),
  ('99200000-0000-4000-8000-000000000032',NULL,'99200000-0000-4000-8000-000000000003',NULL,'global_pdf','valid global chunk','{"fixture":"global"}',array_fill(1::real, ARRAY[1536])::vector(1536)),
  ('99200000-0000-4000-8000-000000000033','99100000-0000-4000-8000-000000000001',NULL,'99200000-0000-4000-8000-000000000001','global_pdf','spoofed global private chunk','{"fixture":"spoof"}',array_fill(1::real, ARRAY[1536])::vector(1536)),
  ('99200000-0000-4000-8000-000000000034','99100000-0000-4000-8000-000000000001',NULL,'99200000-0000-4000-8000-000000000002','tenant_pdf','cross-parent private chunk','{"fixture":"cross-parent"}',array_fill(1::real, ARRAY[1536])::vector(1536)),
  ('99200000-0000-4000-8000-000000000035',NULL,NULL,NULL,'ai_generated','ambiguous AI chunk','{"fixture":"ai-generated"}',array_fill(1::real, ARRAY[1536])::vector(1536)),
  ('99200000-0000-4000-8000-000000000036','99100000-0000-4000-8000-000000000001',NULL,'99200000-0000-4000-8000-000000000099','tenant_pdf','missing private parent chunk','{"fixture":"orphan-private"}',array_fill(1::real, ARRAY[1536])::vector(1536)),
  ('99200000-0000-4000-8000-000000000037',NULL,'99200000-0000-4000-8000-000000000099',NULL,'global_pdf','missing global parent chunk','{"fixture":"orphan-global"}',array_fill(1::real, ARRAY[1536])::vector(1536));
SET LOCAL session_replication_role = origin;
COMMIT;
