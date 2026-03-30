-- CreateTable
CREATE TABLE "Product" (
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "description" TEXT,
    "image" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "product_price" INTEGER NOT NULL,
    "brand_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hsn_code" TEXT,
    "bar_code" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "moq" INTEGER NOT NULL,
    "zoho_item_id" TEXT NOT NULL,
    "purchase_rate" DOUBLE PRECISION NOT NULL,
    "inter_state_tax_rate" DOUBLE PRECISION NOT NULL,
    "intra_state_tax_rate" DOUBLE PRECISION NOT NULL,
    "product_type" TEXT,
    "markdown_percentage" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("product_id")
);

-- CreateTable
CREATE TABLE "CustomerOrderDetails" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "coils" TEXT[],
    "productIds" TEXT[],
    "dispenseStatuses" TEXT[],
    "machine_id" TEXT,
    "verdict" TEXT,
    "orderTime" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerOrderDetails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_product_id_key" ON "Product"("product_id");
