import type { Metadata } from "next";
import { Suspense } from "react";
import ReferenceSheet from "@/components/ReferenceSheet";

export const metadata: Metadata = {
  title: "Reference sheet · Itera Studio"
};

// A print-ready page of a board (Saved > Download > Reference sheet), saved
// as a PDF with the browser's own print dialog. No navbar or footer: it's
// the page that gets printed.
export default function ReferenceSheetPage() {
  return (
    <Suspense fallback={null}>
      <ReferenceSheet />
    </Suspense>
  );
}
