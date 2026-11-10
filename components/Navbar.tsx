import Link from "next/link";

type NavbarProps = {
  activePage?: "search" | "about";
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
        <Link
          href="/about"
          className={`navbar-link${activePage === "about" ? " navbar-link-active" : ""}`}
        >
          About
        </Link>
        <Link href="/about#sources" className="navbar-link">
          Sources
        </Link>
      </div>
    </nav>
  );
}
