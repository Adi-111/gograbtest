-- CreateTable
CREATE TABLE "CustomerOrderDetails" (
    "id" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "coils" INTEGER[],
    "productIds" TEXT[],
    "dispenseStatuses" TEXT[],
    "orderTime" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerOrderDetails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOrderDetails_id_key" ON "CustomerOrderDetails"("id");
