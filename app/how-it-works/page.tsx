import Navbar from "@/components/Navbar";

const steps = [
  {
    icon: "M19.86 8.46c.09-.31.14-.64.14-.96c0-1.82-1.39-3.32-3.17-3.48A3.01 3.01 0 0 0 14 2c-.77 0-1.47.3-2 .78c-.53-.48-1.23-.78-2-.78c-1.3 0-2.41.83-2.83 2.01A3.51 3.51 0 0 0 4 7.5c0 .33.05.65.14.96C2.87 9.14 2 10.49 2 12c0 1.08.43 2.09 1.17 2.83c-.11.38-.17.77-.17 1.17c0 1.96 1.41 3.59 3.31 3.93C6.86 21.16 8.11 22 9.5 22c.98 0 1.86-.41 2.5-1.06c.64.65 1.52 1.06 2.5 1.06c1.39 0 2.63-.83 3.19-2.06A4.006 4.006 0 0 0 21 16c0-.4-.06-.79-.17-1.17c.75-.75 1.17-1.76 1.17-2.83c0-1.5-.86-2.86-2.14-3.54M9.5 20c-.71 0-1.33-.5-1.47-1.2l-.21-.8H7c-1.1 0-2-.9-2-2c0-.35.08-.68.25-.98l.46-.82l-.78-.51C4.35 13.31 4 12.68 4 12c0-.98.72-1.82 1.68-1.97l1.69-.26l-1.06-1.35c-.2-.26-.32-.59-.32-.92c0-.83.67-1.5 1.5-1.5c.11 0 .21.01.31.03l1.19.17V4.99c0-.55.45-1 1-1s1 .45 1 1v13.5c0 .83-.67 1.5-1.5 1.5Zm9.57-6.31l-.78.51l.46.82c.17.3.25.63.25.98c0 1.1-.9 2-2.05 2h-.82l-.16.8c-.14.69-.76 1.2-1.47 1.2c-.83 0-1.5-.67-1.5-1.5V5c0-.55.45-1 1-1s1 .45 1 1.05v1.21l1.19-.22c.1-.02.21-.03.31-.03a1.498 1.498 0 0 1 1.18 2.42l-1.06 1.35l1.69.26c.96.15 1.68 1 1.68 1.97c0 .68-.35 1.32-.93 1.69Z",
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

export default function HowItWorksPage() {
  return (
    <>
      <Navbar activePage="how-it-works" />
      <main className="how-page">
        <h1 className="hero-title how-page-title">How it Works</h1>

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
                <h2 className="how-step-title">{step.title}</h2>
                <p className="how-step-text">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>

        <aside className="how-callout">
          <h2 className="how-callout-title">Why this approach?</h2>
          <p className="how-step-text">
            Traditional image search is great until you want to know where your references come
            from. It has no filters for artists or for the qualities you look for while creating
            and illustrating. AI helps surface and categorize results, so you find better
            references faster.
          </p>
        </aside>
      </main>
    </>
  );
}
