import Link from "next/link";

type NavbarProps = {
  activePage?: "search" | "how-it-works";
};

export default function Navbar({ activePage = "search" }: NavbarProps) {
  return (
    <nav className="navbar">
      <Link href="/" className="navbar-logo brand-gradient-text">
        ItEra Studio
      </Link>
      <div className="navbar-links">
        <Link
          href="/"
          className={`navbar-link${activePage === "search" ? " navbar-link-active" : ""}`}
        >
          Search
        </Link>
        <span className="navbar-link">About</span>
        <span className="navbar-link">Sources</span>
        <Link
          href="/how-it-works"
          className={`navbar-link${activePage === "how-it-works" ? " navbar-link-active" : ""}`}
        >
          How it works
        </Link>
      </div>
    </nav>
  );
}
