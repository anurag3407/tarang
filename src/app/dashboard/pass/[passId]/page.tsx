import type { Metadata } from "next";
import PassQr from "./PassQr";

export const metadata: Metadata = {
  title: "My Pass QR",
  robots: { index: false },
};

export default async function PassQrPage({
  params,
}: {
  params: Promise<{ passId: string }>;
}) {
  const { passId } = await params;
  return <PassQr passId={passId} />;
}
