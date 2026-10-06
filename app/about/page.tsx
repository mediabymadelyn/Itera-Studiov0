import Link from "next/link";
import Navbar from "@/components/Navbar";

const values = [
  {
    icon: "M12 22q-2.05 0-3.875-.788t-3.187-2.15t-2.15-3.187T2 12q0-2.075.813-3.9t2.2-3.175T8.25 2.788T12.2 2q2 0 3.775.688t3.113 1.9t2.125 2.875T22 11.05q0 2.875-1.75 4.413T16 17h-1.85q-.225 0-.312.125t-.088.275q0 .3.375.863t.375 1.287q0 1.25-.687 1.85T12 22m-4.425-9.425Q8 12.15 8 11.5t-.425-1.075T6.5 10t-1.075.425T5 11.5t.425 1.075T6.5 13t1.075-.425m3-4Q11 8.15 11 7.5t-.425-1.075T9.5 6t-1.075.425T8 7.5t.425 1.075T9.5 9t1.075-.425m5 0Q16 8.15 16 7.5t-.425-1.075T14.5 6t-1.075.425T13 7.5t.425 1.075T14.5 9t1.075-.425m3 4Q19 12.15 19 11.5t-.425-1.075T17.5 10t-1.075.425T16 11.5t.425 1.075T17.5 13t1.075-.425M12 20q.225 0 .363-.125t.137-.325q0-.35-.375-.825T11.75 17.3q0-1.05.725-1.675T14.25 15H16q1.65 0 2.825-.962T20 11.05q0-3.025-2.312-5.038T12.2 4Q8.8 4 6.4 6.325T4 12q0 3.325 2.338 5.663T12 20",
    title: "Our purpose",
    text: "Artists spend more time searching for references than creating. ItEra gives that time back. Instead of generating images, it finds real artwork from museums and working photographers, with full credit."
  },
  {
    icon: "M12 22q-3.475-.875-5.738-3.988T4 11.1V5l8-3l8 3v6.1q0 3.8-2.262 6.913T12 22m0-2.1q2.6-.825 4.3-3.3t1.7-5.5V6.375l-6-2.25l-6 2.25V11.1q0 3.025 1.7 5.5t4.3 3.3m0-7.9",
    title: "Non-generative philosophy",
    text: "No generated images. No scraped training data. AI helps ItEra understand what you are looking for and improve search, not replicate artists or replace their work."
  },
  {
    icon: "M15.188 14.688Q16.5 13.375 16.5 11.5t-1.312-3.187T12 7T8.813 8.313T7.5 11.5t1.313 3.188T12 16t3.188-1.312m-5.1-1.276Q9.3 12.625 9.3 11.5t.788-1.912T12 8.8t1.913.788t.787 1.912t-.787 1.913T12 14.2t-1.912-.787m-4.738 3.55Q2.35 14.925 1 11.5q1.35-3.425 4.35-5.462T12 4t6.65 2.038T23 11.5q-1.35 3.425-4.35 5.463T12 19t-6.65-2.037m11.838-1.45Q19.55 14.025 20.8 11.5q-1.25-2.525-3.613-4.012T12 6T6.813 7.488T3.2 11.5q1.25 2.525 3.613 4.013T12 17t5.188-1.487",
    title: "Transparency",
    text: (
      <>
        You should always know where a result came from. Every card shows the artist, the
        source, and the license. When AI ranks or labels results, we say so, and{" "}
        <Link href="#how-it-works" className="about-inline-link">
          How it works
        </Link>{" "}
        explains each step.
      </>
    )
  },
  {
    icon: "m16 13l-4.15-4.05q-.775-.75-1.312-1.662T10 5.3q0-1.375.963-2.337T13.3 2q.8 0 1.5.338t1.2.912q.5-.575 1.2-.913T18.7 2q1.375 0 2.338.963T22 5.3q0 1.075-.525 1.988t-1.3 1.662zm0-2.8l2.725-2.675q.475-.475.875-1.013T20 5.3q0-.55-.375-.925T18.7 4q-.35 0-.663.137t-.537.413L16 6.35l-1.5-1.8q-.225-.275-.537-.413T13.3 4q-.55 0-.925.375T12 5.3q0 .675.4 1.213t.875 1.012zm-9 8.3l6.95 1.9l5.95-1.85q-.125-.225-.363-.388T19 18h-5.05q-.675 0-1.075-.05t-.825-.2l-2.325-.775l.55-1.95l2.025.675q.425.125 1 .2t1.7.1q0-.275-.162-.525t-.388-.325L8.6 13H7zM1 22V11h7.6q.175 0 .35.038t.325.087L15.15 13.3q.825.3 1.338 1.05T17 16h2q1.25 0 2.125.825T22 19v1l-8 2.5l-7-1.95V22zm2-2h2v-7H3zM16 6.35",
    title: "Supporting artists",
    text: "Every result links back to the creator's original page, so discovering a piece sends attention back to the artist who made it."
  },
  {
    icon: "M0 18v-1.575q0-1.075 1.1-1.75T4 14q.325 0 .625.013t.575.062q-.35.525-.525 1.1t-.175 1.2V18zm6 0v-1.625q0-.8.438-1.463t1.237-1.162T9.588 13T12 12.75q1.325 0 2.438.25t1.912.75t1.225 1.163t.425 1.462V18zm13.5 0v-1.625q0-.65-.162-1.225t-.488-1.075q.275-.05.563-.062T20 14q1.8 0 2.9.663t1.1 1.762V18zM8.125 16H15.9q-.25-.5-1.388-.875T12 14.75t-2.512.375T8.125 16M4 13q-.825 0-1.412-.587T2 11q0-.85.588-1.425T4 9q.85 0 1.425.575T6 11q0 .825-.575 1.413T4 13m16 0q-.825 0-1.412-.587T18 11q0-.85.588-1.425T20 9q.85 0 1.425.575T22 11q0 .825-.575 1.413T20 13m-8-1q-1.25 0-2.125-.875T9 9q0-1.275.875-2.137T12 6q1.275 0 2.138.863T15 9q0 1.25-.862 2.125T12 12m0-2q.425 0 .713-.288T13 9t-.288-.712T12 8t-.712.288T11 9t.288.713T12 10m0-1",
    title: "Fostering community",
    text: "Learning comes from seeing how other artists work. ItEra points you to the people behind the work, so you can explore their other pieces and learn from how they approached it."
  }
];

const steps = [
  {
    icon: "M19.86 8.46c.09-.31.14-.64.14-.96c0-1.82-1.39-3.32-3.17-3.48A3.01 3.01 0 0 0 14 2c-.77 0-1.47.3-2 .78c-.53-.48-1.23-.78-2-.78c-1.3 0-2.41.83-2.83 2.01A3.51 3.51 0 0 0 4 7.5c0 .33.05.65.14.96C2.87 9.14 2 10.49 2 12c0 1.08.43 2.09 1.17 2.83c-.11.38-.17.77-.17 1.17c0 1.96 1.41 3.59 3.31 3.93C6.86 21.16 8.11 22 9.5 22c.98 0 1.86-.41 2.5-1.06c.64.65 1.52 1.06 2.5 1.06c1.39 0 2.63-.83 3.19-2.06A4.006 4.006 0 0 0 21 16c0-.4-.06-.79-.17-1.17c.75-.75 1.17-1.76 1.17-2.830c0-1.5-.86-2.86-2.14-3.54M9.5 20c-.71 0-1.33-.5-1.47-1.2l-.21-.8H7c-1.1 0-2-.9-2-2c0-.35.08-.68.25-.98l.46-.82l-.78-.51C4.35 13.31 4 12.68 4 12c0-.98.72-1.82 1.68-1.97l1.69-.26l-1.06-1.35c-.2-.26-.32-.59-.32-.92c0-.83.67-1.5 1.5-1.5c.11 0 .21.01.31.03l1.19.17V4.99c0-.55.45-1 1-1s1 .45 1 1v13.5c0 .83-.67 1.5-1.5 1.5Zm9.57-6.31l-.78.51l.46.82c.17.3.25.63.25.98c0 1.1-.9 2-2.05 2h-.82l-.16.8c-.14.69-.76 1.2-1.47 1.2c-.83 0-1.5-.67-1.5-1.5V5c0-.55.45-1 1-1s1 .45 1 1.05v1.21l1.19-.22c.1-.02.21-.03.31-.03a1.498 1.498 0 0 1 1.18 2.42l-1.06 1.35l1.69.26c.96.15 1.68 1 1.68 1.97c0 .68-.35 1.32-.93 1.69Z",
    title: "Interpret search",
    text: "Your search is read to understand artistic intent."
  },
  {
    icon: "M9.5 16q-2.725 0-4.612-1.888T3 9.5t1.888-4.612T9.5 3t4.613 1.888T16 9.5q0 1.1-.35 2.075T14.7 13.3l5.6 5.6q.275.275.275.7t-.275.7t-.7.275t-.7-.275l-5.6-5.6q-.75.6-1.725.95T9.5 16m0-2q1.875 0 3.188-1.312T14 9.5t-1.312-3.187T9.5 5T6.313 6.313T5 9.5t1.313 3.188T9.5 14",
    title: "Focus the search",
    text: "Descriptive phrases are removed so each source receives the subject."
  },
  {
    icon: "M12 21q-3.775 0-6.387-1.162T3 17V7q0-1.65 2.638-2.825T12 3t6.363 1.175T21 7v10q0 1.675-2.613 2.838T12 21m0-11.975q2.225 0 4.475-.638T19 7.025q-.275-.725-2.512-1.375T12 5q-2.275 0-4.462.638T5 7.025q.35.75 2.538 1.375T12 9.025M12 14q1.05 0 2.025-.1t1.863-.288t1.675-.462T19 12.525v-3q-.65.35-1.437.625t-1.675.463t-1.863.287T12 11t-2.05-.1t-1.888-.288T6.4 10.15T5 9.525v3q.625.35 1.4.625t1.663.463t1.887.287T12 14m0 5q1.15 0 2.338-.175t2.187-.462t1.675-.65t.8-.738v-2.45q-.65.35-1.437.625t-1.675.463t-1.863.287T12 16t-2.05-.1t-1.888-.288T6.4 15.15T5 14.525V17q.125.375.788.725t1.662.638t2.2.462T12 19",
    title: "Search multiple databases",
    text: "Queries run in parallel across museum collections and image platforms."
  },
  {
    icon: "M15 19.88c.04.3-.06.62-.29.83a.996.996 0 0 1-1.41 0L9.29 16.7a.99.99 0 0 1-.29-.83v-5.12L4.21 4.62a1 1 0 0 1 .17-1.4c.19-.14.4-.22.62-.22h14c.22 0 .43.08.62.22a1 1 0 0 1 .17 1.4L15 10.75zM7.04 5L11 10.06v5.52l2 2v-7.53L16.96 5z",
    title: "Rank and deduplicate",
    text: "Results are scored for relevance, duplicates removed, and quality filtered. AI picks the best matches and labels why each one fits."
  },
  {
    icon: "m9 20.42l-6.21-6.21l2.83-2.83L9 14.77l9.88-9.89l2.83 2.83z",
    title: "Return results & attribution",
    text: "Final set includes artist names, sources, licenses, and relevance indicators."
  }
];

export default function AboutPage() {
  return (
    <>
      <Navbar activePage="about" />
      <main className="about-page">
        <header className="about-header">
          <h1 className="hero-title about-page-title">About ItEra Studio</h1>
          <p className="about-subtitle">
            AI-powered reference search built to support artists, not replace them.
          </p>
        </header>

        <div className="about-values">
          {values.map((value, index) => (
            <section
              key={value.title}
              className={`about-section${index === 0 ? " about-section-featured" : ""}`}
            >
              <div className="about-section-head">
                <span className="about-section-icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="currentColor" d={value.icon} />
                  </svg>
                </span>
                <h2 className="about-section-title">{value.title}</h2>
              </div>
              <p className="about-section-text">{value.text}</p>
            </section>
          ))}
        </div>

        <section id="how-it-works" className="about-how">
          <h2 className="about-how-title">How it works</h2>
          <p className="about-section-text">
            ItEra goes beyond keyword search. It breaks your search into visual qualities like
            pose, motion, lighting, composition, and style, then finds references that match them.
            You don&apos;t need perfect prompts.
          </p>

          <ol className="how-steps">
            {steps.map((step, index) => (
              <li key={step.title} className="how-step">
                <div className="how-step-badge">
                  <span className="how-step-icon">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path fill="currentColor" d={step.icon} />
                    </svg>
                  </span>
                  <span className="how-step-label">Step {index + 1}</span>
                </div>
                <div className="how-step-body">
                  <h3 className="how-step-title">{step.title}</h3>
                  <p className="how-step-text">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>

          <aside className="how-callout">
            <h3 className="how-callout-title">Why this approach?</h3>
            <p className="how-step-text">
              Traditional image search is great until you want to know where your references come
              from. It has no filters for artists or for the qualities you look for while creating
              and illustrating. AI helps surface and categorize results, so you find better
              references faster.
            </p>
          </aside>
        </section>
      </main>
    </>
  );
}
