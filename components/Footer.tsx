import Link from "next/link";

// A quiet, permanent note of where every image comes from, on every page.
export default function Footer() {
  return (
    <footer className="site-footer">
      Images from The Metropolitan Museum of Art, the Art Institute of Chicago and Unsplash, always
      credited · Never generated · <Link href="/about#sources">Sources and licenses</Link>
    </footer>
  );
}
