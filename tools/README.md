# tools

Helper scripts for maintaining the project.

## `refresh-sri.sh`

Prints SHA-384 SRI hashes for the CDN dependencies currently pinned in
`index.html`. Run this whenever you bump a pinned version, then update the
`integrity="..."` attributes on the matching `<script>` / `<link>` tags.

```bash
bash tools/refresh-sri.sh
```

Requires `curl` and `openssl` (both are standard on macOS / Linux and present
on Windows via Git Bash or WSL).

If a hash in `index.html` does not match what the CDN serves, the browser
will refuse to load the resource. That is the point — bumping a dependency
without refreshing the hash should fail loudly, not silently.
