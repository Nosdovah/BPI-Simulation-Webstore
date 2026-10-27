import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { CartProvider } from "@/components/CartProvider";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Chrome";
import { MODE_COOKIE, parseMode } from "@/lib/state";

export const metadata: Metadata = {
  title: "Octarine Sandbox — Simulasi Webstore BPI",
  description:
    "Replika webstore untuk simulasi proyek peningkatan proses DMAIC. Data sintetis, bukan toko resmi.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const mode = parseMode(cookies().get(MODE_COOKIE)?.value);

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
          <Header mode={mode} />
          <main className="mx-auto max-w-[1400px] px-4">{children}</main>
          <Footer />
        </CartProvider>
      </body>
    </html>
  );
}