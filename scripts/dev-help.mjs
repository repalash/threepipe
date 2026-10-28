// Printed at the end of `npm install` (the prepare script, which builds nothing): how to start, and where the commands are explained.
console.log(`
  threepipe is installed.

  npm start          examples dev server, opens http://localhost:5173/examples/index.html
  npm run build:all  build the core, every plugin and the examples (cached)
  npm run watch      rebuild the core (src/) on change; in a plugin folder, rebuild that plugin
  npm run test:unit  unit tests

  All commands: CONTRIBUTING.md
`)
