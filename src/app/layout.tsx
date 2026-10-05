import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Čekis", description: "Čekiai ir pirkiniai vienoje vietoje" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="lt"><body>{children}</body></html>;
}
