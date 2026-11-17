# Screenshot preview order

Artwork and title lookup now run independently. Sourcebook tries a YouTube thumbnail or direct public X media URL first. Other public links and failed site-specific image lookups go to Thum.io. Defuddle provides titles. **Rebuild preview** applies the new order to existing links, and **Capture website screenshot** requests Thum.io directly.

Verified the provider order with focused tests and ran the existing Chrome screenshot and library-recovery smoke check.
