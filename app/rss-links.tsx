"use client";

import { useState } from "react";

export function RssLinks({ username, baseUrl }: { username: string; baseUrl: string }) {
  const path = `/rss/${username}.xml`;
  const [copied, setCopied] = useState(false);
  const [manualUrl, setManualUrl] = useState("");

  async function copyAddress() {
    const url = new URL(path, baseUrl || window.location.origin).href;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setManualUrl("");
    } catch {
      setCopied(false);
      setManualUrl(url);
    }
  }

  return <div className="rss-links">
    <a href={path} target="_blank" rel="noreferrer">Open RSS ↗</a>
    <button type="button" className="secondary" onClick={copyAddress} aria-label={`Copy RSS URL for ${username}`}>
      {copied ? "Copied ✓" : "Copy URL"}
    </button>
    <span role="status" className="copy-status">{copied ? "RSS URL copied" : ""}</span>
    {manualUrl && <label className="manual-copy">Copy the URL manually:
      <input aria-label="RSS URL" value={manualUrl} readOnly autoFocus onFocus={(event) => event.currentTarget.select()} />
    </label>}
  </div>;
}
