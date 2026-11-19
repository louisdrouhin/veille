export const PARA = "Proxmox VE 9 apporte Debian 13, un noyau 6.14 et de nombreuses améliorations pour le stockage. ";

/** A blog page: navigation, sidebar and footer around an <article> with traps (scripts, handlers, iframe). */
export function articlePage(body = `<p>${PARA.repeat(4)}</p><p>${PARA.repeat(3)}</p>`) {
  return `<!doctype html><html><head><title>Mon article</title><script>var tracker = 1;</script></head><body>
    <nav><a href="/">Accueil</a> <a href="/tags">Tags</a></nav>
    <aside class="sidebar">Abonnez-vous à la newsletter !</aside>
    <article>
      <h1>Mon article</h1>
      ${body}
      <figure><img src="/img/schema.png" alt="Schéma" onerror="alert(1)"><figcaption>Le schéma</figcaption></figure>
      <p>Voir <a href="/autre" onclick="x()">l'autre billet</a> et <a href="javascript:alert(1)">ceci</a>.</p>
      <iframe src="https://www.youtube.com/embed/x"></iframe>
    </article>
    <footer>© 2025 — mentions légales</footer>
  </body></html>`;
}

