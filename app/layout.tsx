import type { Metadata } from "next";
import "./globals.css";
import { CartProvider } from "@/components/CartProvider";
import { Header, type HeaderAccount } from "@/components/Header";
import { Footer } from "@/components/Chrome";
import { optionalSession } from "@/lib/auth/page-guard";
import { isAdminRole } from "@/lib/auth/rbac";

export const metadata: Metadata = {
  title: "Octarine — Katalog, Pemesanan, dan Pelacakan",
  description:
    "Katalog produk Octarine, ketersediaan stok, dan pelacakan pesanan.",
  robots: { index: false, follow: false },
};

/** Header berubah menurut sesi, jadi root layout harus dinamis. */
export const dynamic = "force-dynamic";

function accountLink(): HeaderAccount {
  const session = optionalSession();
  if (!session) return null;
  const admin = session.roles.some(isAdminRole);
  const first = session.name.split(" ")[0] || "Akun";
  return {
    name: session.name,
    href: admin ? "/admin" : "/akun",
    label: admin ? `Panel ${first}` : first,
  };
}

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
          <Header account={accountLink()} />
          <main className="mx-auto max-w-[1400px] px-4">{children}</main>
          <Footer />
        </CartProvider>
      </body>
    </html>
  );
}