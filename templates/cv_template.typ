// ATS-Friendly Single-Column Typst CV Template
// Zero external package dependencies — compiles offline via `typst compile tailored_cv.typ`

#set document(title: "FULL NAME - CV", author: "FULL NAME")
#set page(
  paper: "a4",
  margin: (x: 0.55in, y: 0.55in),
  numbering: none,
)
#set text(
  font: ("Liberation Sans", "DejaVu Sans", "Arial", "Helvetica"),
  size: 10pt,
  lang: "en",
)
#set par(justify: false, leading: 0.58em)
#set list(indent: 0.8em, body-indent: 0.45em, spacing: 0.5em)

#show heading.where(level: 1): it => block(
  above: 1.1em,
  below: 0.55em,
  width: 100%,
)[
  #text(size: 11pt, weight: "bold")[#upper(it.body)]
  #v(-0.65em)
  #line(length: 100%, stroke: 0.6pt + rgb("#333333"))
]

#let role_entry(title, dates, company, location) = block(above: 0.75em, below: 0.35em, breakable: false)[
  #strong(title) #h(1fr) #dates \
  #emph(company) #h(1fr) #emph(location)
]

#let project_entry(name, link_url, link_label, stack) = block(above: 0.75em, below: 0.35em, breakable: false)[
  #strong(name) (#link(link_url)[#link_label]) #h(1fr) #emph(stack)
]

// ---------- HEADER ----------
#align(center)[
  #text(size: 18pt, weight: "bold")[FULL NAME] \
  #v(0.2em)
  City, Country | #link("mailto:email@example.com")[email\@example.com] | +1-555-0100 | #link("https://linkedin.com/in/username")[linkedin.com/in/username] | #link("https://github.com/username")[github.com/username]
]

= Summary

Target-aligned 2–3 sentence summary connecting core domain depth, technical stack, and quantified engineering outcomes directly to the target role.

= Experience

#role_entry("Senior Software Engineer", "Jan 2023 – Present", "Company Name", "City, Country")
- Architected distributed event ingestion pipeline in Go and Apache Kafka handling 45K events/sec, reducing p99 latency by 62% across 12 microservices.
- Automated Kubernetes canary deployments with ArgoCD and GitHub Actions, cutting release cycle time from 4 hours to 18 minutes across 35 production services.
- Led observability migration to OpenTelemetry and Prometheus, shrinking mean time to resolution (MTTR) by 41% for Sev-1 incidents.

#role_entry("Software Engineer", "Jun 2020 – Dec 2022", "Previous Company", "City, Country")
- Built multi-tenant analytics API in Python (FastAPI) and PostgreSQL serving 120K daily active users at 99.95% uptime.
- Tuned PostgreSQL indexing and Redis caching layers, cutting database CPU load by 48% and reducing annual cloud spend by \$38K.

= Projects

#project_entry("Project Name", "https://github.com/username/repo", "github.com/username/repo", "Python, Rust, Docker")
- Engineered open-source hybrid search CLI (420+ GitHub stars) achieving 3.4x higher query throughput on 1M-document benchmarks.
- Designed zero-copy memory-mapped index persistence with automated CI benchmark regression checks.

= Skills

- *Languages:* Python, Go, TypeScript, SQL, Bash
- *Frameworks & Libraries:* FastAPI, PyTorch, gRPC, React
- *Cloud & Infrastructure:* AWS, Kubernetes, Docker, Terraform, GitHub Actions, Linux
- *Data & Observability:* PostgreSQL, Redis, Apache Kafka, OpenTelemetry

= Education

#role_entry("M.S. in Computer Science", "Sep 2018 – May 2020", "University Name", "City, Country")
