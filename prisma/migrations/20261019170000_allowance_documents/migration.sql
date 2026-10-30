-- CreateTable
CREATE TABLE "allowance_documents" (
    "id" UUID NOT NULL,
    "allowance_id" UUID NOT NULL,
    "file_name" VARCHAR(200) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "allowance_documents_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "allowance_documents" ADD CONSTRAINT "allowance_documents_allowance_id_fkey" FOREIGN KEY ("allowance_id") REFERENCES "time_allowances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
