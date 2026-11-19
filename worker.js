const store = {
  name: "The Vector Store",
  origin: "https://vectortemplatestore.com",
};

const sellers = [
  {
    name: "Artabrian",
    origin: "https://www.artabrian.com",
    path: "/templates/?s=",
    product: /^\/templates\/[^/]+graphics-template\/?$/,
  },
  {
    name: "MX-Vector",
    origin: "https://mx-vector.com",
    path: "/en/search?s=",
    product: /^\/en\/[^/]+\/\d+-template-[^/]+\.html$/,
  },
  { name: "Dirt Bike Templates", origin: "https://dirtbiketemplates.com" },
  { name: "MKS Graphics", origin: "https://mks-graphics.com" },
  {
    name: "VectorJar",
    origin: "https://vectorjar.com",
    path: "/?post_type=product&s=",
    product: /^\/product\/[^/]+\/?$/,
  },
  { name: "Krazy Graphics", origin: "https://www.krazygraphics.com" },
];

const tmCategory =
  "/eps/motocross-vector-graphics-templates/tm-motocross-vector-templates/";

const productPath = /^\/product\/[a-z0-9-]+\/?$/i;

function normalize(value) {
  return value.toLowerCase()
    .replace(/\byz[\s-]*f[\s-]*(\d{3})\b/g, "yz$1f")
    .replace(/\btm[\s-]+(\d{2,3})\b/g, "tm$1")
    .replace(/\b([a-z]{2,5})[\s-]*(\d{2,4})[\s-]*([frx]{1,3})\b/g, "$1$2$3");
}

function parseQuery(value) {
  const text = normalize(value);
  const year = Number(text.match(/\b(?:19|20)\d{2}\b/)?.[0]) || null;
  const model = text.match(/\b[a-z]{2,5}\d{2,4}[a-z]{0,3}\b/)?.[0];
  const terms = text
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/\b(?:buy|vector|templates?|graphics|cut|files?|download|eps|mx|motocross|racing)\b/g, " ")
    .match(/[a-z0-9]+/g) || [];
  const isTm = terms.includes("tm") || /^tm\d/.test(model || "");
  return { year, model, terms, isTm, lookup: model || terms.join(" ") || "vector template" };
}

function listsYear(text, year) {
  if (!year) return true;
  if (new RegExp("\\b" + year + "\\b").test(text)) return true;

  for (const [, start, end] of text.matchAll(
    /\b((?:19|20)\d{2})\s*[-–—]\s*((?:19|20)\d{2}|\d{2})\b/g
  )) {
    const last = end.length === 2 ? start.slice(0, 2) + end : end;
    if (Number(start) <= year && year <= Number(last)) return true;
  }

  return false;
}

function titleFromPath(path) {
  return path.split("/").filter(Boolean).pop()
    .replace(/^\d+-|\.html$/g, "")
    .replace(/((?:19|20)\d{2})-((?:19|20)\d{2}|\d{2})(?=-|$)/g, "$1–$2")
    .replace(/(\d|–\d{2})-(?:and-)?([a-z]{2,5}\d{2,4}[a-z]{0,3})-(?=(?:19|20)\d{2})/gi, "$1 & $2-")
    .replace(/-/g, " ")
    .replace(/^tm(?=\b|\d)/i, "TM")
    .replace(/^./, letter => letter.toUpperCase());
}

function addListing(results, seller, rawUrl, title, query, price = null) {
  const url = new URL(rawUrl, seller.origin);
  if (url.origin !== seller.origin) return;
  if (seller !== store && !/\b(template|gabarit|cut file)\b/i.test(title)) return;
  if (
    /\b(mockup|quad|atv|seat cover)\b/i.test(title) &&
    !query.terms.some(term => /^(mockup|quad|atv|seat)$/.test(term))
  ) return;

  const sections = normalize(title).split(/\s+(?:&|and|et|\+|\/)\s+/);
  const match = sections.filter(section => {
    if (query.model) return new RegExp("\\b" + query.model + "\\b").test(section);

    return query.terms.every(term =>
      term === "tm" ? /\btm(?=\b|\d)/.test(section) : section.includes(term)
    );
  });
  if (!match.length) return;

  url.search = "";
  url.hash = "";
  if (results.has(url.href)) return;

  results.set(url.href, {
    seller: seller.name,
    title,
    url: url.href,
    price,
    exact: match.some(section => listsYear(section, query.year)),
    priority: seller === store,
  });
}

async function fetchCatalogue(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5500) });
  if (!response.ok) throw new Error("Catalogue unavailable");
  return response;
}

async function readProducts(seller, path, pattern, query, results) {
  const response = await fetchCatalogue(seller.origin + path);
  const html = await response.text();

  for (const [, href] of html.matchAll(/\bhref=["']([^"'<>]+)["']/gi)) {
    let url;
    try {
      url = new URL(href, seller.origin);
    } catch {
      continue;
    }
    if (url.origin !== seller.origin || !pattern.test(url.pathname)) continue;
    addListing(results, seller, url.href, titleFromPath(url.pathname), query);
  }
}

async function searchStoreApi(query, results) {
  const alias = query.model?.replace(/^yz(\d{3})f$/, "yzf$1");
  const lookup = query.isTm ? "tm" : alias || query.lookup;
  const response = await fetchCatalogue(
    store.origin + "/wp-json/wc/store/v1/products?" +
    new URLSearchParams({ per_page: "30", search: lookup })
  );

  for (const product of await response.json()) {
    const money = product.prices;
    const digits = money?.currency_minor_unit;
    const price = money?.price && Number.isInteger(digits) && digits >= 0 && digits <= 4
      ? money.currency_code + " " + (Number(money.price) / 10 ** digits).toFixed(digits)
      : null;
    addListing(results, store, product.permalink, product.name, query, price);
  }
}

async function searchStore(query) {
  const results = new Map();
  const [api] = await Promise.allSettled([searchStoreApi(query, results)]);

  if (query.isTm || !results.size) {
    const paths = query.isTm
      ? [tmCategory, ...[2, 3, 4].map(page => tmCategory + "page/" + page + "/")]
      : ["/?post_type=product&s=" + encodeURIComponent(query.lookup)];

    const pages = await Promise.allSettled(
      paths.map(path => readProducts(store, path, productPath, query, results))
    );
    if (api.status === "rejected" && pages.every(page => page.status === "rejected")) {
      throw new Error("The Vector Store is unavailable");
    }
  }

  return [...results.values()];
}

async function searchSeller(seller, query) {
  const results = new Map();
  const lookup = seller.name === "Artabrian" && query.model
    ? query.model.match(/\d+/)[0]
    : query.lookup;

  if (seller.path) {
    await readProducts(
      seller, seller.path + encodeURIComponent(lookup), seller.product, query, results
    );
  } else {
    const params = new URLSearchParams({
      q: lookup,
      "resources[type]": "product",
      "resources[limit]": "10",
    });
    const response = await fetchCatalogue(seller.origin + "/search/suggest.json?" + params);
    const catalogue = await response.json();
    for (const product of catalogue.resources.results.products) {
      addListing(results, seller, product.url, product.title, query);
    }
  }

  return [...results.values()];
}

async function search(value) {
  const query = parseQuery(value);
  let first = [];
  let storeChecked = true;

  try {
    first = await searchStore(query);
  } catch {
    storeChecked = false;
  }

  const sources = await Promise.allSettled(sellers.map(seller => searchSeller(seller, query)));
  const completed = sources.filter(source => source.status === "fulfilled");
  const products = [...first, ...completed.flatMap(source => source.value)];
  products.sort((a, b) =>
    Number(b.priority) - Number(a.priority) ||
    Number(b.exact) - Number(a.exact) ||
    a.seller.localeCompare(b.seller)
  );

  return {
    products,
    year: query.year,
    storeChecked,
    checked: completed.length + Number(storeChecked),
    total: sellers.length + 1,
  };
}

const page = `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Find Any Vector Template</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #fff5ed; color: #2e1a12; font: 1rem/1.55 system-ui, sans-serif; }
    header { padding: 4rem 1.25rem 5rem; background: linear-gradient(115deg, #54200f, #b83c0a); color: white; }
    .wrap { width: 100%; max-width: 64rem; margin: auto; }
    main { padding: 0 1.25rem 3rem; }
    h1 { margin: 0; font-size: clamp(2.25rem, 6vw, 4.5rem); line-height: 1.05; letter-spacing: -.06em; }
    header p { margin: 1rem 0 0; color: #fff0df; }
    form { margin-top: -2rem; padding: 1.25rem; border: 1px solid #f1d7c7; border-radius: 1rem; background: white; box-shadow: 0 8px 30px #54200f18; }
    label { display: block; margin-bottom: .35rem; font-weight: 700; }
    .controls { display: flex; flex-wrap: wrap; gap: .65rem; }
    input, button { min-height: 3rem; padding: .65rem .85rem; border-radius: .55rem; font: inherit; }
    input { flex: 1 1 15rem; min-width: 0; border: 1px solid #b48e79; }
    button { border: 1px solid #a6370b; background: #a6370b; color: white; font-weight: 700; cursor: pointer; }
    button:disabled { opacity: .65; cursor: wait; }
    #example { min-height: 2rem; margin-top: .45rem; padding: 0; background: transparent; border: 0; color: #a6370b; text-decoration: underline; }
    #results { padding-top: 1.5rem; }
    .heading { display: flex; align-items: baseline; justify-content: space-between; gap: .5rem 1rem; flex-wrap: wrap; }
    .heading h2 { margin: 0; }
    a { color: #a6370b; }
    article { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: .75rem; margin: .65rem 0; padding: 1rem; background: white; border: 1px solid #f1d7c7; border-radius: .75rem; }
    article.priority { border-left: 4px solid #f56a1d; background: #fffaf5; }
    article p, article h3 { margin: 0; }
    article h3 { font-size: 1rem; }
    .seller, .meta, #status { color: #725347; }
    .seller, .meta { font-size: .9rem; }
    .listing { display: inline-block; padding: .55rem .75rem; background: #ffead9; border-radius: .5rem; font-weight: 700; text-decoration: none; }
    :focus-visible { outline: 3px solid #ca440c; outline-offset: 3px; }
    @media (max-width: 32rem) {
      article { grid-template-columns: 1fr; }
      .listing { justify-self: start; }
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap">
      <h1>Find Any Vector Template</h1>
      <p>Search sellers and compare vector template listings by model and year.</p>
    </div>
  </header>
  <main class="wrap">
    <form id="search">
      <label for="query">Template name or model</label>
      <div class="controls">
        <input id="query" type="search" required maxlength="120" placeholder="e.g. TM 2023 vector template">
        <button id="submit" type="submit">Find sellers</button>
      </div>
      <button id="example" type="button">Try TM 2023</button>
    </form>
    <section id="results" aria-labelledby="results-title" hidden>
      <div class="heading">
        <h2 id="results-title">Seller listings</h2>
        <a id="google" target="_blank" rel="noopener noreferrer">Search the web on Google</a>
      </div>
      <p id="status" role="status" aria-live="polite"></p>
      <div id="offers"></div>
    </section>
  </main>
  <script>
    const form = document.querySelector("#search");
    const input = document.querySelector("#query");
    const submit = document.querySelector("#submit");
    const example = document.querySelector("#example");
    const results = document.querySelector("#results");
    const status = document.querySelector("#status");
    const offers = document.querySelector("#offers");
    const google = document.querySelector("#google");

    function element(tag, text, className) {
      const node = document.createElement(tag);
      node.textContent = text;
      if (className) node.className = className;
      return node;
    }

    function renderListing(product, year) {
      const row = element("article", "", product.priority ? "priority" : "");
      const details = element("div", "");
      details.append(
        element("p", product.seller + (product.priority ? " · Searched first" : ""), "seller"),
        element("h3", product.title)
      );

      const metadata = [];
      if (product.price) metadata.push(product.price);
      if (year) metadata.push(product.exact ? "Lists " + year : "Other year or unspecified");
      if (metadata.length) details.append(element("p", metadata.join(" · "), "meta"));

      const link = element("a", "View listing", "listing");
      link.href = product.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.setAttribute("aria-label", "View " + product.title + " at " + product.seller);
      row.append(details, link);
      offers.append(row);
    }

    example.addEventListener("click", () => {
      input.value = "TM 2023 vector template";
      form.requestSubmit();
    });

    form.addEventListener("submit", async event => {
      event.preventDefault();
      const query = input.value.trim();
      if (!query || submit.disabled) return;

      submit.disabled = true;
      example.disabled = true;
      results.hidden = false;
      offers.replaceChildren();
      status.textContent = "Checking The Vector Store first, then other sellers…";
      google.href = "https://www.google.com/search?" +
        new URLSearchParams({ q: query + " buy downloadable vector template" });

      try {
        const response = await fetch("/api/search?" + new URLSearchParams({ q: query }));
        if (!response.ok) throw new Error("Search unavailable");

        const data = await response.json();
        const count = data.products.length;
        let summary = count + (count === 1 ? " listing" : " listings") +
          " from " + data.checked + " of " + data.total + " catalogues checked.";
        if (!data.storeChecked) summary += " The Vector Store was tried first and is currently unavailable.";
        if (data.year && !data.products.some(product => product.exact)) {
          summary += " No matching listing mentioned " + data.year + ".";
        }
        status.textContent = summary;
        for (const product of data.products) renderListing(product, data.year);
      } catch {
        status.textContent = "Seller search is temporarily unavailable. You can still search on Google.";
      } finally {
        submit.disabled = false;
        example.disabled = false;
      }
    });
  </script>
</body>
</html>`;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET") {
      return new Response("Method unavailable", { status: 405, headers: { Allow: "GET" } });
    }

    if (url.pathname === "/") {
      return new Response(page, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/api/search") {
      const query = url.searchParams.get("q")?.trim();
      if (!query || query.length > 120) {
        return Response.json({ error: "Enter a search of up to 120 characters." }, { status: 400 });
      }

      return Response.json(await search(query), {
        headers: { "cache-control": "no-store" },
      });
    }

    return new Response("Page unavailable", { status: 404 });
  },
};
