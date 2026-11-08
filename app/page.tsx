import { desc, eq } from "drizzle-orm";
import { db, posts, profiles } from "@/lib/db";
import { RssLinks } from "./rss-links";

export const dynamic = "force-dynamic";

export default function Home() {
  const list = db.select().from(profiles).orderBy(desc(profiles.id)).all();
  return <div className="page-wrap">
    <a className="skip-link" href="#content">Skip to content</a>
    <div className="terminal-window">
    <header className="titlebar"><a href="/" className="brand">[ InstaRSS ]</a><span className="window-marks" aria-hidden="true">_ &nbsp; [] &nbsp; x</span></header>
    <div className="toolbar"><span className="nav-note">[ less is more ]</span></div>
    <main id="content">
    <div className="path-line"><span>~/pk-dev/feeds</span><span>RSS / 30 days</span></div>
    <section className="hero" id="add-profile" aria-labelledby="hero-title">
      <div><h1 id="hero-title">Follow posts.<br/><em>Keep your feed.</em></h1><p>Add a public profile to get an RSS feed with posts and photos, available for 30 days after publication.</p></div>
      <form action="/api/profiles" method="post"><label htmlFor="username">Username</label><div className="input-row"><span>@</span><input id="username" name="username" placeholder="username" required pattern="[A-Za-z0-9._]{1,30}"/><button type="submit">Add profile →</button></div><small>Public photo-sharing accounts</small></form>
    </section>
    <section className="list" id="feeds" aria-labelledby="feeds-title"><div className="section-head"><h2 id="feeds-title">Your feeds</h2><span>{list.length} {list.length === 1 ? "profile" : "profiles"}</span></div>
      {list.length === 0 ? <div className="empty">No profiles yet. Add your first profile to create an RSS feed.</div> :
        <div className="cards">{list.map((profile) => {
          const count = db.select({ id: posts.id }).from(posts).where(eq(posts.profileId, profile.id)).all().length;
          return <article key={profile.id} className="card"><div className="avatar">@</div><div className="card-main"><h3>@{profile.username}</h3><p>{count} {count === 1 ? "post" : "posts"} · {profile.lastSource === "api" ? "API" : profile.lastSource === "public-page" ? "public page" : profile.lastSource === "browser" ? "browser" : "waiting for an update"}</p>{profile.lastError && <p className="error">{profile.lastError}</p>}</div><form action={`/api/profiles/${profile.username}/sync`} method="post"><button type="submit" className="secondary">Refresh</button></form><RssLinks username={profile.username} baseUrl={process.env.APP_BASE_URL || ""} /></article>;
        })}</div>}
    </section>
    </main>
    <div className="statusbar"><span className="status-mode">RSS</span><span className="status-count">{list.length} {list.length === 1 ? "profile" : "profiles"}</span></div>
    </div>
    <footer><span>Public posts in your RSS reader</span><span>30-day retention</span></footer>
  </div>;
}
