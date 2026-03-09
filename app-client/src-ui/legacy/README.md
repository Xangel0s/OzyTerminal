# Legacy Frontend Artifacts

This folder keeps isolated frontend pieces that are no longer part of the active OzyTerminal runtime.

- `components/terminal-emulator.tsx`: old demo terminal without a live shell.
- `hooks/useTerminal.ts`: old local terminal state hook used by the demo emulator.
- `styles/globals.css`: prior global Tailwind theme file replaced by `app/globals.css`.

Do not import these files into the active Next.js app unless they are intentionally revived and validated.
