import type { Metadata } from "next";
import "./globals.css";
import { CartProvider } from "@/components/CartProvider";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Chrome";

export const metadata: Metadata = {
  title: "Octarine — Katalog, Pemesanan, dan Pelacakan",
  description:
    "Katalog produk Octarine, ketersediaan stok, dan pelacakan pesanan.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600&family=Inter:wght@300;400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-white text-ink antialiased">
        <CartProvider>
          <Header />
          <main className="mx-auto max-w-[1400px] px-4">{children}</main>
          <Footer />
        </CartProvider>
      </body>
    </html>
  );
}