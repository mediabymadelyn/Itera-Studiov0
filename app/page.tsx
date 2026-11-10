import Navbar from "@/components/Navbar";
import SearchBar from "@/components/SearchBar";
import Footer from "@/components/Footer";

export default function HomePage() {
  return (
    <>
      <Navbar />
      <main>
        {/* The hero lives in SearchBar, which folds it away after the first
            search so results start near the top. */}
        <SearchBar />
      </main>
      <Footer />
    </>
  );
}
