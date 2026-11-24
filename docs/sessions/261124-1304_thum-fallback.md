# Website screenshot failure fallback

Both Topologic pages returned HTTP 200 directly. Thum.io returned HTTP 200 PNGs showing Chromium's `ERR_TUNNEL_CONNECTION_FAILED` for both pages, including when requested with `maxAge/0/`. The control capture of example.com returned a normal page. The proxy error does not identify which party caused the tunnel failure.

Sourcebook now checks Thum.io images before replacing a preview. It recognizes the icon and heading of the observed Chromium error page at the requested capture size. A rejected or unreadable image leaves the existing preview and thumbnail in place. New links keep their locally generated preview when capture fails, and title lookup can still succeed independently. Detection is limited to the observed error layout.

Built v7.0.11 and ran the Chrome screenshot and library recovery smoke check. An additional disposable Chrome check replayed both real error PNGs and confirmed that the stored preview and thumbnail were byte-for-byte unchanged after rebuild.
