import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import AboutTools from "@/components/AboutTools";

// How a search becomes a page of results, in the order it happens.
const steps = [
  {
    icon: "M19.86 8.46c.09-.31.14-.64.14-.96c0-1.82-1.39-3.32-3.17-3.48A3.01 3.01 0 0 0 14 2c-.77 0-1.47.3-2 .78c-.53-.48-1.23-.78-2-.78c-1.3 0-2.41.83-2.83 2.01A3.51 3.51 0 0 0 4 7.5c0 .33.05.65.14.96C2.87 9.14 2 10.49 2 12c0 1.08.43 2.09 1.17 2.83c-.11.38-.17.77-.17 1.17c0 1.96 1.41 3.59 3.31 3.93C6.86 21.16 8.11 22 9.5 22c.98 0 1.86-.41 2.5-1.06c.64.65 1.52 1.06 2.5 1.06c1.39 0 2.63-.83 3.19-2.06A4.006 4.006 0 0 0 21 16c0-.4-.06-.79-.17-1.17c.75-.75 1.17-1.76 1.17-2.830c0-1.5-.86-2.86-2.14-3.54M9.5 20c-.71 0-1.33-.5-1.47-1.2l-.21-.8H7c-1.1 0-2-.9-2-2c0-.35.08-.68.25-.98l.46-.82l-.78-.51C4.35 13.31 4 12.68 4 12c0-.98.72-1.82 1.68-1.97l1.69-.26l-1.06-1.35c-.2-.26-.32-.59-.32-.92c0-.83.67-1.5 1.5-1.5c.11 0 .21.01.31.03l1.19.17V4.99c0-.55.45-1 1-1s1 .45 1 1v13.5c0 .83-.67 1.5-1.5 1.5Zm9.57-6.31l-.78.51l.46.82c.17.3.25.63.25.98c0 1.1-.9 2-2.05 2h-.82l-.16.8c-.14.69-.76 1.2-1.47 1.2c-.83 0-1.5-.67-1.5-1.5V5c0-.55.45-1 1-1s1 .45 1 1.05v1.21l1.19-.22c.1-.02.21-.03.31-.03a1.498 1.498 0 0 1 1.18 2.42l-1.06 1.35l1.69.26c.96.15 1.68 1 1.68 1.97c0 .68-.35 1.32-.93 1.69Z",
    title: "Reads your search",
    text: "It picks out the subject, the pose, the setting and the light you want, so “dancer in side light” is searched as a dancer, lit from the side."
  },
  {
    icon: "M9.5 16q-2.725 0-4.612-1.888T3 9.5t1.888-4.612T9.5 3t4.613 1.888T16 9.5q0 1.1-.35 2.075T14.7 13.3l5.6 5.6q.275.275.275.7t-.275.7t-.7.275t-.7-.275l-5.6-5.6q-.75.6-1.725.95T9.5 16m0-2q1.875 0 3.188-1.312T14 9.5t-1.312-3.187T9.5 5T6.313 6.313T5 9.5t1.313 3.188T9.5 14",
    title: "Searches each source in its own words",
    text: "Museums catalog work differently from photographers, so “draped fabric” becomes “drapery study” at the museums. All three sources are searched at once, with a few extra searches for a wider range of results. Lighting searches also draw on a set of museum works manually reviewed for their light orientation."
  },
  {
    icon: "M15.188 14.688Q16.5 13.375 16.5 11.5t-1.312-3.187T12 7T8.813 8.313T7.5 11.5t1.313 3.188T12 16t3.188-1.312m-5.1-1.276Q9.3 12.625 9.3 11.5t.788-1.912T12 8.8t1.913.788t.787 1.912t-.787 1.913T12 14.2t-1.912-.787m-4.738 3.55Q2.35 14.925 1 11.5q1.35-3.425 4.35-5.462T12 4t6.65 2.038T23 11.5q-1.35 3.425-4.35 5.463T12 19t-6.65-2.037m11.838-1.45Q19.55 14.025 20.8 11.5q-1.25-2.525-3.613-4.012T12 6T6.813 7.488T3.2 11.5q1.25 2.525 3.613 4.013T12 17t5.188-1.487",
    title: "Looks at every image",
    text: "An AI model describes each candidate: whether it matches your search, how it's lit (direction, shadow, hard or soft light) and its overall color. Images that don't fit are dropped. Describing an image isn't copying it or training on it, and every image stays credited to the person who made it."
  },
  {
    icon: "m9 20.42l-6.21-6.21l2.83-2.83L9 14.77l9.88-9.89l2.83 2.83z",
    title: "Builds your page",
    text: "Best matches come first: full matches only, at least three museum works, and one work per artist. Everything else follows under More results."
  }
];

// Where every result comes from, and the license each one is shown under.
const sources = [
  {
    name: "The Metropolitan Museum of Art",
    href: "https://www.metmuseum.org/about-the-met/policies-and-documents/open-access",
    text: "Public-domain works from the Met's Open Access program, released under CC0."
  },
  {
    name: "Art Institute of Chicago",
    href: "https://www.artic.edu/open-access/open-access-images",
    text: "Public-domain works from the Art Institute's open-access collection, released under CC0. Images are shown from their Wikimedia Commons copies."
  },
  {
    name: "Unsplash",
    href: "https://unsplash.com/license",
    text: "Photographs shared by photographers under the Unsplash License."
  }
];

export default function AboutPage() {
  return (
    <>
      <Navbar activePage="about" />
      <main className="about-page">
        <header className="about-header">
          <h1 className="hero-title about-page-title">About Itera Studio</h1>
          <p className="about-subtitle">Reference search for artists.</p>
        </header>

        <section className="about-mission" aria-label="Mission">
          <p>
            Artists spend a lot of time hunting for references. Itera searches public museum
            collections and photographers&apos; work for you. Every result is a real artwork or
            photograph, credited to the person who made it, with its source, its license and a link
            back to their work.
          </p>
          <p>
            Itera never generates images and doesn&apos;t train any AI model. It uses AI for two
            things: understanding what you searched for, and describing the images it finds so the
            best matches are surfaced first. {" "}
           
          </p>
        </section>

        <section id="how-it-works" className="about-block">
          <h2 className="about-block-title">How it works</h2>
          <p className="about-lead">
            Describe what you need the way you&apos;d say it: a pose, a subject, a kind of light source.
            You don&apos;t need perfect prompts.
          </p>
          <ol className="how-steps">
            {steps.map((step, index) => (
              <li key={step.title} className="how-step">
                <span className="how-step-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path fill="currentColor" d={step.icon} />
                  </svg>
                </span>
                <div>
                  <span className="how-step-number">Step {index + 1}</span>
                  <h3 className="how-step-title">{step.title}</h3>
                  <p className="about-text">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section id="tools" className="about-block">
          <h2 className="about-block-title">Toolbox & Features</h2>
          <AboutTools />
        </section>

        <section id="your-data" className="about-block">
          <h2 className="about-block-title">Your data</h2>
          <ul className="about-list">
            <li>There are no accounts, and your search history isn&apos;t saved.</li>
            <li>
              Your search text goes to the three sources, and to an AI model (Meta&apos;s Llama, run
              through Hugging Face) that helps read it.
            </li>
            <li>
              Your search and the candidate images go to Google&apos;s Gemini, which describes each
              image. Itera uses Gemini&apos;s{" "}
              <a
                href="https://ai.google.dev/gemini-api/terms"
                className="about-inline-link"
                target="_blank"
                rel="noreferrer"
              >
                paid service
              </a>
              , under which Google doesn&apos;t use what&apos;s sent to train its models.
            </li>
          </ul>
        </section>

        <section id="limits" className="about-block">
          <h2 className="about-block-title">Limitations</h2>
          <ul className="about-list">
            <li>
              The AI can misjudge an image, especially the lighting in paintings, so treat its tags
              as a guide.
            </li>
            <li>Most contemporary art isn&apos;t here: museums can only share works out of copyright.</li>
            <li>Unsplash has fewer photos of some people and settings, so some searches return less.</li>
          </ul>
        </section>

        <section id="sources" className="about-block">
          <h2 className="about-block-title">Sources</h2>
          <p className="about-lead">Itera only shows images it has the right to show.</p>
          <ul className="about-sources">
            {sources.map((source) => (
              <li key={source.name}>
                <a href={source.href} className="about-inline-link" target="_blank" rel="noreferrer">
                  {source.name}
                </a>
                <p className="about-text">{source.text}</p>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <Footer />
    </>
  );
}
