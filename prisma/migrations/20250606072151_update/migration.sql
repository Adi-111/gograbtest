-- DropIndex
DROP INDEX "CustomerOrderDetails_id_key";

-- AlterTable
CREATE SEQUENCE customerorderdetails_id_seq;
ALTER TABLE "CustomerOrderDetails" ALTER COLUMN "id" SET DEFAULT nextval('customerorderdetails_id_seq');
ALTER SEQUENCE customerorderdetails_id_seq OWNED BY "CustomerOrderDetails"."id";
