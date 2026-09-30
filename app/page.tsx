import Navbar from "@/components/Navbar";
import SearchBar from "@/components/SearchBar";

export default function HomePage() {
  return (
    <>
      <Navbar />
      <main>
        <div className="hero">
          <h1 className="hero-title brand-gradient-text">ItEra Studio</h1>
          <p className="hero-subhead">Find real references from real artists.</p>
          <p className="hero-tagline">Spend less time searching. More time creating.</p>
        </div>
        <SearchBar />
      </main>
    </>
  );
}
