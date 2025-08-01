import { Product } from "@prisma/client";

export class ProductDto implements Product {
  product_id: string;
  product_name: string;
  description: string | null;
  image: string;
  category: string;
  product_price: number;
  brand_name: string;
  hsn_code: string | null;
  bar_code: string | null;
  is_active: boolean;
  moq: number;
  zoho_item_id: string;
  purchase_rate: number; // Keep as string if precision/formatting matters
  inter_state_tax_rate: number;
  intra_state_tax_rate: number;
  product_type: string; // If boolean-like, convert to boolean if needed
  markdown_percentage: number;
  created_at: Date;
}
