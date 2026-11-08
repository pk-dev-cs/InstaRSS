import "./style.css";

export const metadata = { title: "InstaRSS", description: "Public photo-sharing posts in RSS" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
