## What does this PR do?

<!-- A brief description of the change. What problem does it solve or what feature does it add? -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Performance improvement
- [ ] Refactor / code cleanup
- [ ] Documentation
- [ ] Translation
- [ ] Map layer plugin

## How to test

<!-- Steps for reviewers to verify the change works correctly -->

1. 
2. 
3. 

## Checklist

- [ ] App loads without console errors
- [ ] Tested in **Dark**, **Light**, and **Retro** themes
- [ ] Responsive at different screen sizes (desktop + mobile)
- [ ] If touching `server.js`: caches have TTLs and size caps (we serve 2,000+ concurrent users)
- [ ] If adding an API route: includes caching and error handling
- [ ] If adding a panel: wired into Modern, Classic, and Dockable layouts
- [ ] No hardcoded colors — uses CSS variables (`var(--accent-cyan)`, etc.)
- [ ] No `.bak`, `.old`, `console.log` debug lines, or test scripts included

## Screenshots (if visual change)

<!-- Before/after screenshots or a quick screen recording help reviewers a lot -->
