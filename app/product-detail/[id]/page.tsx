import { redirect } from "next/navigation";

/** Kompatibilitas URL lama situs asli: /product-detail/588 -> /product/588 */
export default function ProductDetailRedirect({ params }: { params: { id: string } }) {
  redirect(`/product/${params.id}`);
}