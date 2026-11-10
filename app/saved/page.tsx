import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import SavedBoards from "@/components/SavedBoards";

export const metadata: Metadata = {
  title: "Saved · Itera Studio"
};

export default function SavedPage() {
  return (
    <>
      <Navbar activePage="saved" />
      <main>
        <SavedBoards />
      </main>
      <Footer />
    </>
  );
}
